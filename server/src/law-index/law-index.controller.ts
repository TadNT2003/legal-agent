import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SyncAllDto } from './dto/sync-all.dto';
import { SyncDocumentDto } from './dto/sync-document.dto';
import { LawIndexService } from './law-index.service';

@ApiTags('law-index')
@Controller('law-index')
export class LawIndexController {
  constructor(private readonly service: LawIndexService) {}

  @ApiOperation({
    summary: 'Sync one document from vbpl.vn into Postgres',
    description:
      'Scrapes a vbpl.vn document detail page (all 3 tabs) and upserts it — document, issuing_body, ' +
      'document_reference rows. Skips (without erroring) if the page turns out to be địa phương scope.',
  })
  @Post('sync/document')
  syncDocument(@Body() dto: SyncDocumentDto) {
    return this.service.syncDocument(dto.url);
  }

  @ApiOperation({
    summary: 'Crawl the trung-ương sitemap and sync every document found',
    description:
      'Discovers document URLs from vbpl.vn/sitemap.xml (trung-ương block only) and syncs each one. ' +
      'Pass a small `limit` for a smoke test — see the endpoint DTO for why an unbounded crawl is not yet recommended.',
  })
  @Post('sync')
  syncAll(@Body() dto: SyncAllDto) {
    return this.service.syncAll({ limit: dto.limit });
  }
}
