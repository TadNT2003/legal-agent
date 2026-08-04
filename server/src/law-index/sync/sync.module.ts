import { Module } from '@nestjs/common';
import { DbModule } from '../persistence/db.module';
import { DocumentRepository } from '../persistence/document.repository';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [DbModule],
  controllers: [SyncController],
  providers: [DocumentRepository, SyncService],
  exports: [SyncService],
})
export class SyncModule {}