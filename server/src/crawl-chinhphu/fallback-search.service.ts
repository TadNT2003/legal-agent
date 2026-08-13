import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CrawlService } from '../crawl/crawl.service';
import type {
  VbplSearchFilters,
  VbplSearchResult,
} from '../crawl/vbpl-document.interface';
import { ChinhPhuSearchService } from './chinhphu-search.service';
import type { ChinhPhuSearchResult } from './chinhphu-search.interface';

/**
 * The 3 search dimensions vbpl.vn and vanban.chinhphu.vn's own search UIs
 * genuinely share. vbpl.vn's much larger filter set (documentGroups,
 * documentTypes, validityStatus, effective/expiry date ranges, exactPhrase,
 * searchScope — see VbplSearchFilters) has no vanban.chinhphu.vn
 * counterpart at all, and vanban.chinhphu.vn's own "Lĩnh vực" (category)
 * filter has no vbpl.vn counterpart either — both are deliberately excluded
 * from this fallback rather than left to silently apply on one side only.
 */
export interface CommonLawSearchFilters {
  keyword?: string;
  /** Exact "Cơ quan ban hành" display name, e.g. "Bộ Tư pháp" — matched against vbpl.vn's sidebar checkbox labels first; only resolved against vanban.chinhphu.vn's own dropdown if the fallback actually triggers (see ChinhPhuSearchService.resolveOrgId). */
  issuingBody?: string;
  /**
   * A 4-digit issuing year. vbpl.vn has no single "year" filter, only
   * issuedFrom/issuedTo date ranges (VbplSearchFilters), so this is expanded
   * to a full-year range (01/01/YYYY-31/12/YYYY) when querying it;
   * vanban.chinhphu.vn's own "Năm ban hành" filter is year-granularity
   * already, so it's passed through as-is on fallback.
   */
  issuedYear?: string;
  /**
   * Upper bound on vanban.chinhphu.vn results if the fallback triggers.
   * Does NOT bound the vbpl.vn-side check, which always looks at that
   * site's own default first page (10 results) — this is a "does vbpl.vn
   * have anything at all" check, not a full paginated vbpl.vn search; call
   * GET /crawl/search directly with an explicit pageSize for that.
   */
  maxResults?: number;
}

export type FallbackSearchResult =
  | { source: 'vbpl.vn'; result: VbplSearchResult }
  | { source: 'vanban.chinhphu.vn'; result: ChinhPhuSearchResult };

/**
 * Searches vbpl.vn (crawl/, the primary source) first; only falls back to
 * vanban.chinhphu.vn (this module, supplementary) when vbpl.vn's search
 * returns zero matches. A one-way dependency on crawl/ — crawl/ itself has
 * no knowledge of this module, matching the "supplementary source defers to
 * the primary one" direction already established by
 * persistence/chinhphu-document.repository.ts's citation-collision handling.
 */
@Injectable()
export class FallbackSearchService {
  private readonly logger = new Logger(FallbackSearchService.name);

  constructor(
    private readonly crawlService: CrawlService,
    private readonly chinhPhuSearch: ChinhPhuSearchService,
  ) {}

  async search(filters: CommonLawSearchFilters): Promise<FallbackSearchResult> {
    const vbplFilters: VbplSearchFilters = {
      keyword: filters.keyword,
      issuingBodies: filters.issuingBody ? [filters.issuingBody] : undefined,
      issuedFrom: filters.issuedYear
        ? `01/01/${filters.issuedYear}`
        : undefined,
      issuedTo: filters.issuedYear ? `31/12/${filters.issuedYear}` : undefined,
    };

    const vbplResult = await this.tryVbplSearch(vbplFilters);
    if (vbplResult && vbplResult.items.length > 0) {
      return { source: 'vbpl.vn', result: vbplResult };
    }

    this.logger.log(
      `vbpl.vn returned 0 matches for ${JSON.stringify(filters)} — falling back to vanban.chinhphu.vn`,
    );
    const chinhPhuResult = await this.chinhPhuSearch.search({
      keyword: filters.keyword,
      issuingBody: filters.issuingBody,
      issuedYear: filters.issuedYear,
      maxResults: filters.maxResults,
    });
    return { source: 'vanban.chinhphu.vn', result: chinhPhuResult };
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
