import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChinhPhuCrawlService } from './chinhphu-crawl.service';
import { FallbackSearchService } from './fallback-search.service';
import { FallbackSearchQueryDto } from './dto/fallback-search-query.dto';
import { FallbackSearchResponseDto } from './dto/fallback-search-response.dto';
import { SyncChinhPhuDocumentDto } from './dto/sync-chinhphu-document.dto';
import { SyncChinhPhuDocumentResponseDto } from './dto/sync-chinhphu-document-response.dto';

@ApiTags('crawl-chinhphu')
@Controller()
export class ChinhPhuCrawlController {
  constructor(
    private readonly service: ChinhPhuCrawlService,
    private readonly fallbackSearch: FallbackSearchService,
  ) {}

  @ApiOperation({
    summary:
      'Sync one document from vanban.chinhphu.vn into Postgres (skeleton, supplementary source)',
    description:
      'Supplementary source alongside vbpl.vn (see POST /crawl/url) — fetches a vanban.chinhphu.vn document ' +
      'detail page and upserts its metadata. vanban.chinhphu.vn exposes no server-rendered full text (only ' +
      'downloadable PDF/DOC/RTF attachments), so today every document is persisted with indexScope=' +
      '"metadata_only" and no document_node tree, until a document-processing tool is wired into ' +
      'DOCUMENT_TEXT_EXTRACTOR (see document-text-extractor.ts). Never overwrites a document already indexed ' +
      'under the same citation from another source.',
  })
  @ApiCreatedResponse({ type: SyncChinhPhuDocumentResponseDto })
  @ApiBadGatewayResponse({
    description:
      'vanban.chinhphu.vn failed to load the page, or the page has no recognizable "Số ký hiệu".',
  })
  @Post('crawl-chinhphu/url')
  syncDocument(@Body() dto: SyncChinhPhuDocumentDto) {
    return this.service.syncDocument(dto.url);
  }

  @ApiOperation({
    summary:
      'Search vbpl.vn first, falling back to vanban.chinhphu.vn only on zero matches',
    description:
      "Read-only discovery, mirroring GET /crawl/search's contract — returns candidates with a sourceUrl " +
      "usable as POST /crawl/url or POST /crawl-chinhphu/url's `url`, does not sync anything itself. Scoped " +
      "to the 3 filter dimensions both sites' search UIs actually share (keyword, issuing body, issuing " +
      "year) — see FallbackSearchService's own doc comment for why the rest of each site's filter set is " +
      'excluded. vanban.chinhphu.vn is only queried when vbpl.vn genuinely has nothing for these filters ' +
      "(zero matches, or a BadRequestException from an issuingBody name vbpl.vn's own sidebar doesn't " +
      'recognize as a filter) — a vbpl.vn outage (BadGatewayException) or an in-progress crawl holding its ' +
      'browser lock (ConflictException) is NOT treated as "no results" and propagates as an error instead.',
  })
  @ApiOkResponse({ type: FallbackSearchResponseDto })
  @ApiBadGatewayResponse({
    description:
      'Either site failed to load or render its search page (network error, timeout, or unexpected page shape).',
  })
  @Get('crawl-chinhphu/search-fallback')
  searchWithFallback(@Query() dto: FallbackSearchQueryDto) {
    return this.fallbackSearch.search(dto);
  }
}
