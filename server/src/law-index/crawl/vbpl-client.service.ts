import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { lawIndexConfig } from '../law-index.config';
import {
  DISALLOWED_PATH_PREFIXES,
  REQUEST_USER_AGENT,
  VBPL_HOST,
} from './constants';
import type {
  RawAttributeEntry,
  RawRelationSection,
  RawVbplPage,
  VbplScope,
} from './vbpl-document.interface';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Talks to vbpl.vn only, via a real (headless) browser — required because the
 * site is a Next.js SPA whose document data is rendered client-side via
 * Server Actions, not present in the raw server-rendered HTML (confirmed by
 * direct investigation, see the law-index plan). Every navigation goes
 * through this client so "always render real pages, never call the
 * robots.txt-disallowed /api/ or /Pages/ paths" is enforced in one place.
 */
@Injectable()
export class VbplClientService implements OnModuleDestroy {
  private readonly logger = new Logger(VbplClientService.name);
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastRequestAt = 0;

  constructor(
    @Inject(lawIndexConfig.KEY)
    private readonly config: ConfigType<typeof lawIndexConfig>,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }

  assertTrustedDocumentUrl(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException(`Not a valid URL: ${url}`);
    }
    if (parsed.protocol !== 'https:' || parsed.hostname !== VBPL_HOST) {
      throw new BadRequestException(
        `Only https://${VBPL_HOST} URLs are accepted, got: ${url}`,
      );
    }
    if (
      DISALLOWED_PATH_PREFIXES.some((prefix) =>
        parsed.pathname.startsWith(prefix),
      )
    ) {
      throw new BadRequestException(
        `Refusing to navigate to a robots.txt-disallowed path: ${parsed.pathname}`,
      );
    }
    return parsed;
  }

  /** Loads all 3 relevant tabs for one document and returns the raw (uninterpreted) extraction. */
  async fetchDocument(url: string): Promise<RawVbplPage> {
    this.assertTrustedDocumentUrl(url);
    const page = await this.getPage();

    await this.throttledGoto(page, url);
    const { scope, title, fullText } = await page.evaluate(
      extractScopeTitleAndFullText,
    );

    const attributesUrl = withTabQuery(url, 'thuoc-tinh');
    await this.throttledGoto(page, attributesUrl);
    const attributes = await page.evaluate(extractAttributes);

    const relationsUrl = withTabQuery(url, 'luoc-do');
    await this.throttledGoto(page, relationsUrl);
    const relations = await page.evaluate(extractRelations);

    return { sourceUrl: url, scope, title, fullText, attributes, relations };
  }

  private async getPage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({ headless: this.config.headless });
    this.context = await this.browser.newContext({
      userAgent: REQUEST_USER_AGENT,
    });
    this.page = await this.context.newPage();
    return this.page;
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.config.requestDelayMs) {
      await sleep(this.config.requestDelayMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  // `waitUntil: 'networkidle'` is deliberately avoided — confirmed flaky in
  // practice (a repeat navigation on the same page timed out waiting for
  // network silence, almost certainly some background polling/analytics
  // beacon on vbpl.vn that never lets the connection count hit zero; this is
  // a documented Playwright pitfall, not specific to this site). Waiting for
  // the tab content itself to render is both faster and actually tied to
  // what we need, instead of an unrelated (and unreliable) global signal.
  private async throttledGoto(page: Page, url: string): Promise<void> {
    await this.throttle();
    const response = await page
      .goto(url, { waitUntil: 'domcontentloaded' })
      .catch((err) => {
        throw new BadGatewayException(
          `Failed to load ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    if (!response || !response.ok()) {
      throw new BadGatewayException(
        `Failed to load ${url}: HTTP ${response?.status() ?? 'unknown'}`,
      );
    }
    await page
      .waitForSelector('.ant-tabs-tabpane-active', { timeout: 15000 })
      .catch((err) => {
        throw new BadGatewayException(
          `Loaded ${url} but its content never rendered: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}

function withTabQuery(url: string, tab: 'thuoc-tinh' | 'luoc-do'): string {
  const parsed = new URL(url);
  parsed.searchParams.set('tabs', tab);
  return parsed.toString();
}

// ---- page.evaluate() extraction functions ----
// These run inside the browser page, not in Node — kept dumb/uninterpreted on
// purpose (raw label/value and category/entries pairs only); vbpl.parser.ts
// (a plain, DI-free, unit-testable module) does all the actual parsing.

function extractScopeTitleAndFullText(): {
  scope: VbplScope;
  title: string;
  fullText: string;
} {
  const trungUongLink = document.querySelector(
    'nav.ant-breadcrumb a[href="/van-ban/trung-uong"]',
  );
  const diaPhuongLink = document.querySelector(
    'nav.ant-breadcrumb a[href="/van-ban/dia-phuong"]',
  );
  const scope: VbplScope = trungUongLink
    ? 'trung-uong'
    : diaPhuongLink
      ? 'dia-phuong'
      : 'unknown';

  const breadcrumbItems = Array.from(
    document.querySelectorAll('nav.ant-breadcrumb li.ant-breadcrumb-item'),
  );
  const lastItem = breadcrumbItems[breadcrumbItems.length - 1];
  const title = lastItem ? (lastItem as HTMLElement).innerText.trim() : '';

  const pane = document.querySelector('.ant-tabs-tabpane-active');
  return {
    scope,
    title,
    fullText: pane ? (pane as HTMLElement).innerText : '',
  };
}

function extractAttributes(): RawAttributeEntry[] {
  const containers = Array.from(
    document.querySelectorAll('.ant-descriptions-item-container'),
  );
  return containers
    .map((c) => {
      const label = c.querySelector('.ant-descriptions-item-label');
      const value = c.querySelector('.ant-descriptions-item-content');
      return {
        label: label ? (label as HTMLElement).innerText.trim() : '',
        value: value ? (value as HTMLElement).innerText.trim() : '',
      };
    })
    .filter((e) => e.label);
}

function extractRelations(): RawRelationSection[] {
  const cards = Array.from(document.querySelectorAll('.ant-card'));
  return cards
    .map((card) => {
      const heading = card.querySelector('span.font-bold');
      const entries = Array.from(card.querySelectorAll('ul li a')).map((a) =>
        (a as HTMLElement).innerText.trim(),
      );
      return {
        categoryLabel: heading ? (heading as HTMLElement).innerText.trim() : '',
        entries: entries.filter(Boolean),
      };
    })
    .filter((s) => s.categoryLabel);
}
