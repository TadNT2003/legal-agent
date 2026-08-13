import { Module } from '@nestjs/common';
import { VanBanChinhPhuClientService } from '../download/vanban-chinh-phu-client.service';
import { ChinhPhuDocumentRepository } from '../persistence/chinhphu-document.repository';
import { DbModule } from '../persistence/db.module';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { DocumentRepository } from '../persistence/document.repository';
import { ChinhPhuCrawlController } from './chinhphu-crawl.controller';
import { ChinhPhuCrawlService } from './chinhphu-crawl.service';
import {
  DOCUMENT_TEXT_EXTRACTOR,
  NullDocumentTextExtractor,
} from './document-text-extractor';

/**
 * Skeleton DB-ingestion module for vanban.chinhphu.vn as a SUPPLEMENTARY
 * source alongside crawl/ (vbpl.vn, the primary source — see
 * docs/plan/law-index-plan.md's Context section on why vbpl.vn was chosen
 * over this site in the first place). Reuses download/'s
 * VanBanChinhPhuClientService + vanban-chinh-phu.parser.ts for the actual
 * HTTP/HTML layer (same page vanban.chinhphu.vn serves either way) rather
 * than forking a second client — provided here as its own instance, same
 * pattern as DocumentRepository/DocumentNodeRepository being re-provided in
 * every top-level module that needs them (see crawl.module.ts, retrieve
 * .module.ts), not exported/shared from download/'s own module. Provides
 * its own ChinhPhuDocumentRepository (persistence/) instead of extending
 * DocumentRepository, which is tightly coupled to vbpl.vn-specific
 * reasoning (citation-collision handling, relation types, content-version
 * hashing) that doesn't apply here.
 *
 * DOCUMENT_TEXT_EXTRACTOR is the extension point for a future
 * document-processing tool (an OCR/VLM pipeline, still under evaluation in
 * sandbox/extract-tool-resilience and sandbox/text-extract-evaluation,
 * outside this worktree) — swap NullDocumentTextExtractor for a real
 * implementation once one exists. Until then every synced document is
 * persisted with indexScope='metadata_only' and no document_node tree (see
 * chinhphu-crawl.service.ts).
 */
@Module({
  imports: [DbModule],
  controllers: [ChinhPhuCrawlController],
  providers: [
    VanBanChinhPhuClientService,
    DocumentRepository,
    DocumentNodeRepository,
    ChinhPhuDocumentRepository,
    ChinhPhuCrawlService,
    { provide: DOCUMENT_TEXT_EXTRACTOR, useClass: NullDocumentTextExtractor },
  ],
  exports: [ChinhPhuCrawlService],
})
export class CrawlChinhPhuModule {}
