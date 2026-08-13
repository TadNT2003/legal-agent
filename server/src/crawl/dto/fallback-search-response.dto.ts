import { ApiProperty } from '@nestjs/swagger';

export class FallbackSearchResponseDto {
  @ApiProperty({
    description:
      'Which source actually served the results: "vbpl.vn" when it had at least one match, "vanban.chinhphu.vn" only when vbpl.vn returned zero (or rejected the filters — see FallbackSearchService.tryVbplSearch).',
    enum: ['vbpl.vn', 'vanban.chinhphu.vn'],
  })
  source: 'vbpl.vn' | 'vanban.chinhphu.vn';

  @ApiProperty({
    description:
      'The winning source\'s own native search result shape — GET /crawl/search\'s response shape when source is "vbpl.vn" (total/page/pageSize/items), or { total, items, issuingBodyUnresolved } when source is "vanban.chinhphu.vn". Deliberately not unified into one lossy common shape.',
    type: 'object',
    additionalProperties: true,
  })
  result: Record<string, unknown>;
}
