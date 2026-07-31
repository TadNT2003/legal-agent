import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchDocumentsDto } from '../dto/search-documents.dto';
import { SearchDocumentsResponseDto } from '../dto/search-documents-response.dto';
import { RetrieveNodeDto } from '../dto/retrieve-node.dto';
import { RetrieveNodeResponseDto } from '../dto/retrieve-node-response.dto';
import { RetrieveService } from './retrieve.service';

@ApiTags('law-index-retrieve')
@Controller('laws/index/retrieve')
export class RetrieveController {
  constructor(private readonly service: RetrieveService) {}

  @ApiOperation({
    summary:
      'Search locally synced documents in the Postgres database — read-only, searches stored records',
    description:
      "A subset of the crawl-search endpoint's filters, applied to already-synced rows instead of live " +
      'vbpl.vn results: keyword (matches title or citation), documentTypes, issuingBodies, validityStatus, ' +
      'and the issued/effective date ranges. `documentGroups`, `searchScope`, `exactPhrase`, and the ' +
      '`expiredFrom`/`expiredTo` range are accepted (same shared DTO as the crawl endpoint) but silently ' +
      "ignored here — there's no persisted equivalent of vbpl.vn's document-group categorization or " +
      'expiry date to filter on yet, and keyword search always matches title+citation regardless of ' +
      'searchScope/exactPhrase. An unrecognized `validityStatus` value is also silently ignored (matches ' +
      'every status) rather than an error or zero results — confirmed live, worth knowing before relying on ' +
      "it. The response's `expiryDate` field is always null for the same reason. Only returns documents " +
      'that have already been synced via POST /laws/index/crawl/url or POST /laws/index/crawl/all.',
  })
  @ApiOkResponse({ type: SearchDocumentsResponseDto })
  @Get()
  search(@Query() dto: SearchDocumentsDto) {
    return this.service.search(dto);
  }

  @ApiOperation({
    summary: 'Retrieve document nodes (clauses) and their full text',
    description:
      'Returns the structural tree (Phần/Chương/Mục/Tiểu mục/Điều/Khoản/Điểm/Phụ lục) ' +
      'for a synced document. Filter by `nodeType` (e.g. "dieu") combined with `number` ' +
      '(e.g. "31" for "Điều 31", "2" for "Khoản 2"), or `nodeId` for a specific node. ' +
      'Each returned node includes `fullText` — the reconstructed vbpl.vn-style text ' +
      "including the node's own label, heading, content, and all descendant text " +
      'recursively. Without filters, returns the full document tree.',
  })
  @ApiOkResponse({ type: RetrieveNodeResponseDto })
  @Get('nodes')
  async retrieveNode(@Query() dto: RetrieveNodeDto) {
    return this.service.retrieveNode(dto);
  }
}
