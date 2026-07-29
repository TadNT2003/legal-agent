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
  validityStatusRaw: string;
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
