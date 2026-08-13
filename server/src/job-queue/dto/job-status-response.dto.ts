import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class JobStatusResponseDto {
  @ApiProperty({ example: '1' })
  jobId: string;

  @ApiProperty({
    description:
      "BullMQ job state, e.g. 'waiting', 'active', 'completed', 'failed'.",
    example: 'active',
  })
  status: string;

  @ApiPropertyOptional({
    description:
      '"discovering" while an unbounded crawlAll job\'s sitemap enumeration is still in progress and ' +
      'total is not yet known; "syncing" once it is (immediately, for jobs with a known total up front). ' +
      'Null before the first progress update.',
    enum: ['discovering', 'syncing'],
    nullable: true,
    example: 'syncing',
  })
  phase: 'discovering' | 'syncing' | null;

  @ApiPropertyOptional({
    description:
      'Percent complete, 0-100. Null while total is unknown — see phase.',
    nullable: true,
    example: 45,
  })
  progress: number | null;

  @ApiProperty({ description: 'Documents processed so far.', example: 90 })
  processed: number;

  @ApiPropertyOptional({
    description:
      'Total documents this job will process. Null while unknown — see phase.',
    nullable: true,
    example: 200,
  })
  total: number | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-06T09:00:00.000Z' })
  createdAt: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-08-06T09:00:01.000Z' })
  startedAt: string | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  completedAt: string | null;

  @ApiPropertyOptional({
    description:
      'SyncSummary, BatchUpdateSummary, or the search-and-sync summary shape, depending on job type. ' +
      'Present only once status is "completed".',
    type: Object,
    nullable: true,
  })
  result: object | null;

  @ApiPropertyOptional({
    description: 'Error message. Present only once status is "failed".',
    nullable: true,
  })
  failedReason: string | null;
}
