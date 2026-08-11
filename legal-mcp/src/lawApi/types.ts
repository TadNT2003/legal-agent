/** Mirrors the scraper server's `RetrieveSearchDto` (server/src/law-index/retrieve/dto/retrieve-search.dto.ts). */
export interface LawSearchParams {
  keyword?: string;
  searchScope?: 'noi-dung' | 'tieu-de' | 'so-hieu';
  documentTypes?: string[];
  issuingBodies?: string[];
  validityStatus?: string;
  issuedFrom?: string;
  issuedTo?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  page?: number;
  pageSize?: number;
}

export interface LawSearchResultItem {
  documentId: string;
  sourceUrl: string;
  citation: string;
  title: string;
  documentType: string;
  issuingBody: string;
  issuedDate: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  validityStatus: string | null;
}

export interface LawSearchResult {
  total: number;
  page: number;
  pageSize: number;
  items: LawSearchResultItem[];
}

/** Mirrors the scraper server's `RetrieveDocumentResponseDto`. */
export interface LawDocument {
  id: string;
  citationId: string;
  title: string;
  documentType: string;
  issuingBody: string | null;
  industry: string | null;
  field: string | null;
  signerName: string | null;
  signerTitle: string | null;
  enactedDate: string | null;
  effectiveDate: string | null;
  gazettePublishedDate: string | null;
  validityStatus: string;
  isConsolidated: boolean;
  consolidatesDocumentId: string | null;
  sourceUrl: string;
}

/** Mirrors the scraper server's `RetrieveNodeDto`. */
export interface LawNodeParams {
  documentId: string;
  nodeType?: string;
  number?: string;
  nodeId?: string;
}

/** Mirrors the scraper server's `RetrieveNodeItemDto` (nested tree, recursively enriched with `fullText`). */
export interface LawNode {
  id: string;
  nodeType: string;
  label: string;
  ordinal: string;
  heading: string | null;
  fullText: string | null;
  textContent: string | null;
  contentClass: string | null;
  path: string;
  children: LawNode[];
}

export interface LawNodeResult {
  citationId: string;
  title: string;
  nodes: LawNode[];
}

/** Mirrors the scraper server's `RetrieveReferencesDto`. */
export interface LawReferencesParams {
  documentId: string;
  direction?: 'outgoing' | 'incoming' | 'all';
  referenceType?: string;
}

/** Mirrors the scraper server's `ReferenceItemDto`. */
export interface LawReferenceItem {
  id: string;
  sourceDocumentId: string | null;
  sourceCitationId: string | null;
  sourceTitle: string | null;
  targetDocumentId: string | null;
  targetCitationId: string | null;
  targetTitle: string | null;
  referenceType: string;
  changeType: string | null;
  rawCitationText: string;
  createdAt: string;
}

/** Mirrors the scraper server's `RetrieveReferencesResponseDto`. */
export interface LawReferencesResult {
  citationId: string;
  title: string;
  total: number;
  references: LawReferenceItem[];
}
