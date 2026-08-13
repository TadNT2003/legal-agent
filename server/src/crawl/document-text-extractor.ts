import { Injectable } from '@nestjs/common';

export interface ExtractedDocumentText {
  fullText: string | null;
  extractionMethod: string | null;
}

/**
 * The pluggable "document processing tool" the vanban.chinhphu.vn side of
 * crawl/ is a skeleton for. vanban.chinhphu.vn, unlike vbpl.vn, exposes no
 * server-rendered full text — only downloadable PDF/DOC/RTF attachments
 * (see chinhphu-document.interface.ts) — so producing a document_node tree
 * for a chinhphu-sourced document requires first running those attachments
 * through an OCR/VLM extraction step. That step is still being evaluated
 * (see sandbox/extract-tool-resilience and sandbox/text-extract-evaluation,
 * outside this worktree) and deliberately isn't wired in yet:
 * NullDocumentTextExtractor is a no-op placeholder so the rest of the
 * crawl/persistence pipeline can be built and exercised end-to-end (as
 * metadata_only documents, see document.schema.ts's indexScope column)
 * before that evaluation concludes. Swap the DOCUMENT_TEXT_EXTRACTOR
 * provider in crawl.module.ts for a real implementation once one exists.
 */
export interface DocumentTextExtractor {
  extractText(fileUrls: string[]): Promise<ExtractedDocumentText>;
}

export const DOCUMENT_TEXT_EXTRACTOR = Symbol('DOCUMENT_TEXT_EXTRACTOR');

@Injectable()
export class NullDocumentTextExtractor implements DocumentTextExtractor {
  extractText(fileUrls: string[]): Promise<ExtractedDocumentText> {
    void fileUrls;
    return Promise.resolve({ fullText: null, extractionMethod: null });
  }
}
