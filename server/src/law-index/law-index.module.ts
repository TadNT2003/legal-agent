import { Module } from '@nestjs/common';
import { VbplClientService } from './crawl/vbpl-client.service';
import { VbplSitemapService } from './crawl/vbpl-sitemap.service';
import { DbModule } from './persistence/db.module';
import { DocumentRepository } from './persistence/document.repository';
import { LawIndexController } from './law-index.controller';
import { LawIndexService } from './law-index.service';

/**
 * Workflow B: production DB ingestion (vbpl.vn -> Postgres), kept fully
 * separate from LawModule's workflow A (vanban.chinhphu.vn -> laws/ raw-file
 * corpus, no DB) — see the law-index plan's Context section for why the two
 * are deliberately decoupled, not meant to reconcile with each other.
 */
@Module({
  imports: [DbModule],
  controllers: [LawIndexController],
  providers: [
    VbplClientService,
    VbplSitemapService,
    DocumentRepository,
    LawIndexService,
  ],
  exports: [LawIndexService],
})
export class LawIndexModule {}
