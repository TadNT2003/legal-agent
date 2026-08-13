import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CrawlService } from './crawl.service';
import type {
  VbplSearchFilters,
  VbplSearchResult,
} from './vbpl-document.interface';
import { ChinhPhuSearchService } from './chinhphu-search.service';
import type { ChinhPhuSearchResult } from './chinhphu-search.interface';

export type FallbackSearchResult =
  | { source: 'vbpl.vn'; result: VbplSearchResult }
  | { source: 'vanban.chinhphu.vn'; result: ChinhPhuSearchResult };

/** "DD/MM/YYYY" -> "YYYY", or undefined if unparseable. */
function extractYear(dateDdMmYyyy: string): string | undefined {
  const match = dateDdMmYyyy.match(/^\d{1,2}\/\d{1,2}\/(\d{4})$/);
  return match ? match[1] : undefined;
}

/**
 * GET /crawl/search's own filter set (VbplSearchFilters — documentGroups,
 * documentTypes, validityStatus, effective/expiry date ranges, exactPhrase,
 * searchScope, ...) is unchanged and still drives the vbpl.vn-side search in
 * full; only the fallback path onto vanban.chinhphu.vn is restricted to the
 * 3 dimensions its search UI actually shares with vbpl.vn (keyword, issuing
 * body, issuing year) — see ChinhPhuSearchService, whose own filter set has
 * no counterpart here for the rest of vbpl.vn's filters, or for
 * vanban.chinhphu.vn's own "Lĩnh vực" (category) filter either.
 *
 * Searches vbpl.vn (this module's primary source) first; only falls back to
 * vanban.chinhphu.vn (supplementary) when vbpl.vn's search returns zero
 * matches — see tryVbplSearch's own comment for the one other trigger
 * (vbpl.vn rejecting an unrecognized issuingBody filter value).
 */
@Injectable()
export class FallbackSearchService {
  private readonly logger = new Logger(FallbackSearchService.name);

  constructor(
    private readonly crawlService: CrawlService,
    private readonly chinhPhuSearch: ChinhPhuSearchService,
  ) {}

  async search(filters: VbplSearchFilters): Promise<FallbackSearchResult> {
    const vbplResult = await this.tryVbplSearch(filters);
    if (vbplResult && vbplResult.items.length > 0) {
      return { source: 'vbpl.vn', result: vbplResult };
    }

    this.logger.log(
      `vbpl.vn returned 0 matches for ${JSON.stringify(filters)} — falling back to vanban.chinhphu.vn`,
    );
    if (filters.issuingBodies && filters.issuingBodies.length > 1) {
      this.logger.warn(
        `${filters.issuingBodies.length} issuingBodies were requested, but vanban.chinhphu.vn's org filter only supports one — using "${filters.issuingBodies[0]}", dropping the rest for the fallback.`,
      );
    }
    const chinhPhuResult = await this.chinhPhuSearch.search({
      keyword: filters.keyword,
      issuingBody: filters.issuingBodies?.[0],
      issuedYear: this.deriveIssuedYear(filters),
      // vbpl.vn's own page-size dropdown value (10/20/50/100) is the
      // closest available signal for "how many results the caller wants" —
      // not a precise translation (vanban.chinhphu.vn's maxResults has no
      // such fixed set), just the best one available.
      maxResults: filters.pageSize,
    });
    return { source: 'vanban.chinhphu.vn', result: chinhPhuResult };
  }

  /**
   * vbpl.vn has no single "year" filter, only issuedFrom/issuedTo date
   * ranges; vanban.chinhphu.vn's own "Năm ban hành" filter is
   * year-granularity already (see ChinhPhuSearchService). When both bounds
   * are set and land in different years, this is a genuine information loss
   * — logged and resolved by preferring issuedFrom's year — since a single
   * year is all vanban.chinhphu.vn's filter can express.
   */
  private deriveIssuedYear(filters: VbplSearchFilters): string | undefined {
    const fromYear = filters.issuedFrom
      ? extractYear(filters.issuedFrom)
      : undefined;
    const toYear = filters.issuedTo ? extractYear(filters.issuedTo) : undefined;
    if (fromYear && toYear && fromYear !== toYear) {
      this.logger.warn(
        `issuedFrom/issuedTo span different years (${fromYear}-${toYear}) — vanban.chinhphu.vn only supports a single year, using ${fromYear}.`,
      );
    }
    return fromYear ?? toYear;
  }

  /**
   * vbpl.vn's own sidebar-checkbox search throws BadRequestException for an
   * issuingBody name that isn't one of its recognized filter labels (see
   * VbplClientService.applySidebarCheckboxes) — a real, common case, since
   * vbpl.vn's checkbox list is smaller than vanban.chinhphu.vn's org
   * dropdown (confirmed live: 90+ entries vs. hundreds, including many
   * older/renamed bodies vbpl.vn never offers as a filter at all). That's
   * functionally "vbpl.vn has no path to find this org's documents via
   * search," the same trigger as a genuine zero-result search, so it's
   * treated the same way here rather than propagating as an error. Any
   * other exception (BadGatewayException from a real vbpl.vn outage,
   * ConflictException from a concurrent crawl already holding the browser
   * lock, ...) is NOT swallowed — those mean vbpl.vn search itself is
   * unavailable right now, not "no results," and silently falling back
   * would mask that as normal behavior.
   */
  private async tryVbplSearch(
    filters: VbplSearchFilters,
  ): Promise<VbplSearchResult | null> {
    try {
      return await this.crawlService.searchDocuments(filters);
    } catch (err) {
      if (err instanceof BadRequestException) {
        this.logger.warn(
          `vbpl.vn rejected the search filters (${err.message}) — treating as no vbpl.vn matches.`,
        );
        return null;
      }
      throw err;
    }
  }
}
