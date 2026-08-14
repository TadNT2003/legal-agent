import { Module, forwardRef } from '@nestjs/common';
import { VanBanChinhPhuClientService } from '../download/vanban-chinh-phu-client.service';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { ChinhPhuDocumentRepository } from '../persistence/chinhphu-document.repository';
import { DbModule } from '../persistence/db.module';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { DocumentRepository } from '../persistence/document.repository';
import { ChinhPhuCrawlService } from './chinhphu-crawl.service';
import { ChinhPhuSearchService } from './chinhphu-search.service';
import { CrawlController } from './crawl.controller';
import { CrawlService } from './crawl.service';
import {
  DOCUMENT_TEXT_EXTRACTOR,
  NullDocumentTextExtractor,
} from './document-text-extractor';
import { FallbackSearchService } from './fallback-search.service';
import { VbplClientService } from './vbpl-client.service';
import { VbplSitemapService } from './vbpl-sitemap.service';

/**
 * vbpl.vn crawling primitives (VbplClientService — real headless-browser
 * client; VbplSitemapService — static-XML sitemap discovery) PLUS the
 * scrape-and-sync orchestration layer (CrawlService/CrawlController) that
 * used to live under a separate `law-index/` umbrella module, now fully
 * dismantled — merged here since crawl/ already owned every DTO these
 * endpoints use and lawIndexConfig (now crawlConfig) had no real consumers
 * outside VbplClientService/VbplSitemapService in the first place.
 * document-node.parser.ts/vbpl.parser.ts are pure/DI-free and DTOs/
 * interfaces are imported directly wherever needed, so none of them are
 * registered here.
 *
 * Also owns vanban.chinhphu.vn as a SUPPLEMENTARY source (formerly a
 * separate `crawl-chinhphu/` module, now fully dismantled the same way
 * `law-index/` was — see git history) — ChinhPhuCrawlService (POST
 * /crawl/chinhphu/url) and ChinhPhuSearchService + FallbackSearchService
 * (which GET /crawl/search now calls instead of CrawlService.
 * searchDocuments directly, falling back to vanban.chinhphu.vn on zero
 * vbpl.vn matches — see fallback-search.service.ts). Reuses download/'s
 * VanBanChinhPhuClientService for the HTTP/HTML layer (same page
 * vanban.chinhphu.vn serves either way) rather than forking a second
 * client, provided here as its own instance per the same pattern
 * DocumentRepository/DocumentNodeRepository already use — not
 * exported/shared from download/'s own module. ChinhPhuDocumentRepository
 * (persistence/) stays separate from DocumentRepository, which is tightly
 * coupled to vbpl.vn-specific reasoning (citation-collision handling,
 * relation types, content-version hashing) that doesn't apply to
 * vanban.chinhphu.vn. DOCUMENT_TEXT_EXTRACTOR is the extension point for a
 * future document-processing tool (an OCR/VLM pipeline, still under
 * evaluation in sandbox/extract-tool-resilience and
 * sandbox/text-extract-evaluation, outside this worktree) — swap
 * NullDocumentTextExtractor for a real implementation once one exists.
 *
 * Imports JobQueueModule via forwardRef — CrawlController submits/polls/
 * cancels jobs through JobQueueService, and JobWorkerService (inside
 * JobQueueModule) calls back into CrawlService to actually run them, a
 * genuine two-way dependency (see job-queue.module.ts's own comment).
 */
@Module({
  imports: [DbModule, forwardRef(() => JobQueueModule)],
  controllers: [CrawlController],
  providers: [
    VbplClientService,
    VbplSitemapService,
    DocumentRepository,
    DocumentNodeRepository,
    CrawlService,
    VanBanChinhPhuClientService,
    ChinhPhuDocumentRepository,
    ChinhPhuCrawlService,
    ChinhPhuSearchService,
    FallbackSearchService,
    { provide: DOCUMENT_TEXT_EXTRACTOR, useClass: NullDocumentTextExtractor },
  ],
  exports: [VbplClientService, VbplSitemapService, CrawlService],
})
export class CrawlModule {}
