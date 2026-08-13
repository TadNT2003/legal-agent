export interface ChinhPhuSearchFilters {
  keyword?: string;
  /** Exact "Cơ quan ban hành" display name — resolved against the live drdDocOrg dropdown; see ChinhPhuSearchService.resolveOrgId. */
  issuingBody?: string;
  /** 4-digit year — vanban.chinhphu.vn's own "Năm ban hành" filter is year-granularity already (confirmed live: the dropdown's option value equals its label), so this is passed straight through, unlike vbpl.vn's date-range filters. */
  issuedYear?: string;
  maxResults?: number;
}

export interface ChinhPhuSearchResultItem {
  sourceUrl: string | null;
  citation: string;
  title: string;
  issuedDate: string | null;
}

export interface ChinhPhuSearchResult {
  total: number;
  items: ChinhPhuSearchResultItem[];
  /**
   * True when filters.issuingBody was set but couldn't be resolved to
   * exactly one vanban.chinhphu.vn org id (0 or 2+ dropdown matches — see
   * ParsedSearchPage.orgOptions' own comment on why this happens for real
   * bodies) — the search ran without that constraint rather than failing
   * outright.
   */
  issuingBodyUnresolved: boolean;
}
