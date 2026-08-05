// Raw shapes extracted straight from the rendered DOM by vbpl-client.service.ts
// (via page.evaluate()) — deliberately dumb, no interpretation yet. vbpl.parser.ts
// turns these into the typed shapes below.
export interface RawAttributeEntry {
  label: string;
  value: string;
}

export interface RawRelationSection {
  /** The rendered card heading, e.g. "Văn bản được thay thế (1)" — count still embedded. */
  categoryLabel: string;
  /** Raw title text of each linked document; the "--" empty-state placeholder is already excluded. */
  entries: string[];
}

export type VbplScope = 'trung-uong' | 'dia-phuong' | 'unknown';

/** Everything vbpl-client.service.ts extracts for one document across its 3 tab loads. */
export interface RawVbplPage {
  sourceUrl: string;
  scope: VbplScope;
  /**
   * The full "Loại văn bản + số + trích yếu" title string, e.g. "Thông tư số
   * 05/2026/TT-BNG Hướng dẫn dịch Quốc hiệu...". vbpl.vn has no separate
   * title field on the attributes ("Thuộc tính") tab — this is read from the
   * breadcrumb's last item, which is also how relation entries render other
   * documents' titles (see vbpl.parser.ts's extractCitationFromTitle).
   */
  title: string;
  fullText: string;
  attributes: RawAttributeEntry[];
  relations: RawRelationSection[];
}

// ---- Parsed / domain shapes (vbpl.parser.ts output) ----

export interface ParsedVbplAttributes {
  citation: string;
  documentType: string;
  industry: string | null;
  field: string | null;
  issuingBody: string;
  signerTitle: string | null;
  signerName: string | null;
  issuedDateRaw: string | null;
  effectiveDateRaw: string | null;
  expiryDateRaw: string | null;
  /** Null when vbpl.vn's own attributes tab has no "Tình trạng hiệu lực" row
   * at all — confirmed live on some very-recently-issued documents (an
   * upstream data gap, not a scrape failure). */
  validityStatusRaw: string | null;
}

/** Canonical reference_type values this module writes — see law-index plan's Persistence section. */
export type VbplReferenceType =
  | 'cites'
  | 'amends'
  | 'repeals'
  | 'corrects'
  | 'implements'
  | 'guides'
  | 'has_basis'
  | 'explains'
  | 'promulgates';

export type VbplChangeType =
  'replace' | 'suspend_execution' | 'suspend_effect' | null;

export interface VbplRelation {
  referenceType: VbplReferenceType;
  changeType: VbplChangeType;
  /** true if this document is the source of the edge, false if it's the target. */
  thisDocIsSource: boolean;
  /** Raw title text of the other document, as rendered (used for citation extraction + audit trail). */
  otherDocRawText: string;
  /** Citation extracted from otherDocRawText via regex, e.g. "03/2009/TT-BNG" — null if none could be found. */
  otherDocCitation: string | null;
}

/** Consolidation ("hợp nhất") is tracked separately — it's a document-level flag/FK
 * in the schema, not a document_reference row (see plan's Persistence section). */
export interface VbplConsolidation {
  /** This document is itself a hợp nhất of these other documents. */
  consolidatesRawTitles: string[];
  /** This document has been consolidated into these other (hợp nhất) documents. */
  consolidatedIntoRawTitles: string[];
}

export interface ParsedVbplDocument {
  sourceUrl: string;
  scope: VbplScope;
  title: string;
  fullText: string;
  attributes: ParsedVbplAttributes;
  relations: VbplRelation[];
  consolidation: VbplConsolidation;
}

// ---- Search (targeted/filtered search against /van-ban/trung-uong) ----

export type VbplSearchScope = 'noi-dung' | 'tieu-de' | 'so-hieu';

/**
 * Sidebar/advanced-panel filter labels are passed through verbatim as the
 * exact strings vbpl.vn's own checkboxes/dropdown render (e.g. "Luật",
 * "Bộ Tư pháp", "Còn hiệu lực") rather than mapped to an enum — the "Cơ quan
 * ban hành" list alone has 90+ entries that change as the site adds
 * agencies. An unrecognized label fails fast with a clear error instead of
 * silently matching nothing (see vbpl-client.service.ts).
 */
export interface VbplSearchFilters {
  keyword?: string;
  searchScope?: VbplSearchScope;
  exactPhrase?: boolean;
  /** "Nhóm văn bản" sidebar checkboxes, e.g. "Văn bản quy phạm pháp luật". */
  documentGroups?: string[];
  /** "Cơ quan ban hành" sidebar checkboxes, e.g. "Bộ Tư pháp". */
  issuingBodies?: string[];
  /** "Hình thức văn bản" sidebar checkboxes, e.g. "Luật", "Nghị định". */
  documentTypes?: string[];
  /** "Tình trạng hiệu lực" advanced-panel dropdown, e.g. "Còn hiệu lực". */
  validityStatus?: string;
  /** dd/mm/yyyy */
  issuedFrom?: string;
  issuedTo?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  expiredFrom?: string;
  expiredTo?: string;
  page?: number;
  pageSize?: number;
}

/**
 * One item from the search endpoint's underlying JSON payload — a Next.js
 * Server Action response the real browser triggers by submitting the filter
 * form. Read via the resulting network response rather than DOM-scraped:
 * result cards render with no href/id in the DOM, only a client-side click
 * handler (confirmed live — see vbpl-client.service.ts's searchDocuments).
 * Field names/casing match the wire payload as-is.
 */
export interface RawVbplSearchItem {
  id: string;
  title: string;
  docNum: string;
  docType: { name: string } | null;
  issueDate: string | null;
  effFrom: string | null;
  effTo: string | null;
  effStatus: { name: string } | null;
  agencyName: string;
}

export interface RawVbplSearchResponse {
  total: number;
  pageNumber: number;
  pageSize: number;
  items: RawVbplSearchItem[];
}

export interface VbplSearchResultItem {
  sourceUrl: string;
  citation: string;
  title: string;
  documentType: string;
  issuingBody: string;
  issuedDate: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  validityStatus: string;
}

export interface VbplSearchResult {
  total: number;
  page: number;
  pageSize: number;
  items: VbplSearchResultItem[];
}
