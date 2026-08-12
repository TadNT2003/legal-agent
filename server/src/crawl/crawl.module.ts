import { Module } from '@nestjs/common';
import { VbplClientService } from './vbpl-client.service';
import { VbplSitemapService } from './vbpl-sitemap.service';

/**
 * vbpl.vn crawling primitives — a real headless-browser client
 * (VbplClientService) and static-XML sitemap discovery (VbplSitemapService),
 * consumed by LawIndexService via LawIndexModule. The only DI providers in
 * this folder; document-node.parser.ts/vbpl.parser.ts are pure/DI-free and
 * DTOs/interfaces are imported directly wherever needed, so none of them
 * are registered here.
 */
@Module({
  providers: [VbplClientService, VbplSitemapService],
  exports: [VbplClientService, VbplSitemapService],
})
export class CrawlModule {}
