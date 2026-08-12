import { Module } from '@nestjs/common';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { DocumentRepository } from '../persistence/document.repository';
import { DbModule } from '../persistence/db.module';
import { IndexAdminService } from './index-admin.service';
import { OpenSearchController } from './opensearch.controller';
import { OpensearchClientModule } from './opensearch-client.module';
import { OpenSearchService } from './opensearch.service';

/**
 * Registered directly in AppModule (top-level module, not nested under any
 * other domain module) — nothing else in the DI graph injects
 * IndexAdminService/OpenSearchService, so unlike CrawlModule/JobQueueModule
 * there's no forwardRef relationship pulling this in transitively.
 */
@Module({
  imports: [DbModule, OpensearchClientModule],
  controllers: [OpenSearchController],
  providers: [
    DocumentRepository,
    DocumentNodeRepository,
    IndexAdminService,
    OpenSearchService,
  ],
  exports: [IndexAdminService, OpenSearchService],
})
export class OpenSearchModule {}
