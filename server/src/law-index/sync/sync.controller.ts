import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SyncRefsByCitationDto } from './dto/sync-refs-by-citation.dto';
import { SyncRefsByCitationResponseDto } from './dto/sync-refs-response.dto';
import { SyncRefsAllResponseDto } from './dto/sync-refs-all-response.dto';
import { SyncService } from './sync.service';

@ApiTags('law-index')
@Controller('laws/index/sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @ApiOperation({
    summary: 'Sync document references by resolving dangling refs for a given citation',
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
  @Post('refs/document')
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
  @Post('refs/all')
  healAllDanglingRefs() {
    return this.service.healAllDanglingRefs();
  }
}