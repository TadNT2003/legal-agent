import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class FindDocumentDto {
  @ApiPropertyOptional({
    description:
      'Exact citation, e.g. "45/2019/QH14". Takes priority over `title` if both are given.',
    example: '45/2019/QH14',
  })
  @IsOptional()
  @IsString()
  citation?: string;

  /** Closest match by title — no need for an exact match. */
  @ApiPropertyOptional({
    description:
      'Closest fuzzy match by title — no need for an exact match. Ignored if `citation` is given.',
    example: 'Bo luat Lao dong',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Only consider documents dated on or after this date.',
    example: '2015-01-01',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Only consider documents dated on or before this date.',
    example: '2020-12-31',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
