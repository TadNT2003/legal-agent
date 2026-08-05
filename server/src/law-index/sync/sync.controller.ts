import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ListDanglingRefsDto } from './dto/list-dangling-refs.dto';
import { ListDanglingRefsResponseDto } from './dto/list-dangling-refs-response.dto';
import { ReExtractTextRefsDto } from './dto/re-extract-text-refs.dto';
import { ReExtractTextRefsResponseDto } from './dto/re-extract-text-refs-response.dto';
import { SyncRefsBulkByCitationDto } from './dto/sync-refs-bulk-by-citation.dto';
import { SyncRefsBulkByCitationResponseDto } from './dto/sync-refs-bulk-by-citation-response.dto';
import { SyncRefsByCitationDto } from './dto/sync-refs-by-citation.dto';
import { SyncRefsByCitationResponseDto } from './dto/sync-refs-response.dto';
import { SyncRefsAllResponseDto } from './dto/sync-refs-all-response.dto';
import { SyncService } from './sync.service';

@ApiTags('law-index')
@Controller('laws/index/sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @ApiOperation({
    summary:
      'Sync document references by resolving dangling refs for a given citation',
    description:
      'Finds the document matching the given citation ID, then resolves all ' +
      'document_reference rows that point to this document but have a null ' +
      'target_document_id (dangling references created when the referencing ' +
      'document was scraped before this one existed). Returns details of each ' +
      'healed reference. Does not scrape vbpl.vn — operates entirely on ' +
      'existing Postgres data.',
  })
  @ApiCreatedResponse({ type: SyncRefsByCitationResponseDto })
  @ApiNotFoundResponse({
    description: 'No document found with the given citation ID.',
  })
  @Patch('refs/document')
  syncRefsByCitation(@Body() dto: SyncRefsByCitationDto) {
    return this.service.syncRefsByCitation(dto.citation);
  }

  @ApiOperation({
    summary: 'Heal all dangling document references',
    description:
      'Scans the entire document_reference table for rows where ' +
      'target_document_id IS NULL, attempts to resolve each one by extracting ' +
      'the citation from raw_citation_text and looking up the document in ' +
      'Postgres. Returns details of all healed references. Does not scrape ' +
      'vbpl.vn — operates entirely on existing Postgres data.',
  })
  @ApiOkResponse({ type: SyncRefsAllResponseDto })
  @Patch('refs/all')
  healAllDanglingRefs() {
    return this.service.healAllDanglingRefs();
  }

  @ApiOperation({
    summary: 'Bulk heal dangling references for multiple citations',
    description:
      'Accepts an array of citation IDs, resolves dangling document_reference ' +
      'rows for each citation in a single pass. Unlike PATCH /refs/document ' +
      '(single citation) and PATCH /refs/all (global), this targets a specific ' +
      'set of citations. Each citation is resolved independently — a missing ' +
      'citation produces an error entry rather than aborting the batch. Does ' +
      'not scrape vbpl.vn — operates entirely on existing Postgres data.',
  })
  @ApiCreatedResponse({ type: SyncRefsBulkByCitationResponseDto })
  @Patch('refs/batch')
  syncRefsBulkByCitation(@Body() dto: SyncRefsBulkByCitationDto) {
    return this.service.syncRefsBulkByCitation(dto.citations);
  }

  @ApiOperation({
    summary: 'Re-extract text-based references for a document',
    description:
      'Re-runs the text-based citation extraction (preamble "Căn cứ" lines ' +
      'and inline body citations) for an existing document using its stored ' +
      "raw_source fullText. Inserts any new references that don't already " +
      'exist — useful when a document was scraped before text extraction ' +
      'logic existed or was improved, and new target documents have since ' +
      'been indexed. Returns the count of newly inserted references. Does ' +
      'not scrape vbpl.vn — operates entirely on existing Postgres data.',
  })
  @ApiCreatedResponse({ type: ReExtractTextRefsResponseDto })
  @ApiNotFoundResponse({
    description: 'Document not found.',
  })
  @Post('refs/extract')
  reExtractTextRefs(@Body() dto: ReExtractTextRefsDto) {
    return this.service.reExtractTextRefs(dto.documentId);
  }

  @ApiOperation({
    summary: 'List dangling (unresolved) document references',
    description:
      'Returns document_reference rows where target_document_id IS NULL, ' +
      'optionally filtered by source document, reference type, or raw citation ' +
      'text substring. Read-only — does not modify any data. Useful for ' +
      'auditing unresolved references before running a heal.',
  })
  @ApiOkResponse({ type: ListDanglingRefsResponseDto })
  @Get('refs/dangling')
  listDanglingRefs(@Query() dto: ListDanglingRefsDto) {
    return this.service.listDanglingRefs(dto);
  }
}
