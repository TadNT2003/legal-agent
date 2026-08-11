import { Module } from '@nestjs/common';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { DocumentRepository } from '../persistence/document.repository';
import { DbModule } from '../persistence/db.module';
import { IndexAdminService } from './index-admin.service';
import { OpenSearchController } from './opensearch.controller';
import { OpensearchClientModule } from './opensearch-client.module';
import { OpenSearchService } from './opensearch.service';

/**
 * Not yet imported into LawIndexModule/AppModule — opensearchProjectorConfig
 * still needs adding to AppModule's ConfigModule.forRoot({load}) first (see
 * docs/plan/opensearch-projector-plan.md's "Files to modify"), deferred
 * alongside that wiring until Phase 0's document_node gate passes.
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
