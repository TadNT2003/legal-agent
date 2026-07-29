import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as cheerio from 'cheerio';
import { lawIndexConfig } from '../law-index.config';
import { REQUEST_USER_AGENT } from './constants';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TRUNG_UONG_MARKER = '<!-- Trung ương -->';
const DIA_PHUONG_MARKER = '<!-- Địa phương -->';

/**
 * Discovers document URLs from vbpl.vn's sitemap.xml — a plain, stable,
 * plain-HTTP-crawlable index, so document discovery never needs the SPA's
 * search/filter UI at all. Split into "Trung ương" and "Địa phương" blocks;
 * this module only ever follows the Trung ương ones (see lawIndexConfig's
 * maxTier / the project's nationwide-applicability scope decision).
 *
 * The split is read positionally from the raw XML comment marker rather than
 * a hardcoded sitemap-index range, since the index's numbering could shift on
 * a future regeneration.
 */
@Injectable()
export class VbplSitemapService {
  private lastRequestAt = 0;

  constructor(
    @Inject(lawIndexConfig.KEY)
    private readonly config: ConfigType<typeof lawIndexConfig>,
  ) {}

  /**
   * Sub-sitemap URLs in the "Trung ương" block of the top-level sitemap
   * index — between the "Trung ương" and "Địa phương" markers, *not* just
   * everything before "Địa phương" (the index also has a "Trang tĩnh" static-
   * pages block ahead of "Trung ương", e.g. the homepage and /gioi-thieu —
   * confirmed live: those are non-document pages that break the 3-tab
   * extraction if crawled as if they were documents).
   */
  async fetchTrungUongSitemapUrls(): Promise<string[]> {
    const xml = await this.fetchText(`${this.config.vbplBaseUrl}/sitemap.xml`);
    const startIndex = xml.indexOf(TRUNG_UONG_MARKER);
    const endIndex = xml.indexOf(DIA_PHUONG_MARKER);
    if (startIndex === -1) {
      throw new BadGatewayException(
        `sitemap.xml no longer has a "${TRUNG_UONG_MARKER}" marker — the index structure may have changed.`,
      );
    }
    const trungUongXml = xml.slice(
      startIndex,
      endIndex === -1 ? undefined : endIndex,
    );
    return this.parseLocs(trungUongXml);
  }

  /** Document detail URLs listed in one sub-sitemap file. */
  async fetchDocumentUrls(sitemapUrl: string): Promise<string[]> {
    const xml = await this.fetchText(sitemapUrl);
    return this.parseLocs(xml);
  }

  private parseLocs(xml: string): string[] {
    const $ = cheerio.load(xml, { xmlMode: true });
    return $('loc')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
  }

  private async fetchText(url: string): Promise<string> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.config.requestDelayMs) {
      await sleep(this.config.requestDelayMs - elapsed);
    }
    this.lastRequestAt = Date.now();

    const res = await fetch(url, {
      headers: { 'User-Agent': REQUEST_USER_AGENT },
    });
    if (!res.ok) {
      throw new BadGatewayException(
        `Failed to fetch sitemap ${url}: HTTP ${res.status}`,
      );
    }
    return res.text();
  }
}
