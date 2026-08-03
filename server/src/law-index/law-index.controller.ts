import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBadGatewayResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BatchSyncDocumentDto } from './crawl/dto/batch-sync-document.dto';
import { SearchDocumentsDto } from './crawl/dto/search-documents.dto';
import { SearchDocumentsResponseDto } from './dto/search-documents-response.dto';
import { SearchSyncDocumentsDto } from './crawl/dto/search-sync-documents.dto';
import { SearchSyncDocumentsResponseDto } from './crawl/dto/search-sync-documents-response.dto';
import { SyncAllDto } from './crawl/dto/sync-all.dto';
import { SyncDocumentDto } from './crawl/dto/sync-document.dto';
import { SyncDocumentResponseDto } from './crawl/dto/sync-document-response.dto';
import {
  UpdateDocumentByUrlResultDto,
  UpdateDocumentByUrlErrorDto,
} from './crawl/dto/update-document-by-url-response.dto';
import { SyncSummaryResponseDto } from './crawl/dto/sync-summary-response.dto';
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
    summary: 'Update an existing document from vbpl.vn URL',
    description:
      'Scrapes the vbpl.vn document detail page (same as POST /crawl/url), ' +
      'looks up the document in the local index by citationId, and updates it ' +
      'in place if the content has changed (content_version differs). Does NOT ' +
      'create new documents — returns 404 if the citation is not found in the ' +
      'local index. Relations, text references, and node tree are also refreshed ' +
      'on update.',
  })
  @ApiOkResponse({ type: UpdateDocumentByUrlResultDto })
  @ApiBadRequestResponse({
    type: UpdateDocumentByUrlErrorDto,
    description:
      'No matching document found in the local index for the citation extracted from the vbpl.vn page.',
  })
  @ApiBadGatewayResponse({
    description:
      'vbpl.vn failed to load or render the page (network error, timeout, or unexpected DOM shape).',
  })
  @Put('crawl/url')
  async updateDocumentByUrl(@Body() dto: SyncDocumentDto) {
    const result = await this.service.updateDocumentByUrl(dto.url);
    if ('message' in result) {
      throw new BadRequestException(result);
    }
    return result;
  }

  @ApiOperation({
    summary: 'Crawl and sync a batch of documents from vbpl.vn URLs',
    description:
      'Same as POST /laws/index/crawl/url, for up to 100 vbpl.vn document ' +
      'detail page URLs at once. Per-URL failures are collected into `errors` ' +
      'rather than aborting the whole batch. After processing all URLs, a ' +
      'cleanup pass heals any dangling document_reference rows.',
  })
  @ApiCreatedResponse({ type: SyncSummaryResponseDto })
  @Post('crawl/batch')
  syncDocumentsBatch(@Body() dto: BatchSyncDocumentDto) {
    return this.service.syncDocumentsBatch(dto.urls.map((u) => u.url));
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
  @ApiOkResponse({ type: SearchDocumentsResponseDto })
  @ApiBadGatewayResponse({
    description:
      'vbpl.vn failed to load or render the search page (network error, timeout, or unexpected DOM shape).',
  })
  @Get('crawl/search')
  search(@Query() dto: SearchDocumentsDto) {
    return this.service.searchDocuments(dto);
  }

  @ApiOperation({
    summary: 'Search vbpl.vn and sync matched documents into Postgres',
    description:
      'Combines the vbpl.vn filter search with automatic sync. Searches vbpl.vn/van-ban/trung-uong ' +
      'using the same filters as GET /laws/index/crawl/search, then syncs each matched document ' +
      'into Postgres (document upsert, vbpl.vn relations, text-based reference extraction, node tree ' +
      'sync, and dangling reference healing). Per-document failures are collected into `errors` rather ' +
      'than aborting the batch. Use `maxResults` to cap how many documents to sync, and `dryRun=true` ' +
      'to only return search results without syncing.',
  })
  @ApiOkResponse({ type: SearchSyncDocumentsResponseDto })
  @ApiBadGatewayResponse({
    description:
      'vbpl.vn failed to load or render the search page (network error, timeout, or unexpected DOM shape).',
  })
  @Post('crawl/search')
  searchAndSync(@Body() dto: SearchSyncDocumentsDto) {
    return this.service.searchAndSyncDocuments(dto);
  }
}
