import { Module, forwardRef } from '@nestjs/common';
import { CrawlModule } from '../crawl/crawl.module';
import { DbModule } from './persistence/db.module';
import { DocumentRepository } from './persistence/document.repository';
import { DocumentNodeRepository } from './persistence/document-node.repository';
import { JobQueueModule } from './job-queue/job-queue.module';
import { LawIndexController } from './law-index.controller';
import { LawIndexService } from './law-index.service';
import { OpenSearchModule } from './opensearch/opensearch.module';
import { RetrieveModule } from './retrieve/retrieve.module';
import { SyncModule } from './sync/sync.module';

/**
 * Workflow B: production DB ingestion (vbpl.vn -> Postgres), kept fully
 * separate from workflow A (vanban.chinhphu.vn -> laws/ raw-file corpus, no
 * DB — server/src/download/, server/src/catalog/, server/src/utils/) — see
 * the law-index plan's Context section for why the two are deliberately
 * decoupled, not meant to reconcile with each other.
 *
 * Imports JobQueueModule via forwardRef — see job-queue.module.ts's own
 * comment for why this is a genuine two-way dependency.
 */
@Module({
  imports: [
    CrawlModule,
    DbModule,
    RetrieveModule,
    SyncModule,
    OpenSearchModule,
    forwardRef(() => JobQueueModule),
  ],
  controllers: [LawIndexController],
  providers: [DocumentRepository, DocumentNodeRepository, LawIndexService],
  exports: [LawIndexService],
})
export class LawIndexModule {}
