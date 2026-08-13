// Domain shapes this module produces from vanban.chinhphu.vn — mirrors
// crawl/vbpl-document.interface.ts's Raw.../Parsed... split, scoped down to
// what vanban.chinhphu.vn actually exposes on its document detail page.

/**
 * vanban.chinhphu.vn's own detail-page attributes. Per
 * docs/plan/law-index-plan.md's Context section (the reasoning for choosing
 * vbpl.vn as the primary DB-ingestion source instead of this site): no
 * "Tình trạng hiệu lực" (validity status) field, no curated relationship
 * graph, and — unlike vbpl.vn's "Nội dung" tab — no server-rendered full
 * text at all, only downloadable PDF/DOC/RTF attachments. signerName/
 * signerTitle are a partial exception — "Người ký" IS present on the real
 * page (confirmed live) and gets extracted, unlike the rest of this
 * interface's `null`-typed fields, which reflect a genuine ceiling on what
 * this site exposes at all. Kept as explicit `string | null`-typed fields
 * (not omitted), so this shape stays structurally comparable to
 * crawl/vbpl-document.interface.ts's ParsedVbplAttributes wherever both
 * might be consumed generically.
 */
export interface ChinhPhuAttributes {
  citation: string;
  documentType: string;
  issuingBody: string;
  /** DD/MM/YYYY — see download/vanban-chinh-phu.parser.ts's normalizeDate. */
  issuedDateRaw: string | null;
  /** "Người ký" — confirmed present on vanban.chinhphu.vn's own detail page (unlike industry/field/effectiveDate/expiryDate/validityStatus below, which genuinely aren't). */
  signerName: string | null;
  /** "Chức danh" — read the same way as signerName, but not confirmed present on any real document seen so far; see download/parsed-law-document.interface.ts's own comment on this field. */
  signerTitle: string | null;
  industry: null;
  field: null;
  effectiveDateRaw: null;
  expiryDateRaw: null;
  validityStatusRaw: null;
}

export interface ParsedChinhPhuDocument {
  sourceUrl: string;
  title: string;
  attributes: ChinhPhuAttributes;
  /**
   * Null until a document-processing tool extracts it from
   * attachmentFileUrls via the DOCUMENT_TEXT_EXTRACTOR port (see
   * document-text-extractor.ts) — that tool is still under evaluation (see
   * sandbox/extract-tool-resilience, sandbox/text-extract-evaluation) and
   * isn't wired in yet. A document with null fullText is persisted with
   * indexScope='metadata_only' and no document_node tree; once fullText is
   * populated, it feeds crawl/document-node.parser.ts the same way a
   * vbpl.vn document's fullText does. See chinhphu-crawl.service.ts.
   */
  fullText: string | null;
  /** How fullText (if non-null) was produced, e.g. a future 'docling-vlm' — null while fullText is null. */
  extractionMethod: string | null;
  /** Direct download URLs for the "Toàn văn"/"Tệp đính kèm" links vanban.chinhphu.vn's own detail page carries — the input to DOCUMENT_TEXT_EXTRACTOR. */
  attachmentFileUrls: string[];
}
