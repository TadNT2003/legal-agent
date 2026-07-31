import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { SearchDocumentsResponseDto } from '../dto/search-documents-response.dto';
import { RetrieveNodeDto } from '../dto/retrieve-node.dto';
import { RetrieveNodeResponseDto } from '../dto/retrieve-node-response.dto';
import { RetrieveSearchDto } from '../dto/retrieve-search.dto';
import { RetrieveService } from './retrieve.service';

@ApiTags('law-index')
@Controller('laws/index/retrieve')
export class RetrieveController {
  constructor(private readonly service: RetrieveService) {}

  @ApiOperation({
    summary: 'Search locally synced documents',
    description:
      'Read-only search against the local Postgres database. Only returns documents ' +
      'previously synced via `POST /laws/index/crawl/url` or `POST /laws/index/crawl/all`. ' +
      'All provided filters are combined with AND logic. ' +
      '\n\n' +
      '**Text search** — `keyword` is matched against fields determined by `searchScope`: ' +
      '"tieu-de" (default) searches `title` AND `citation`; ' +
      '"so-hieu" searches `citation` only; ' +
      '"noi-dung" searches the full document text. ' +
      'Set `exactPhrase=true` for exact substring match (no wildcards). ' +
      '\n\n' +
      '**Structural filters** — `documentTypes`, `issuingBodies`, and `validityStatus` ' +
      'each act as an `IN` / `eq` filter on their respective columns. ' +
      'An unrecognized `validityStatus` value is silently ignored. ' +
      '\n\n' +
      '**Date ranges** — `issuedFrom`/`issuedTo` filter `enactedDate`, ' +
      '`effectiveFrom`/`effectiveTo` filter `effectiveDate`. Either bound can stand alone. ' +
      '\n\n' +
      '**Note**: `documentGroups` and `expiredFrom`/`expiredTo` are not accepted by this endpoint ' +
      '(use `GET /laws/index/crawl/search` for vbpl.vn live search which supports them).',
  })
  @ApiOkResponse({ type: SearchDocumentsResponseDto })
  @Get()
  search(@Query() dto: RetrieveSearchDto) {
    return this.service.search(dto);
  }

  @ApiOperation({
    summary: 'Retrieve document nodes (clauses) and full text',
    description:
      'Returns the structural clause tree for a synced document: ' +
      'Phần → Chương → Mục → Tiểu mục → Điều → Khoản → Điểm / Phụ lục. ' +
      '\n\n' +
      '**Filtering modes** (mutually exclusive): ' +
      '\n- No filters: returns all root nodes (complete document tree). ' +
      '\n- `nodeType` + `number`: returns nodes of the given type with the given ordinal ' +
      '(e.g. nodeType=dieu & number=31 → "Điều 31" and its subtree). ' +
      '\n- `nodeId`: returns the single node and its subtree by UUID. ' +
      '\n\n' +
      'Each node includes `fullText` — the reconstructed vbpl.vn-style text ' +
      'containing the node\'s label, heading, own content, and all descendant text recursively.',
  })
  @ApiParam({
    name: 'documentId',
    required: true,
    type: String,
    description: 'Document UUID (from `GET /laws/index/retrieve` results or crawl sync).',
    example: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
  })
  @ApiOkResponse({ type: RetrieveNodeResponseDto })
  @Get('nodes')
  async retrieveNode(@Query() dto: RetrieveNodeDto) {
    return this.service.retrieveNode(dto);
  }
}
