import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Browser, BrowserContext, chromium, Page, Response } from 'playwright';
import { lawIndexConfig } from '../law-index.config';
import {
  DISALLOWED_PATH_PREFIXES,
  REQUEST_USER_AGENT,
  VBPL_HOST,
  VBPL_ORIGINAL_DOCUMENT_HOST,
} from './constants';
import type {
  RawAttributeEntry,
  RawRelationSection,
  RawVbplPage,
  VbplScope,
  VbplSearchFilters,
  VbplSearchScope,
} from './vbpl-document.interface';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SEARCH_SCOPE_LABELS: Record<VbplSearchScope, string> = {
  'noi-dung': 'Nội dung',
  'tieu-de': 'Tiêu đề',
  'so-hieu': 'Số hiệu',
};

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
  private documentsFetched = 0;

  // Guards the shared browser/context/page (see fetchDocument/searchDocuments
  // below) against two concurrent requests interleaving on it, and against a
  // concurrent request grabbing the page in the window where it's about to
  // be torn down by a browser recycle — see acquireLock's doc comment.
  private isProcessing = false;

  constructor(
    @Inject(lawIndexConfig.KEY)
    private readonly config: ConfigType<typeof lawIndexConfig>,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.closeBrowserResources();
  }

  private async closeBrowserResources(): Promise<void> {
    await this.page?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }

  /**
   * Serializes access to the shared browser/page across concurrent callers
   * of fetchDocument/searchDocuments — those fields are singleton instance
   * state (see class fields above), genuinely unguarded before this. Throws
   * rather than queuing: the caller (a sync single-doc endpoint, or a job
   * worker sharing this same process — worker concurrency is 1, so this
   * mainly protects sync endpoints against colliding with each other or with
   * a running job) should surface a clean 409 instead of silently waiting on
   * someone else's in-flight scrape.
   *
   * Browser recycling (see maybeRecycleBrowser) also runs inside this same
   * lock, at the end of fetchDocument, rather than being triggered by a
   * separate unlocked call after fetchDocument returns — recycling tears
   * down the very state this lock protects, so it needs the same
   * mutual-exclusion guarantee, not just the fetch itself. A second request
   * acquiring the lock the instant it's released, only to have its page torn
   * out from under it moments later by a deferred recycle call, is exactly
   * the race this lock exists to prevent.
   */
  private acquireLock(): void {
    if (this.isProcessing) {
      throw new ConflictException(
        'A crawl operation is already in progress. Please wait for it to complete.',
      );
    }
    this.isProcessing = true;
  }

  private releaseLock(): void {
    this.isProcessing = false;
  }

  /**
   * Tears down the cached browser/context/page once the per-browser document
   * counter has reached the configured recycle threshold, bounding Chromium's
   * memory growth over a long batch. Called from inside fetchDocument's own
   * locked block (see acquireLock) — never call this from outside that lock.
   */
  private async maybeRecycleBrowser(): Promise<void> {
    const shouldRecycle =
      this.documentsFetched > 0 &&
      this.documentsFetched >= this.config.browserRecycleInterval;
    if (!shouldRecycle) return;
    const count = this.documentsFetched;
    await this.resetPage();
    this.documentsFetched = 0;
    this.logger.log(`Recycled browser after ${count} documents`);
  }

  /** Tears down the cached browser/context/page so the next getPage() call
   * launches a completely fresh one — see withPageRetry. */
  private async resetPage(): Promise<void> {
    await this.closeBrowserResources();
    this.browser = null;
    this.context = null;
    this.page = null;
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

  /** Loads all 4 relevant tabs for one document and returns the raw (uninterpreted) extraction. */
  async fetchDocument(url: string): Promise<RawVbplPage> {
    this.assertTrustedDocumentUrl(url);
    await this.acquireLock();
    try {
      this.documentsFetched += 1;

      // Each throttledGoto call may replace the shared page with a fresh one
      // (see withPageRetry) — always use the page it just returned, not one
      // captured earlier, or a mid-flow retry would leave later steps
      // operating on a closed/stale page.
      let page = await this.throttledGoto(url);
      const { scope, title, fullText } = await page.evaluate(
        extractScopeTitleAndFullText,
      );

      page = await this.throttledGoto(withTabQuery(url, 'thuoc-tinh'));
      const attributes = await page.evaluate(extractAttributes);

      page = await this.throttledGoto(withTabQuery(url, 'luoc-do'));
      const relations = await page.evaluate(extractRelations);

      const originalDocumentUrls = await this.fetchOriginalDocumentUrls(url);

      const result: RawVbplPage = {
        sourceUrl: url,
        scope,
        title,
        fullText,
        attributes,
        relations,
        originalDocumentUrls,
      };

      // Runs inside this same lock — see maybeRecycleBrowser's doc comment
      // for why a separate, unlocked call after fetchDocument returns isn't
      // safe.
      await this.maybeRecycleBrowser();

      return result;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Loads the "Văn bản gốc" tab and returns every distinct scanned-original
   * download URL vbpl.vn's own PDF viewer fetches from the MoJ MinIO
   * gateway — captured directly off the network response rather than
   * reconstructed from a DOM-scraped filename + internal id.
   *
   * Confirmed live this is the only reliable signal: the tab renders in at
   * least two different DOM shapes depending on vbpl.vn's own logic — a
   * "Danh sách văn bản gốc (N file)" collapse+list for some documents, a
   * bare embedded PDF viewer with *no list at all* for others (both cases
   * observed on real single-file documents) — and the file-list-scraping
   * approach this replaced silently returned `[]` for the latter shape
   * regardless of whether a real file existed underneath.
   */
  private async fetchOriginalDocumentUrls(url: string): Promise<string[]> {
    await this.throttle();
    const tabUrl = withTabQuery(url, 'hien-thi-pdf');
    const isOriginalDocResponse = (res: Response) =>
      res
        .url()
        .includes(
          `${VBPL_ORIGINAL_DOCUMENT_HOST}/api/qtdc/public/doc/minio/buckets/vbpl/`,
        );

    const urls = new Set<string>();
    const onResponse = (res: Response) => {
      if (isOriginalDocResponse(res)) urls.add(res.url());
    };

    await this.withPageRetry(`Loading ${tabUrl}`, async (page) => {
      page.on('response', onResponse);
      try {
        const response = await page.goto(tabUrl, {
          waitUntil: 'domcontentloaded',
        });
        if (!response || !response.ok()) {
          throw new Error(`HTTP ${response?.status() ?? 'unknown'}`);
        }
        await page.waitForSelector('.ant-tabs-tabpane-active', {
          timeout: 15000,
        });
        // Multi-file documents show a collapse+list; only the first file
        // auto-fetches on tab load, so click through the rest to trigger
        // their own fetches too. Single-file documents (either DOM shape)
        // already auto-fetch on mount — these clicks are then a harmless
        // no-op (or at worst re-trigger the same fetch, deduped by the Set
        // above).
        await page
          .locator('.ant-tabs-tabpane-active .ant-collapse-header')
          .first()
          .click({ timeout: 5000 })
          .catch(() => undefined);
        const items = page.locator('.ant-tabs-tabpane-active .ant-list-item');
        const itemCount = await items.count().catch(() => 0);
        for (let i = 0; i < itemCount; i++) {
          await items
            .nth(i)
            .click({ timeout: 5000 })
            .catch(() => undefined);
        }
        // response events for a fetch triggered by the actions above arrive
        // asynchronously, not synchronously within those calls — give the
        // last one a moment to actually land. Absent entirely (no error) on
        // a document with zero original files.
        await page.waitForTimeout(1500);
      } finally {
        page.off('response', onResponse);
      }
    });

    return Array.from(urls);
  }

  /**
   * Drives the real /van-ban/trung-uong filter + advanced-search UI (fills
   * the keyword box, checks sidebar filter checkboxes, opens the advanced
   * panel for date-range/validity-status fields) and returns the raw body of
   * the network response that submitting the form produces — not scraped
   * from the rendered DOM, since result cards carry no href/id (confirmed
   * live: title clicks are a React handler, not a real link) and this is the
   * only way to recover each match's id without reimplementing vbpl.vn's
   * internal Next.js Server Action protocol (see constants.ts's
   * DISALLOWED_PATH_PREFIXES comment — the real browser still does the
   * actual request here, this just reads the body it already produced).
   * vbpl.parser.ts's parseVbplSearchPage turns this into typed results.
   */
  async searchDocuments(filters: VbplSearchFilters): Promise<string> {
    await this.acquireLock();
    try {
      return await this.searchDocumentsLocked(filters);
    } finally {
      this.releaseLock();
    }
  }

  private async searchDocumentsLocked(
    filters: VbplSearchFilters,
  ): Promise<string> {
    await this.throttle();

    const searchUrl = `${this.config.vbplBaseUrl}/van-ban/trung-uong`;
    const isSearchResponse = (res: Response) =>
      res.url() === searchUrl && res.request().method() === 'POST';

    // Tracks the most recent matching response body rather than tying a
    // single `waitForResponse` to a single click: vbpl.vn dedupes/caches
    // identical successive queries (confirmed live — clicking the advanced
    // panel's submit button right after a sidebar checkbox already fired the
    // same query produces *no* new network request at all), so demanding a
    // response caused by one specific action hangs forever whenever an
    // earlier action already settled the same state. Attached before
    // navigation so the page's own initial (unfiltered) load is captured too.
    let latestBody: string | null = null;
    let latestAt = 0;
    const onResponse = (res: Response) => {
      if (!isSearchResponse(res)) return;
      res
        .text()
        .then((text) => {
          latestBody = text;
          latestAt = Date.now();
        })
        .catch(() => undefined);
    };

    // withPageRetry may swap in a fresh page on retry — the listener has to
    // move with it (attached inside the attempt, removed if that attempt
    // fails) so a retry doesn't leave a stale listener on a closed page.
    const page = await this.withPageRetry(`Loading ${searchUrl}`, async (p) => {
      p.on('response', onResponse);
      try {
        const response = await p.goto(searchUrl, {
          waitUntil: 'domcontentloaded',
        });
        if (!response || !response.ok()) {
          throw new Error(`HTTP ${response?.status() ?? 'unknown'}`);
        }
        await p.waitForSelector('.ant-collapse-item', { timeout: 15000 });
        return p;
      } catch (err) {
        p.off('response', onResponse);
        throw err;
      }
    });

    try {
      return await this.applyFiltersAndCollect(
        page,
        filters,
        () => latestBody,
        () => latestAt,
        () => {
          latestBody = null;
        },
      );
    } finally {
      page.off('response', onResponse);
    }
  }

  private async applyFiltersAndCollect(
    page: Page,
    filters: VbplSearchFilters,
    getLatestBody: () => string | null,
    getLatestAt: () => number,
    resetLatest: () => void,
  ): Promise<string> {
    if (filters.keyword) {
      await page
        .getByPlaceholder('Nhập từ khóa tìm kiếm')
        .fill(filters.keyword);
    }
    if (filters.searchScope) {
      await page
        .getByRole('radio', {
          name: SEARCH_SCOPE_LABELS[filters.searchScope],
          exact: true,
        })
        .check();
    }
    if (filters.exactPhrase) {
      await page
        .getByRole('checkbox', { name: 'Chính xác cụm từ trên', exact: true })
        .check();
    }

    await this.applySidebarCheckboxes(
      page,
      'Nhóm văn bản',
      filters.documentGroups,
    );
    await this.applySidebarCheckboxes(
      page,
      'Cơ quan ban hành',
      filters.issuingBodies,
    );
    await this.applySidebarCheckboxes(
      page,
      'Hình thức văn bản',
      filters.documentTypes,
    );

    // Always open the advanced panel to reach its submit button — a
    // deterministic "apply everything now" trigger regardless of which
    // filters above were actually set. Its click may or may not itself
    // produce a new network request (see the dedupe/caching note above);
    // waitForSettledResponse below tolerates either outcome.
    await page.getByRole('button', { name: 'Tìm kiếm nâng cao' }).click();
    if (filters.validityStatus) {
      await this.selectAdvancedDropdown(
        page,
        'Tình trạng hiệu lực',
        filters.validityStatus,
      );
    }
    await this.fillDateRange(
      page,
      'Ngày ban hành',
      filters.issuedFrom,
      filters.issuedTo,
    );
    await this.fillDateRange(
      page,
      'Ngày có hiệu lực',
      filters.effectiveFrom,
      filters.effectiveTo,
    );
    await this.fillDateRange(
      page,
      'Ngày hết hiệu lực',
      filters.expiredFrom,
      filters.expiredTo,
    );
    await page
      .getByRole('button', { name: 'Tìm kiếm', exact: true })
      .last()
      .click();

    let bodyText = await this.waitForSettledResponse(
      getLatestBody,
      getLatestAt,
    );

    if (filters.pageSize) {
      // Must run after the real search is submitted, not before: the size
      // changer only reflects (and its selection is only kept by) the
      // *current* result set. Selecting it against the page's initial,
      // unfiltered result list — the previous behavior — got silently reset
      // back to vbpl.vn's default (10) the moment the actual filtered search
      // executed, so a caller-requested pageSize was never honored (confirmed
      // live: pageSize=100 came back as a 10-item page with pageSize:10 in
      // the response).
      resetLatest();
      await this.selectPageSize(page, filters.pageSize);
      bodyText = await this.waitForSettledResponse(getLatestBody, getLatestAt);
    }

    if (filters.page && filters.page > 1) {
      const jumpInput = page.locator(
        '.ant-input-affix-wrapper[class*="jumperInput"] input',
      );
      try {
        // Short timeout: this control isn't rendered at all when the result
        // set fits on a single page — i.e. filters.page can't legitimately
        // be > 1 in that state, so this is a real "no such page" error.
        await jumpInput.waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        throw new BadRequestException(
          `page=${filters.page} was requested but this search's results fit on a single page.`,
        );
      }
      resetLatest();
      await jumpInput.fill(String(filters.page));
      await jumpInput.press('Enter');
      bodyText = await this.waitForSettledResponse(getLatestBody, getLatestAt);
    }

    return bodyText;
  }

  /** Polls the response-listener state captured by searchDocuments until it
   * has been quiet for `quietMs` — i.e. no newer matching response has come
   * in for a moment — rather than awaiting one specific network event, since
   * which action (if any) actually produces a fresh request is not
   * predictable (see searchDocuments' dedupe/caching note). */
  private async waitForSettledResponse(
    getLatestBody: () => string | null,
    getLatestAt: () => number,
    timeoutMs = 30000,
    quietMs = 800,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const body = getLatestBody();
      if (body !== null && Date.now() - getLatestAt() > quietMs) {
        return body;
      }
      await sleep(150);
    }
    throw new BadGatewayException(
      'vbpl.vn never returned a search result payload in time.',
    );
  }

  /** Checks each requested label within a "Bộ lọc" sidebar section (e.g.
   * "Hình thức văn bản"), scoped to that section since a few labels — e.g.
   * "Văn bản hợp nhất" — appear in more than one section. Each section's
   * checkbox list is populated by its own async fetch (confirmed live — same
   * pattern as the "Cơ quan ban hành" agency list), so this waits for the
   * specific label to render rather than snapshotting the DOM immediately:
   * `.count()` doesn't auto-wait the way an action like `.click()` does, and
   * checking it right after page load raced the fetch and always lost. */
  private async applySidebarCheckboxes(
    page: Page,
    sectionTitle: string,
    labels: string[] | undefined,
  ): Promise<void> {
    if (!labels || labels.length === 0) return;
    const section = page.locator('.ant-collapse-item', {
      has: page.locator('.ant-collapse-header-text', { hasText: sectionTitle }),
    });
    for (const label of labels) {
      const checkboxLabel = section.getByText(label, { exact: true }).first();
      try {
        await checkboxLabel.click({ timeout: 15000 });
      } catch {
        throw new BadRequestException(
          `"${label}" is not a recognized "${sectionTitle}" filter option on vbpl.vn.`,
        );
      }
    }
  }

  /** Selects an option from one of the advanced panel's ant-select dropdowns,
   * located by its adjacent field label rather than a fixed class name. */
  private async selectAdvancedDropdown(
    page: Page,
    fieldLabel: string,
    optionLabel: string,
  ): Promise<void> {
    const label = page.getByText(fieldLabel, { exact: true });
    await label.locator('xpath=following-sibling::*[1]').click();
    const option = page
      .getByRole('option', { name: optionLabel, exact: true })
      .first();
    try {
      await option.click({ timeout: 15000 });
    } catch {
      throw new BadRequestException(
        `"${optionLabel}" is not a recognized "${fieldLabel}" option on vbpl.vn.`,
      );
    }
  }

  /** Fills a "dd/mm/yyyy - dd/mm/yyyy" range pair in the advanced panel,
   * located by its adjacent field label (the "to" input has no distinguishing
   * accessible name of its own, so this scopes by DOM position instead). */
  private async fillDateRange(
    page: Page,
    fieldLabel: string,
    from: string | undefined,
    to: string | undefined,
  ): Promise<void> {
    if (!from && !to) return;
    const label = page.getByText(fieldLabel, { exact: true });
    const wrapper = label.locator('xpath=following-sibling::*[1]');
    const inputs = wrapper.locator('input[placeholder="dd/mm/yyyy"]');
    if (from) await inputs.nth(0).fill(from);
    if (to) await inputs.nth(1).fill(to);
  }

  private async selectPageSize(page: Page, pageSize: number): Promise<void> {
    // Deliberately not getByRole('combobox', ...): that resolves to the
    // AntD Select's inner search <input>, which the visible "10 / trang"
    // selection-item span sits on top of and blocks pointer events for
    // (confirmed live) — .ant-select-selector is the actual visible/
    // clickable trigger that opens the dropdown.
    const combo = page.locator(
      '.ant-pagination-options-size-changer .ant-select-selector',
    );
    try {
      // A short timeout here: this control simply isn't rendered when the
      // current result set already fits on one page (confirmed live — e.g.
      // filtering down to "Hiến pháp" leaves too few matches for pagination
      // controls to appear at all), which isn't an error to surface.
      await combo.click({ timeout: 5000 });
    } catch {
      return;
    }
    const option = page
      .getByRole('option', { name: `${pageSize} / trang`, exact: true })
      .first();
    try {
      await option.click({ timeout: 15000 });
    } catch {
      throw new BadRequestException(
        `pageSize=${pageSize} is not one of vbpl.vn's supported page sizes (typically 10/20/50/100).`,
      );
    }
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

  /**
   * Runs `attemptFn` against the current (or lazily-launched) shared page,
   * retrying exactly once against a completely fresh browser/context/page if
   * the first attempt throws. Closes the resilience gap where the single
   * cached `page` getting into a degraded/stuck state (from an earlier
   * navigation failure) previously took down every subsequent call on this
   * service instance until an operator noticed and restarted the whole
   * process — confirmed live: a 653-document re-sync batch saw runs of
   * consecutive slow/unresponsive requests (client-side timeouts with no
   * response at all) immediately following an isolated 15s render-wait
   * timeout, recovering only once something eventually reset the shared
   * page's state on its own. A second failure still throws
   * BadGatewayException rather than retrying further — this bounds recovery
   * to one retry, not an infinite loop against a genuinely unreachable page.
   */
  private async withPageRetry<T>(
    description: string,
    attemptFn: (page: Page) => Promise<T>,
  ): Promise<T> {
    const page = await this.getPage();
    try {
      return await attemptFn(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `${description} failed (${message}) — recreating the browser page and retrying once`,
      );
      await this.resetPage();
      const freshPage = await this.getPage();
      try {
        return await attemptFn(freshPage);
      } catch (retryErr) {
        const retryMessage =
          retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new BadGatewayException(
          `${description} failed even after recreating the browser page: ${retryMessage}`,
        );
      }
    }
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
  //
  // Returns the Page actually used (see withPageRetry) — callers must use
  // this return value for subsequent operations rather than a page reference
  // captured earlier, since a retry may have replaced it with a fresh one.
  private async throttledGoto(url: string): Promise<Page> {
    await this.throttle();
    return this.withPageRetry(`Navigation to ${url}`, async (page) => {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!response || !response.ok()) {
        throw new Error(`HTTP ${response?.status() ?? 'unknown'}`);
      }
      await page.waitForSelector('.ant-tabs-tabpane-active', {
        timeout: 15000,
      });
      return page;
    });
  }
}

function withTabQuery(
  url: string,
  tab: 'thuoc-tinh' | 'luoc-do' | 'hien-thi-pdf',
): string {
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
  fullText: string | null;
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

  // Some (mostly older) documents have no "Nội dung" tab at all — vbpl.vn
  // only offers a scanned original via "Văn bản gốc", no digitized body text
  // (confirmed live: their tab bar is Thuộc tính/Lược đồ/Văn bản gốc/Tải về,
  // no "toan-van" tab, and the page's default active tab is Thuộc tính
  // instead). Without this check, `.ant-tabs-tabpane-active` on first page
  // load silently resolves to the Thuộc tính pane on those documents, and
  // its attributes-table text gets captured as if it were the real body.
  const hasNoiDungTab = !!document.querySelector(
    '.ant-tabs-tab[data-node-key="toan-van"]',
  );
  const pane = document.querySelector('.ant-tabs-tabpane-active');
  return {
    scope,
    title,
    fullText: hasNoiDungTab && pane ? (pane as HTMLElement).innerText : null,
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
