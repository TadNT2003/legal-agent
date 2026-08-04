import { ApiProperty } from '@nestjs/swagger';

export class BatchUpdateNotFoundDto {
  @ApiProperty({
    description: 'The document URL whose citation was not found.',
  })
  url: string;

  @ApiProperty({
    description: 'Citation ID extracted from the vbpl.vn page.',
    example: '99/9999/QH99',
  })
  citationId: string;

  @ApiProperty({
    description: 'Error message explaining why the update was rejected.',
  })
  message: string;
}

export class BatchUpdateSummaryResponseDto {
  @ApiProperty({
    description: 'Total URLs submitted in the batch.',
  })
  totalUrls: number;

  @ApiProperty({
    description:
      'Documents successfully updated (content_version differed and was written).',
  })
  updated: number;

  @ApiProperty({
    description:
      'Documents found but skipped because content_version was unchanged.',
  })
  unchanged: number;

  @ApiProperty({
    description:
      'Total healed dangling reference rows across all update passes.',
  })
  healedReferences: number;

  @ApiProperty({
    type: [BatchUpdateNotFoundDto],
    description:
      'URLs whose citation was not found in the local index (not created).',
  })
  notFound: BatchUpdateNotFoundDto[];

  @ApiProperty({
    type: [String],
    description:
      'Per-URL failures — network errors, vbpl.vn render failures, etc.',
  })
  errors: Array<{ url: string; error: string }>;
}
