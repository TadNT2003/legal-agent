export interface ParsedLawDocument {
  citation: string;
  title: string;
  /** Normalized to DD/MM/YYYY, matching laws/manifest.json's existing entries. */
  date: string | null;
  docType: string | null;
  issuingBody: string | null;
  /** "Người ký" — present on vanban.chinhphu.vn's own detail page (confirmed live), just not previously read out of parseDocumentDetailPage's meta map. */
  signerName: string | null;
  /**
   * "Chức danh" — read the same way as signerName, but unlike it, not
   * confirmed present on any real vanban.chinhphu.vn document seen so far
   * (the site may fold title into signerName's own text, or omit it
   * entirely); left in as a harmless no-op extraction (null if the row
   * doesn't exist) rather than omitted outright.
   */
  signerTitle: string | null;
  sourceUrl: string;
  fileUrls: string[];
}

export interface SearchResultRow {
  citation: string;
  title: string;
  date: string | null;
  docUrl: string | null;
  fileUrls: string[];
}
