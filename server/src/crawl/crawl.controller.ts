import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBadGatewayResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BatchSyncDocumentDto } from './dto/batch-sync-document.dto';
import { FallbackSearchResponseDto } from './dto/fallback-search-response.dto';
import { ForceUpdateDto } from './dto/force-update.dto';
import { SearchDocumentsDto } from './dto/search-documents.dto';
import { SearchSyncDocumentsDto } from './dto/search-sync-documents.dto';
import { SearchSyncDocumentsResponseDto } from './dto/search-sync-documents-response.dto';
import { SyncAllDto } from './dto/sync-all.dto';
import { SyncChinhPhuDocumentDto } from './dto/sync-chinhphu-document.dto';
import { SyncChinhPhuDocumentResponseDto } from './dto/sync-chinhphu-document-response.dto';
import { SyncDocumentDto } from './dto/sync-document.dto';
import { SyncDocumentResponseDto } from './dto/sync-document-response.dto';
import {
  UpdateDocumentByUrlResultDto,
  UpdateDocumentByUrlErrorDto,
} from './dto/update-document-by-url-response.dto';
import { CancelJobResponseDto } from '../job-queue/dto/cancel-job-response.dto';
import { JobStatusResponseDto } from '../job-queue/dto/job-status-response.dto';
import { JobSubmittedResponseDto } from '../job-queue/dto/job-submitted-response.dto';
import { JobQueueService } from '../job-queue/job-queue.service';
import { ChinhPhuCrawlService } from './chinhphu-crawl.service';
import { CrawlService } from './crawl.service';
import { FallbackSearchService } from './fallback-search.service';

