import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchDocumentsDto } from '../dto/search-documents.dto';
import { SearchDocumentsResponseDto } from '../dto/search-documents-response.dto';
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
}
