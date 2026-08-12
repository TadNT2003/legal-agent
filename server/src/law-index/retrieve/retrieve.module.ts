import { Module } from '@nestjs/common';
import { DbModule } from '../../persistence/db.module';
import { DocumentNodeRepository } from '../../persistence/document-node.repository';
import { DocumentRepository } from '../../persistence/document.repository';
import { RetrieveController } from './retrieve.controller';
import { RetrieveService } from './retrieve.service';

@Module({
  imports: [DbModule],
  controllers: [RetrieveController],
  providers: [DocumentRepository, DocumentNodeRepository, RetrieveService],
  exports: [RetrieveService],
})
export class RetrieveModule {}
