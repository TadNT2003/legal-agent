import { Module, forwardRef } from '@nestjs/common';
import { DbModule } from '../persistence/db.module';
import { DocumentRepository } from '../persistence/document.repository';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { CrawlController } from './crawl.controller';
import { CrawlService } from './crawl.service';
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
  ],
  exports: [VbplClientService, VbplSitemapService, CrawlService],
})
export class CrawlModule {}
