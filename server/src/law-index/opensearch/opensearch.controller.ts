import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BackfillDto } from './dto/backfill.dto';
import { BackfillResponseDto } from './dto/backfill-response.dto';
import { IndexStatusResponseDto } from './dto/index-status-response.dto';
import { PromoteAliasesDto } from './dto/promote-aliases.dto';
import { ReprojectDto } from './dto/reproject.dto';
import { SearchProvisionsDto } from './dto/search-provisions.dto';
import { SearchProvisionsResponseDto } from './dto/search-provisions-response.dto';
import { IndexAdminService } from './index-admin.service';
import { OpenSearchService } from './opensearch.service';

@ApiTags('law-index')
@Controller('laws/index/opensearch')
export class OpenSearchController {
  constructor(
    private readonly indexAdminService: IndexAdminService,
    private readonly openSearchService: OpenSearchService,
  ) {}

  @ApiOperation({
    summary: 'Create the legal-provisions index',
    description:
      'Creates the concrete index for the current config version with mappings, ' +
      'analysis settings, and both read/write aliases attached in one call. ' +
      'Idempotent — a no-op if the index already exists.',
  })
  @ApiOkResponse({
    description: '{ created: boolean, index: string }',
  })
  @Put('index')
  ensureIndex() {
    return this.indexAdminService.ensureIndex();
  }

  @ApiOperation({
    summary: 'Index status',
    description:
      'Alias->index resolution, cluster health, and document count — the manual ' +
      'stand-in for the not-yet-built CDC reconciliation job.',
  })
  @ApiOkResponse({ type: IndexStatusResponseDto })
  @Get('status')
  getStatus() {
    return this.indexAdminService.getStatus();
  }

  @ApiOperation({
    summary: 'Backfill provisions from Postgres',
    description:
      'Projects document_node rows into OpenSearch documents and bulk-indexes ' +
      'them through the write alias. Iterates the whole corpus keyset-paginated ' +
      'on document.id unless documentIds is given. A single long-running, ' +
      'synchronous call by design — the corpus is small enough that a full ' +
      'backfill takes minutes, not hours.',
  })
  @ApiOkResponse({ type: BackfillResponseDto })
  @Post('backfill')
  backfill(@Body() dto: BackfillDto) {
    return this.openSearchService.backfill(dto);
  }

  @ApiOperation({
    summary: 'Reproject one document',
    description:
      'Re-indexes a single document by documentId or citation. Deletes every ' +
      'previously-indexed provision for that document first, since ' +
      'document_node.id is regenerated on every content-changed re-sync — ' +
      'without this, a re-scrape would orphan the old provisions rather than ' +
      'replace them.',
  })
  @ApiOkResponse({
    description:
      '{ documentId, citationId, provisionsIndexed, templatePhuLucSkipped }',
  })
  @Post('reproject')
  reprojectDocument(@Body() dto: ReprojectDto) {
    return this.openSearchService.reprojectDocument(dto);
  }

  @ApiOperation({
    summary: 'Blue/green alias promotion',
    description:
      'Atomically moves both read/write aliases onto targetVersion’s concrete ' +
      'index in one `_aliases` call, so readers never see a moment with neither ' +
      'alias set.',
  })
  @ApiOkResponse({ description: '{ index, readAlias, writeAlias }' })
  @Patch('aliases')
  promoteAliases(@Body() dto: PromoteAliasesDto) {
    return this.indexAdminService.promoteAliases(dto.targetVersion);
  }

  @ApiOperation({
    summary: 'Drop a retired index',
    description:
      'Refuses if the index is still attached to the read or write alias — ' +
      'promote aliases off it first.',
  })
  @ApiOkResponse({ description: 'No content on success.' })
  @Delete('index/:version')
  dropIndex(@Param('version', ParseIntPipe) version: number) {
    return this.indexAdminService.dropIndexVersion(version);
  }

  @ApiOperation({
    summary: 'Search provisions',
    description:
      'multi_match against heading/body plus a nested khoan clause with ' +
      'inner_hits, filtered to currently-valid provisions. A verification ' +
      'endpoint for v1, not the RAG retrieval API.',
  })
  @ApiOkResponse({ type: SearchProvisionsResponseDto })
  @Post('search')
  search(@Body() dto: SearchProvisionsDto) {
    return this.openSearchService.search(dto);
  }
}
