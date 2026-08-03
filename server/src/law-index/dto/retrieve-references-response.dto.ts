import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReferenceItemDto {
  @ApiProperty({ description: 'Reference UUID.' })
  id: string;

  @ApiPropertyOptional({
    description:
      'Source document UUID (the document initiating the reference).',
    nullable: true,
  })
  sourceDocumentId: string | null;

  @ApiPropertyOptional({
    description: 'Source document citation ID.',
    nullable: true,
  })
  sourceCitationId: string | null;

  @ApiPropertyOptional({
    description: 'Source document title.',
    nullable: true,
  })
  sourceTitle: string | null;

  @ApiPropertyOptional({
    description:
      'Target document UUID (the document being referenced). Null if target was unresolved at scrape time.',
    nullable: true,
  })
  targetDocumentId: string | null;

  @ApiPropertyOptional({
    description: 'Target document citation ID.',
    nullable: true,
  })
  targetCitationId: string | null;

  @ApiPropertyOptional({
    description: 'Target document title.',
    nullable: true,
  })
  targetTitle: string | null;

  @ApiProperty({
    description:
      'Type of reference: cites, amends, repeals, corrects, implements, guides, has_basis, explains, promulgates, defines_term.',
    example: 'amends',
  })
  referenceType: string;

  @ApiPropertyOptional({
    description:
      'Specific change type for amends references: replace, suspend_execution, suspend_effect.',
    nullable: true,
  })
  changeType: string | null;

  @ApiProperty({
    description: 'Raw citation text as displayed on vbpl.vn.',
    example: 'Nghị định 78/2025/NĐ-CP',
  })
  rawCitationText: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 timestamp when the reference was created.',
  })
  createdAt: string;
}

export class RetrieveReferencesResponseDto {
  @ApiProperty({
    description: 'Document citation identifier.',
  })
  citationId: string;

  @ApiProperty({
    description: 'Document title.',
  })
  title: string;

  @ApiProperty({
    description: 'Total number of references matching the query.',
  })
  total: number;

  @ApiProperty({
    type: [ReferenceItemDto],
  })
  references: ReferenceItemDto[];
}
