import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
import type { VbplSearchScope } from '../crawl/vbpl-document.interface';

const SEARCH_SCOPES: VbplSearchScope[] = ['noi-dung', 'tieu-de', 'so-hieu'];
const DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/;
const DATE_MESSAGE = 'must be a dd/mm/yyyy date';

export class SearchDocumentsDto {
  @ApiPropertyOptional({
    description: 'Free-text keyword ("Nhập từ khóa tìm kiếm").',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description:
      'Which field the keyword is matched against ("Tìm kiếm trong:"). Defaults to vbpl.vn\'s own default, "tieu-de" (Tiêu đề).',
    enum: SEARCH_SCOPES,
  })
  @IsOptional()
  @IsIn(SEARCH_SCOPES)
  searchScope?: VbplSearchScope;

  @ApiPropertyOptional({
    description:
      '"Chính xác cụm từ trên" — match the keyword as an exact phrase.',
  })
  @IsOptional()
  @IsBoolean()
  exactPhrase?: boolean;

  @ApiPropertyOptional({
    description:
      '"Nhóm văn bản" sidebar checkboxes, e.g. ["Văn bản quy phạm pháp luật"]. Must match vbpl.vn\'s current option labels exactly.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentGroups?: string[];

  @ApiPropertyOptional({
    description:
      '"Cơ quan ban hành" sidebar checkboxes, e.g. ["Bộ Tư pháp"]. Must match vbpl.vn\'s current option labels exactly.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  issuingBodies?: string[];

  @ApiPropertyOptional({
    description:
      '"Hình thức văn bản" sidebar checkboxes, e.g. ["Luật", "Nghị định"]. Must match vbpl.vn\'s current option labels exactly.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentTypes?: string[];

  @ApiPropertyOptional({
    description:
      '"Tình trạng hiệu lực" advanced-panel dropdown, e.g. "Còn hiệu lực", "Hết hiệu lực toàn bộ".',
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
    description: '"Ngày hết hiệu lực" range start, dd/mm/yyyy.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  expiredFrom?: string;

  @ApiPropertyOptional({
    description: '"Ngày hết hiệu lực" range end, dd/mm/yyyy.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
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
    description:
      "Results per page, selected from vbpl.vn's own page-size dropdown (typically 10/20/50/100 — an unsupported value fails with a clear error).",
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
