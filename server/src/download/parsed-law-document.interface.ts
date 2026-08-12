export interface ParsedLawDocument {
  citation: string;
  title: string;
  /** Normalized to DD/MM/YYYY, matching laws/manifest.json's existing entries. */
  date: string | null;
  docType: string | null;
  issuingBody: string | null;
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