@ApiTags('crawl')
@Controller()
export class CrawlController {
  constructor(
    private readonly service: CrawlService,
    private readonly jobQueue: JobQueueService,
    private readonly chinhPhuCrawl: ChinhPhuCrawlService,
    private readonly fallbackSearch: FallbackSearchService,
  ) {}

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
    summary:
      'Sync one document from vanban.chinhphu.vn into Postgres (supplementary source)',
    description:
      'Supplementary source alongside vbpl.vn (POST /crawl/url, the primary source — see docs/plan/law-' +
      "index-plan.md's Context section on why) — fetches a vanban.chinhphu.vn document detail page and " +
      'upserts its metadata. vanban.chinhphu.vn exposes no server-rendered full text (only downloadable ' +
      'PDF/DOC/RTF attachments), so today every synced document is persisted with indexScope=' +
      '"metadata_only" and no document_node tree, until a document-processing tool is wired into ' +
      'DOCUMENT_TEXT_EXTRACTOR (see document-text-extractor.ts). KNOWN LIMITATION, permanent, not tied to ' +
      'that: vanban.chinhphu.vn has no curated relationship graph the way vbpl.vn\'s "Lược đồ" tab does, so ' +
      'this endpoint never creates document_reference rows in either direction for the documents it syncs — ' +
      "see persistence/chinhphu-document.repository.ts's own comment. Never overwrites a document already " +
      'indexed under the same citation from another source.',
  })
  @ApiCreatedResponse({ type: SyncChinhPhuDocumentResponseDto })
  @ApiBadGatewayResponse({
    description:
      'vanban.chinhphu.vn failed to load the page, or the page has no recognizable "Số ký hiệu".',
  })
  @Post('crawl/chinhphu/url')
  syncChinhPhuDocument(@Body() dto: SyncChinhPhuDocumentDto) {
    return this.chinhPhuCrawl.syncDocument(dto.url);
  }

  @ApiOperation({
    summary: 'Update an existing document from vbpl.vn URL',
    description:
      'Scrapes the vbpl.vn document detail page (same as POST /crawl/url), ' +
      'looks up the document in the local index by citationId, and updates it ' +
      'in place if the content has changed (content_version differs). Does NOT ' +
      'create new documents — returns 404 if the citation is not found in the ' +
      'local index. Relations, text references, and node tree are also refreshed ' +
      'on update. Pass `?force=true` to re-write the row even when ' +
      'content_version is unchanged — see the `force` parameter.',
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
  async updateDocumentByUrl(
    @Body() dto: SyncDocumentDto,
    @Query() query: ForceUpdateDto,
  ) {
    const result = await this.service.updateDocumentByUrl(
      dto.url,
      query.force ?? false,
    );
    if ('message' in result) {
      throw new BadRequestException(result);
    }
    return result;
  }

  @ApiOperation({
    summary: 'Update a batch of existing documents from vbpl.vn URLs (async)',
    description:
      'Same as PUT /crawl/url, for up to 100 vbpl.vn document ' +
      'detail page URLs at once — submitted as a background job rather than run ' +
      'inline (see docs/plan/scraper-resilience-plan.md), since a full batch can ' +
      'take much longer than a single request should stay open. Poll ' +
      'GET /jobs/:jobId for status/progress/result. Only updates ' +
      'documents that already exist in the local index by citationId — does NOT ' +
      'create new documents. Per-URL failures and not-found citations are ' +
      'collected in the eventual result rather than failing the job. After ' +
      'processing all URLs, a cleanup pass heals any dangling document_reference ' +
      'rows. Pass `?force=true` to re-write rows whose content_version is ' +
      'unchanged (backfilling a newly added column); with it set, `unchanged` is ' +
      'always 0 and every URL costs a full re-scrape, so keep forced batches small.',
  })
  @ApiCreatedResponse({ type: JobSubmittedResponseDto })
  @Put('crawl/batch')
  async updateDocumentsBatch(
    @Body() dto: BatchSyncDocumentDto,
    @Query() query: ForceUpdateDto,
  ): Promise<JobSubmittedResponseDto> {
    const { jobId } = await this.jobQueue.addJob({
      type: 'crawlUpdateBatch',
      urls: dto.urls.map((u) => u.url),
      force: query.force ?? false,
    });
    return {
      jobId,
      status: 'pending',
      message: 'Job submitted. Poll GET /jobs/:jobId for status.',
    };
  }

  @ApiOperation({
    summary: 'Crawl and sync a batch of documents from vbpl.vn URLs (async)',
    description:
      'Same as POST /crawl/url, for up to 100 vbpl.vn document ' +
      'detail page URLs at once — submitted as a background job rather than run ' +
      'inline (see docs/plan/scraper-resilience-plan.md). Poll ' +
      'GET /jobs/:jobId for status/progress/result. Per-URL failures ' +
      "are collected into the eventual result's `errors` rather than failing " +
      'the job. After processing all URLs, a cleanup pass heals any dangling ' +
      'document_reference rows.',
  })
  @ApiCreatedResponse({ type: JobSubmittedResponseDto })
  @Post('crawl/batch')
  async syncDocumentsBatch(
    @Body() dto: BatchSyncDocumentDto,
  ): Promise<JobSubmittedResponseDto> {
    const { jobId } = await this.jobQueue.addJob({
      type: 'crawlBatch',
      urls: dto.urls.map((u) => u.url),
    });
    return {
      jobId,
      status: 'pending',
      message: 'Job submitted. Poll GET /jobs/:jobId for status.',
    };
  }

  @ApiOperation({
    summary:
      'Crawl the trung-ương sitemap and sync every document found (async)',
    description:
      'Discovers document URLs from vbpl.vn/sitemap.xml — the block between the "Trung ương" and "Địa ' +
      'phương" XML comment markers only — and calls the single-document sync for each one, then re-resolves ' +
      'any document_reference rows left dangling from earlier calls. Submitted as a background job rather ' +
      'than run inline (see docs/plan/scraper-resilience-plan.md) — poll GET /jobs/:jobId for ' +
      "status/progress/result. Per-URL failures are collected into the eventual result's `errors` rather " +
      'than failing the job. Pass a small `limit` for a smoke test; without one, progress reports ' +
      '`total: null` for the whole run since the true total is not known until the crawl itself is done ' +
      '(sitemap enumeration is interleaved with syncing, not a separate upfront step).',
  })
  @ApiCreatedResponse({ type: JobSubmittedResponseDto })
  @Post('crawl/all')
  async crawl(@Body() dto: SyncAllDto): Promise<JobSubmittedResponseDto> {
    const { jobId } = await this.jobQueue.addJob({
      type: 'crawlAll',
      limit: dto.limit,
    });
    return {
      jobId,
      status: 'pending',
      message: 'Job submitted. Poll GET /jobs/:jobId for status.',
    };
  }

  @ApiOperation({
    summary:
      'Targeted/filtered search against vbpl.vn — falls back to vanban.chinhphu.vn on zero matches, read-only, does not sync',
    description:
      'Mirrors vbpl.vn\'s own "Bộ lọc" sidebar (Nhóm văn bản / Cơ quan ban hành / Hình thức văn bản ' +
      'checkboxes) and "Tìm kiếm nâng cao" advanced panel (Tình trạng hiệu lực + date ranges) by driving ' +
      'the real filter UI via a headless browser, then reads the resulting matches off the network response ' +
      "the site's own search action produces (result cards have no href/id in the DOM to scrape). If vbpl.vn " +
      'returns zero matches for these filters (or rejects an unrecognized issuingBody value), falls back to ' +
      'a read-only search against vanban.chinhphu.vn using the subset of these filters it can express — ' +
      'keyword, the first issuingBody, and a year derived from issuedFrom/issuedTo (see ' +
      'FallbackSearchService; the rest of this endpoint\'s filters, and vanban.chinhphu.vn\'s own "Lĩnh vực" ' +
      'filter, have no counterpart on the other site and are dropped for that fallback query only). Returns ' +
      "a { source, result } envelope — result carries each match's metadata plus a sourceUrl directly " +
      "usable as either document-sync endpoint's `url` (POST /crawl/url for vbpl.vn matches, POST " +
      '/crawl/chinhphu/url for vanban.chinhphu.vn ones) — this endpoint itself only searches, it never ' +
      'persists anything.',
  })
  @ApiOkResponse({ type: FallbackSearchResponseDto })
  @ApiBadGatewayResponse({
    description:
      'Either site failed to load or render its search page (network error, timeout, or unexpected page shape).',
  })
  @Get('crawl/search')
  search(@Query() dto: SearchDocumentsDto) {
    return this.fallbackSearch.search(dto);
  }

  @ApiOperation({
    summary:
      'Search vbpl.vn and sync matched documents into Postgres (async unless dryRun)',
    description:
      'Combines the vbpl.vn filter search with automatic sync. Searches vbpl.vn/van-ban/trung-uong ' +
      'using the same filters as GET /crawl/search, then syncs each matched document ' +
      'into Postgres (document upsert, vbpl.vn relations, text-based reference extraction, node tree ' +
      'sync, and dangling reference healing). With `dryRun=true` (the search-only case), this stays ' +
      "synchronous and returns results directly, since no scraping happens. Otherwise it's submitted as " +
      'a background job (see docs/plan/scraper-resilience-plan.md) — poll GET /jobs/:jobId ' +
      "for status/progress/result. Per-document failures are collected into the eventual result's " +
      '`errors` rather than failing the job. Use `maxResults` to cap how many documents to sync.',
  })
  @ApiOkResponse({
    description: 'Only when dryRun=true — search results, no sync performed.',
    type: SearchSyncDocumentsResponseDto,
  })
  @ApiCreatedResponse({
    description: 'Only when dryRun is not true — job submitted.',
    type: JobSubmittedResponseDto,
  })
  @ApiBadGatewayResponse({
    description:
      'vbpl.vn failed to load or render the search page (network error, timeout, or unexpected DOM shape).',
  })
  @Post('crawl/search')
  async searchAndSync(@Body() dto: SearchSyncDocumentsDto) {
    if (dto.dryRun) {
      return this.service.searchAndSyncDocuments(dto);
    }
    const { jobId } = await this.jobQueue.addJob({
      type: 'searchAndSync',
      filters: dto,
    });
    return {
      jobId,
      status: 'pending',
      message: 'Job submitted. Poll GET /jobs/:jobId for status.',
    };
  }

  @ApiOperation({
    summary: 'Get the status, progress, and (if completed) result of a job',
    description:
      'Polls a job submitted by one of the async crawl endpoints ' +
      '(POST /crawl/all, POST/PUT /crawl/batch, POST /crawl/search). See ' +
      'docs/plan/scraper-resilience-plan.md for the status/progress shape.',
  })
  @ApiOkResponse({ type: JobStatusResponseDto })
  @ApiNotFoundResponse({ description: 'No job found with this id.' })
  @Get('jobs/:jobId')
  async getJob(@Param('jobId') jobId: string): Promise<JobStatusResponseDto> {
    const status = await this.jobQueue.getJob(jobId);
    if (!status) {
      throw new NotFoundException(`No job found with id "${jobId}"`);
    }
    return status;
  }

  @ApiOperation({
    summary: 'Cancel a pending job',
    description:
      'Removes a job that has not started yet. A job already being processed ' +
      'cannot be cancelled (returns result: "already-running") — worker ' +
      'concurrency is 1, so at most one job is ever active at a time.',
  })
  @ApiOkResponse({ type: CancelJobResponseDto })
  @Post('jobs/:jobId/cancel')
  async cancelJob(
    @Param('jobId') jobId: string,
  ): Promise<CancelJobResponseDto> {
    const result = await this.jobQueue.cancelJob(jobId);
    return { jobId, result };
  }
}
