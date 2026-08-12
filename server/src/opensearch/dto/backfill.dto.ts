import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class BackfillDto {
  @ApiPropertyOptional({
    description:
      'Maximum number of documents to process in this call. Omit to run to the end of the corpus.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Resume from this document.id (exclusive) — the keyset pagination cursor from a previous call. Ignored when documentIds is set.',
  })
  @IsOptional()
  @IsUUID('4')
  afterDocumentId?: string;

  @ApiPropertyOptional({
    description:
      'Backfill exactly these document IDs, ignoring limit/afterDocumentId (max 500).',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  documentIds?: string[];
}
