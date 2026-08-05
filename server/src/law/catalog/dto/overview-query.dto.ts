import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class OverviewQueryDto {
  @ApiPropertyOptional({
    description: 'Scope to a single tier (1-14). Omit for all-tier overview.',
    example: 2,
    minimum: 1,
    maximum: 14,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(14)
  tier?: number;
}
