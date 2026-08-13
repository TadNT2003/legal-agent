import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class FallbackSearchQueryDto {
  @ApiPropertyOptional({
    description:
      'Free-text keyword — matched against vbpl.vn\'s "Tiêu đề" search first, then vanban.chinhphu.vn\'s "Từ khóa" search if the fallback triggers.',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description:
      'Exact "Cơ quan ban hành" display name, e.g. "Bộ Tư pháp". Matched against vbpl.vn\'s sidebar checkbox labels first; only resolved against vanban.chinhphu.vn\'s own org dropdown if the fallback actually triggers — dropped (not failed) if that resolution is ambiguous.',
    example: 'Bộ Tư pháp',
  })
  @IsOptional()
  @IsString()
  issuingBody?: string;

  @ApiPropertyOptional({
    description:
      'A 4-digit issuing year — expanded to a full-year date range for vbpl.vn (which has no single-year filter), passed through as-is to vanban.chinhphu.vn (which does).',
    example: '2020',
  })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'issuedYear must be a 4-digit year' })
  issuedYear?: string;

  @ApiPropertyOptional({
    description:
      "Upper bound on vanban.chinhphu.vn results if the fallback triggers. Does not bound the vbpl.vn-side check, which always looks at that site's own default first page.",
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(500)
  maxResults?: number;
}
