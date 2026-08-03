import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const SEARCH_SCOPES = ['noi-dung', 'tieu-de', 'so-hieu'];

function toArray({ value }: { value: unknown }): unknown {
  if (value === undefined) return value;
  return Array.isArray(value) ? value : [value];
}

/**
 * Combines vbpl.vn search filters with an automatic sync-into-Postgres step.
 * Reuses the same filter fields as SearchDocumentsDto (crawl/search GET), but
 * extends with a maxResults cap and dryRun flag for the sync phase.
 */
export class SearchSyncDocumentsDto {
  @ApiPropertyOptional({
    description: 'Free-text keyword ("Nhập từ khóa tìm kiếm").',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description:
      'Which field the keyword is matched against. Defaults to "tieu-de".',
    enum: SEARCH_SCOPES,
  })
  @IsOptional()
  @IsIn(SEARCH_SCOPES)
  searchScope?: 'noi-dung' | 'tieu-de' | 'so-hieu';

  @ApiPropertyOptional({
    description:
      '"Chính xác cụm từ trên" — exact phrase match instead of substring.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  exactPhrase?: boolean;

  @ApiPropertyOptional({
    description:
      '"Nhóm văn bản" sidebar checkboxes. Must match vbpl.vn labels exactly.',
    type: [String],
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  documentGroups?: string[];

  @ApiPropertyOptional({
    description:
      '"Cơ quan ban hành" sidebar checkboxes. Must match vbpl.vn labels exactly.',
    type: [String],
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  issuingBodies?: string[];

  @ApiPropertyOptional({
    description:
      '"Hình thức văn bản" sidebar checkboxes. Must match vbpl.vn labels exactly.',
    type: [String],
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  documentTypes?: string[];

  @ApiPropertyOptional({
    description: '"Tình trạng hiệu lực" dropdown.',
  })
  @IsOptional()
  @IsString()
  validityStatus?: string;

  @ApiPropertyOptional({
    description: '"Ngày ban hành" range start, dd/mm/yyyy.',
  })
  @IsOptional()
  @IsString()
  issuedFrom?: string;

  @ApiPropertyOptional({
    description: '"Ngày ban hành" range end, dd/mm/yyyy.',
  })
  @IsOptional()
  @IsString()
  issuedTo?: string;

  @ApiPropertyOptional({
    description: '"Ngày có hiệu lực" range start, dd/mm/yyyy.',
  })
  @IsOptional()
  @IsString()
  effectiveFrom?: string;

  @ApiPropertyOptional({
    description: '"Ngày có hiệu lực" range end, dd/mm/yyyy.',
  })
  @IsOptional()
  @IsString()
  effectiveTo?: string;

  @ApiPropertyOptional({
    description: '"Ngày hết hiệu lực" range start, dd/mm/yyyy.',
  })
  @IsOptional()
  @IsString()
  expiredFrom?: string;

  @ApiPropertyOptional({
    description: '"Ngày hết hiệu lực" range end, dd/mm/yyyy.',
  })
  @IsOptional()
  @IsString()
  expiredTo?: string;

  @ApiPropertyOptional({
    description:
      "Page number to jump to via the results list's page-jump input.",
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Results per page from vbpl.vn (10/20/50/100).',
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({
    description:
      'Upper bound on how many matching documents to sync into Postgres.',
    minimum: 1,
    maximum: 500,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(500)
  maxResults?: number = 50;

  @ApiPropertyOptional({
    description:
      'When true, only return search results — do not sync into Postgres.',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean = false;
}
