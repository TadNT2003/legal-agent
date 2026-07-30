import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SearchDocumentsDto } from './dto/search-documents.dto';
import { SearchDocumentsResponseDto } from './dto/search-documents-response.dto';
import { SyncAllDto } from './dto/sync-all.dto';
import { SyncDocumentDto } from './dto/sync-document.dto';
import { SyncDocumentResponseDto } from './dto/sync-document-response.dto';
import { SyncSummaryResponseDto } from './dto/sync-summary-response.dto';
import { LawIndexService } from './law-index.service';

@ApiTags('law-index')
@Controller('laws/index')
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
  @Post('crawl/url')
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
  @Post('crawl/all')
  crawl(@Body() dto: SyncAllDto) {
    return this.service.syncAll({ limit: dto.limit });
  }

  @ApiOperation({
    summary:
      'Targeted/filtered search against vbpl.vn/van-ban/trung-uong — read-only, does not sync',
    description:
      'Mirrors vbpl.vn\'s own "Bộ lọc" sidebar (Nhóm văn bản / Cơ quan ban hành / Hình thức văn bản ' +
      'checkboxes) and "Tìm kiếm nâng cao" advanced panel (Tình trạng hiệu lực + date ranges) by driving ' +
      'the real filter UI via a headless browser, then reads the resulting matches off the network response ' +
      "the site's own search action produces (result cards have no href/id in the DOM to scrape). Returns " +
      "each match's metadata plus a sourceUrl directly usable as the document-sync endpoint's `url` — this " +
      'endpoint itself only searches, it never persists anything.',
  })
  @ApiCreatedResponse({ type: SearchDocumentsResponseDto })
  @ApiBadGatewayResponse({
    description:
      'vbpl.vn failed to load or render the search page (network error, timeout, or unexpected DOM shape).',
  })
  @Get('crawl/search')
  search(@Query() dto: SearchDocumentsDto) {
    return this.service.searchDocuments(dto);
  }

  @ApiOperation({
    summary:
      'Search locally synced documents in the Postgres database — read-only, searches stored records',
    description:
      'Same filter parameters as the crawl search endpoint (keyword, document types, issuing bodies, ' +
      'validity status, date ranges, pagination) but queries the local database instead of scraping vbpl.vn. ' +
      'Only returns documents that have already been synced via POST /laws/index/crawl/url or POST /laws/index/crawl/all.',
  })
  @ApiCreatedResponse({ type: SearchDocumentsResponseDto })
  @Get('search')
  searchLocal(@Query() dto: SearchDocumentsDto) {
    return this.service.searchLocalDocuments(dto);
  }
}
