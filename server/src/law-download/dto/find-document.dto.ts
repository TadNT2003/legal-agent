import { IsDateString, IsOptional, IsString } from 'class-validator';

export class FindDocumentDto {
  @IsOptional()
  @IsString()
  citation?: string;

  /** Closest match by title — no need for an exact match. */
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
