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
  MAX_ALLOWED_RESULTS,
} from '../constants';

export class SearchDownloadDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  /** Value from the "Lĩnh vực" dropdown (drdDocCategory), e.g. "845". */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Value from the "Cơ quan ban hành" dropdown (drdDocOrg). */
  @IsOptional()
  @IsString()
  orgId?: string;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'year must be a 4-digit year' })
  year?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn(ALLOWED_RECORDS_PER_PAGE)
  recordsPerPage?: number = ALLOWED_RECORDS_PER_PAGE[0];

  /** Upper bound on how many matching documents to download in this call. */
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(MAX_ALLOWED_RESULTS)
  maxResults?: number = DEFAULT_MAX_RESULTS;

  /** When true, only report what would be downloaded — no files are fetched. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean = false;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
