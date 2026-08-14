import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * A verification endpoint for v1 (plan §"Decisions taken"), not the RAG
 * retrieval API — validity/status filters are fixed to §3d's shape
 * (currently-valid provisions only), not parameterized here.
 */
export class SearchProvisionsDto {
  @ApiProperty({
    description:
      'Free-text query, matched against heading/body and nested khoan text.',
  })
  @IsString()
  query: string;

  @ApiPropertyOptional({ description: 'Page number.', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Results per page.', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
