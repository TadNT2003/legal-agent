import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_RECORDS_PER_PAGE,
} from '../download/constants';
import type { SearchResultRow } from '../download/parsed-law-document.interface';
import { VanBanChinhPhuClientService } from '../download/vanban-chinh-phu-client.service';
import { parseSearchPage } from '../download/vanban-chinh-phu.parser';
import type {
  ChinhPhuSearchFilters,
  ChinhPhuSearchResult,
} from './chinhphu-search.interface';

/**
 * Read-only search against vanban.chinhphu.vn's own "TÌM KIẾM VĂN BẢN" form —
 * the same one download/law-download.service.ts drives for its
 * search-and-download flow, but scoped to just the 3 filter dimensions
 * FallbackSearchService needs (keyword/org/year) and never downloading
 * files. This duplicates law-download.service.ts's fetchSearchResults
 * pagination logic rather than sharing it — deliberate, per this project's
 * "two independent workflows, not meant to reconcile" stance (see
 * CLAUDE.md): download/ is the workflow-A flat-file corpus builder, this is
 * workflow-B DB-ingestion support, and they're kept decoupled even where
 * they hit the same site.
 */
@Injectable()
export class ChinhPhuSearchService {
  private readonly logger = new Logger(ChinhPhuSearchService.name);

  constructor(private readonly client: VanBanChinhPhuClientService) {}

  /**
   * Resolves an exact "Cơ quan ban hành" display name to vanban.chinhphu.vn's
   * own internal drdDocOrg option id. Returns null (never throws) when the
   * name matches zero or more than one dropdown entry — the live list is
   * not guaranteed unique per label (confirmed live: at least one body
   * appears under two different ids from an administrative reorg — see
   * ParsedSearchPage.orgOptions' own comment) — leaving the caller to decide
   * whether to drop the org constraint or fail.
   */
  async resolveOrgId(issuingBody: string): Promise<string | null> {
    const searchHtml = await this.client.fetchSearchPage();
    const { orgOptions } = parseSearchPage(searchHtml);
    const matches = orgOptions.filter((o) => o.label === issuingBody);
    if (matches.length !== 1) {
      this.logger.warn(
        `"${issuingBody}" matched ${matches.length} vanban.chinhphu.vn "Cơ quan ban hành" dropdown entries (expected exactly 1) — searching without an org constraint.`,
      );
      return null;
    }
    return matches[0].value;
  }

  async search(filters: ChinhPhuSearchFilters): Promise<ChinhPhuSearchResult> {
    const maxResults = filters.maxResults ?? DEFAULT_MAX_RESULTS;
    const recordsPerPage = DEFAULT_RECORDS_PER_PAGE;

    let orgId: string | null = null;
    let issuingBodyUnresolved = false;
    if (filters.issuingBody) {
      orgId = await this.resolveOrgId(filters.issuingBody);
      issuingBodyUnresolved = orgId === null;
    }

    const initial = parseSearchPage(await this.client.fetchSearchPage());
    if (!initial.controls) {
      throw new BadGatewayException(
        'Could not find the expected search form controls on vanban.chinhphu.vn — the page structure may have changed.',
      );
    }
    const { controls } = initial;

    // Reused as-is on every page request below (only __EVENTTARGET/
    // __EVENTARGUMENT + the fresh hiddenFields change between pages) —
    // category is deliberately left at "0" (all), matching this service's
    // 3-filter scope (see class doc comment).
    const baseFields: Record<string, string> = {
      [controls.category]: '0',
      [controls.org]: orgId ?? '0',
      [controls.year]: filters.issuedYear ?? '0',
      [controls.recordsPerPage]: String(recordsPerPage),
      [controls.keyword]: filters.keyword ?? '',
    };

    const searchFields: Record<string, string> = {
      ...initial.hiddenFields,
      ...baseFields,
      [controls.searchButton]: 'Tìm kiếm',
    };
    delete searchFields['__EVENTTARGET'];
    delete searchFields['__EVENTARGUMENT'];

    let page = parseSearchPage(await this.client.postSearch(searchFields));
    const collected: SearchResultRow[] = [...page.rows];
    const totalAvailable = page.totalCount ?? page.rows.length;
    const targetCount = Math.min(maxResults, totalAvailable);
    const realPageSize = page.rows.length || recordsPerPage;
    const pageCap = Math.min(Math.ceil(maxResults / realPageSize) + 1, 50);

    let pageNum = 2;
    while (
      collected.length < targetCount &&
      page.rows.length > 0 &&
      pageNum <= pageCap
    ) {
      const pageFields: Record<string, string> = {
        ...page.hiddenFields,
        ...baseFields,
        __EVENTTARGET: controls.gridView,
        __EVENTARGUMENT: `Page$${pageNum}`,
      };
      page = parseSearchPage(await this.client.postSearch(pageFields));
      collected.push(...page.rows);
      pageNum += 1;
    }

    const items = collected.slice(0, maxResults).map((row) => ({
      sourceUrl: row.docUrl,
      citation: row.citation,
      title: row.title,
      issuedDate: row.date,
    }));

    return { total: totalAvailable, items, issuingBodyUnresolved };
  }
}
