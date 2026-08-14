import type { ParsedLawDocument } from '../download/parsed-law-document.interface';
import type {
  ChinhPhuAttributes,
  ParsedChinhPhuDocument,
} from './chinhphu-document.interface';
import type { ExtractedDocumentText } from './document-text-extractor';

/**
 * Turns download/'s ParsedLawDocument — already scraped off
 * vanban.chinhphu.vn's detail page by VanBanChinhPhuClientService +
 * parseDocumentDetailPage, see chinhphu-crawl.service.ts — into the domain
 * shape this module persists. Pure, DI-free, mirrors crawl/vbpl.parser.ts's
 * parseAttributes: fails loud on a document missing a field this module
 * cannot persist without (documentType/issuingBody — document.schema.ts has
 * both NOT NULL), rather than guessing, same posture as vbpl.parser.ts's
 * parseAttributes.
 */
export function parseChinhPhuDocument(
  raw: ParsedLawDocument,
  extracted: ExtractedDocumentText,
): ParsedChinhPhuDocument {
  if (!raw.docType) {
    throw new Error(
      `vanban.chinhphu.vn document "${raw.citation}" has no "Loại văn bản" — cannot index it without a document type.`,
    );
  }
  if (!raw.issuingBody) {
    throw new Error(
      `vanban.chinhphu.vn document "${raw.citation}" has no "Cơ quan ban hành" — cannot index it without an issuing body.`,
    );
  }

  const attributes: ChinhPhuAttributes = {
    citation: raw.citation,
    documentType: raw.docType,
    issuingBody: raw.issuingBody,
    issuedDateRaw: raw.date,
    signerName: raw.signerName,
    signerTitle: raw.signerTitle,
    industry: null,
    field: null,
    effectiveDateRaw: null,
    expiryDateRaw: null,
    validityStatusRaw: null,
  };

  return {
    sourceUrl: raw.sourceUrl,
    title: raw.title,
    attributes,
    fullText: extracted.fullText,
    extractionMethod: extracted.extractionMethod,
    attachmentFileUrls: raw.fileUrls,
  };
}
