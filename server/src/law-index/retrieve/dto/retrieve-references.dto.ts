import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export const REFERENCE_TYPE_OPTIONS = [
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
] as const;

export class RetrieveReferencesDto {
  @ApiProperty({
    description: 'Document UUID to retrieve references for.',
  })
  @IsUUID('4')
  documentId: string;

  @ApiPropertyOptional({
    description:
      'Direction of references. "outgoing" returns references where the document is the source. ' +
      '"incoming" returns references where the document is the target. "all" returns both.',
    enum: ['outgoing', 'incoming', 'all'],
    default: 'outgoing',
  })
  @IsOptional()
  @IsIn(['outgoing', 'incoming', 'all'])
  direction?: 'outgoing' | 'incoming' | 'all';

  @ApiPropertyOptional({
    description: 'Filter by reference type, e.g. "amends", "repeals", "cites".',
    enum: REFERENCE_TYPE_OPTIONS,
  })
  @IsOptional()
  @IsIn(REFERENCE_TYPE_OPTIONS)
  referenceType?: string;
}
