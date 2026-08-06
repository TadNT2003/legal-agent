import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class PromoteAliasesDto {
  @ApiProperty({
    description:
      'Index version to atomically move both read/write aliases onto (e.g. 2 for legal_provisions_v2) — the blue/green swap.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  targetVersion: number;
}
