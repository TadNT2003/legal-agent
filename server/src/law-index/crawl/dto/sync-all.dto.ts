import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class SyncAllDto {
  @ApiPropertyOptional({
    description:
      'Upper bound on how many document URLs to process in this call. Omit for an unbounded crawl — ' +
      'not recommended yet (see law-index plan: no resumable cursor/job-queue exists, so an unbounded ' +
      'call is one very long-running request). Always smoke-test with a small limit first.',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
