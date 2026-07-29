import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  ALLOWED_RECORDS_PER_PAGE,
  DEFAULT_MAX_RESULTS,
  DEFAULT_RECORDS_PER_PAGE,
  MAX_ALLOWED_RESULTS,
} from '../constants';

export class SearchDownloadDto {
  @ApiPropertyOptional({
    description: 'Free-text keyword ("Từ khóa") to search for.',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  /** Value from the "Lĩnh vực" dropdown (drdDocCategory), e.g. "845". */
  @ApiPropertyOptional({
    description:
      'Value from the "Lĩnh vực" dropdown (drdDocCategory), e.g. "845".',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Value from the "Cơ quan ban hành" dropdown (drdDocOrg). */
  @ApiPropertyOptional({
    description: 'Value from the "Cơ quan ban hành" dropdown (drdDocOrg).',
  })
  @IsOptional()
  @IsString()
  orgId?: string;

  @ApiPropertyOptional({
    description: 'A 4-digit year to filter by.',
    example: '2025',
  })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'year must be a 4-digit year' })
  year?: string;

  @ApiPropertyOptional({
    description:
      'Results per page requested from vanban.chinhphu.vn while paginating. ' +
      'The site always renders ~50 rows per response regardless of this ' +
      'value, but a larger value makes its reported total-results count ' +
      'accurate instead of clamped to 50 — so higher is strictly better.',
    enum: ALLOWED_RECORDS_PER_PAGE,
    default: DEFAULT_RECORDS_PER_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(ALLOWED_RECORDS_PER_PAGE)
  recordsPerPage?: number = DEFAULT_RECORDS_PER_PAGE;

  /** Upper bound on how many matching documents to download in this call. */
  @ApiPropertyOptional({
    description:
      'Upper bound on how many matching documents to download in this call.',
    minimum: 1,
    maximum: MAX_ALLOWED_RESULTS,
    default: DEFAULT_MAX_RESULTS,
  })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(MAX_ALLOWED_RESULTS)
  maxResults?: number = DEFAULT_MAX_RESULTS;

  /** When true, only report what would be downloaded — no files are fetched. */
  @ApiPropertyOptional({
    description:
      'When true, only report what would be downloaded — no files are fetched.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = false;

  @ApiPropertyOptional({
    description:
      'Re-download and overwrite even if a matched file already exists on disk.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
