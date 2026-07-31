import { Module } from '@nestjs/common';
import { DbModule } from '../persistence/db.module';
import { DocumentRepository } from '../persistence/document.repository';
import { RetrieveController } from './retrieve.controller';
import { RetrieveService } from './retrieve.service';

@Module({
  imports: [DbModule],
  controllers: [RetrieveController],
  providers: [DocumentRepository, RetrieveService],
  exports: [RetrieveService],
})
export class RetrieveModule {}
