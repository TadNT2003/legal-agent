import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListDanglingRefsDto {
  @ApiPropertyOptional({
    description: 'Filter by source document UUID.',
    example: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
  })
  @IsOptional()
  @IsString()
  sourceDocumentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by reference type.',
    enum: [
      'cites',
      'amends',
      'repeals',
      'corrects',
      'implements',
      'guides',
      'has_basis',
      'explains',
      'promulgates',
      'defines_term',
    ],
  })
  @IsOptional()
  @IsString()
  referenceType?: string;

  @ApiPropertyOptional({
    description: 'Filter by raw citation text substring (case-insensitive).',
    example: '78/2025',
  })
  @IsOptional()
  @IsString()
  rawCitationText?: string;
}
