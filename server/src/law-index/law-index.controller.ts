import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SyncAllDto } from './dto/sync-all.dto';
import { SyncDocumentDto } from './dto/sync-document.dto';
import { SyncDocumentResponseDto } from './dto/sync-document-response.dto';
import { SyncSummaryResponseDto } from './dto/sync-summary-response.dto';
import { LawIndexService } from './law-index.service';

@ApiTags('law-index')
@Controller('law-index')
export class LawIndexController {
  constructor(private readonly service: LawIndexService) {}

  @ApiOperation({
    summary: 'Sync one document from vbpl.vn into Postgres',
    description:
      'Scrapes a vbpl.vn document detail page (all 3 tabs — Nội dung, Thuộc tính, Lược đồ) via a headless ' +
      'browser and upserts it: resolves/creates the issuing_body row, upserts the document row (skipped as ' +
      'a no-op if content_version is unchanged since the last sync), and upserts document_reference rows for ' +
      'every relation vbpl.vn reports, resolving each target by citation where possible (left unresolved, ' +
      'not dropped, if the target document has not been scraped yet).',
  })
  @ApiCreatedResponse({ type: SyncDocumentResponseDto })
  @ApiBadGatewayResponse({
    description:
      'vbpl.vn failed to load or render the page (network error, timeout, or unexpected DOM shape).',
  })
  @Post('sync/document')
  syncDocument(@Body() dto: SyncDocumentDto) {
    return this.service.syncDocument(dto.url);
  }

  @ApiOperation({
    summary: 'Crawl the trung-ương sitemap and sync every document found',
    description:
      'Discovers document URLs from vbpl.vn/sitemap.xml — the block between the "Trung ương" and "Địa ' +
      'phương" XML comment markers only — and calls the single-document sync for each one, then re-resolves ' +
      'any document_reference rows left dangling from earlier calls. Per-URL failures are collected into ' +
      '`errors` rather than aborting the batch. Pass a small `limit` for a smoke test — an unbounded crawl ' +
      'is one very long-running request with no resumable cursor yet (see docs/law-index-plan.md).',
  })
  @ApiCreatedResponse({ type: SyncSummaryResponseDto })
  @Post('sync')
  syncAll(@Body() dto: SyncAllDto) {
    return this.service.syncAll({ limit: dto.limit });
  }
}
