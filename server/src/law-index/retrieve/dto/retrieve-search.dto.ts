import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import type { VbplSearchScope } from '../../../crawl/vbpl-document.interface';

const SEARCH_SCOPES: VbplSearchScope[] = ['noi-dung', 'tieu-de', 'so-hieu'];
const DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/;
const DATE_MESSAGE = 'must be a dd/mm/yyyy date';

/** Same as {@link toArray} in search-documents.dto.ts — querystring binding
 * collapses single repeatable keys to bare strings. */
function toArray({ value }: { value: unknown }): unknown {
  if (value === undefined) return value;
  return Array.isArray(value) ? value : [value];
}

/**
 * Filter DTO for local DB search only. Omits `documentGroups` and
 * `expiredFrom`/`expiredTo` which have no persisted data to filter against.
 * Use {@link SearchDocumentsDto} for the crawl endpoint which passes all
 * parameters through to vbpl.vn.
 */
export class RetrieveSearchDto {
  @ApiPropertyOptional({
    description: 'Free-text keyword ("Nhập từ khóa tìm kiếm").',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description:
      'Which field the keyword is matched against. ' +
      '"tieu-de" (default) matches title+citation, "so-hieu" matches citation only, "noi-dung" matches full text.',
    enum: SEARCH_SCOPES,
  })
  @IsOptional()
  @IsIn(SEARCH_SCOPES)
  searchScope?: VbplSearchScope;

  @ApiPropertyOptional({
    description:
      '"Chính xác cụm từ trên" — match the keyword as an exact phrase instead of a substring.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  exactPhrase?: boolean;

  @ApiPropertyOptional({
    description: '"Cơ quan ban hành" filter, e.g. ["Bộ Tư pháp"].',
    type: [String],
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  issuingBodies?: string[];

  @ApiPropertyOptional({
    description: '"Hình thức văn bản" filter, e.g. ["Luật", "Nghị định"].',
    type: [String],
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  documentTypes?: string[];

  @ApiPropertyOptional({
    description:
      '"Tình trạng hiệu lực" filter, e.g. "Còn hiệu lực", "Hết hiệu lực toàn bộ".',
  })
  @IsOptional()
  @IsString()
  validityStatus?: string;

  @ApiPropertyOptional({
    description: '"Ngày ban hành" range start, dd/mm/yyyy.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  issuedFrom?: string;

  @ApiPropertyOptional({
    description: '"Ngày ban hành" range end, dd/mm/yyyy.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  issuedTo?: string;

  @ApiPropertyOptional({
    description: '"Ngày có hiệu lực" range start, dd/mm/yyyy.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  effectiveFrom?: string;

  @ApiPropertyOptional({
    description: '"Ngày có hiệu lực" range end, dd/mm/yyyy.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  effectiveTo?: string;

  @ApiPropertyOptional({
    description: 'Page number.',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Results per page.',
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
