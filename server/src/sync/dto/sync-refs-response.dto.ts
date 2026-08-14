import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncRefsResultItem {
  @ApiProperty({
    description: 'UUID of the document_reference row that was healed.',
  })
  refId: string;

  @ApiProperty({
    description:
      'Source document UUID (the document that holds the reference).',
  })
  sourceDocumentId: string | null;

  @ApiProperty({
    description: 'Source document citation ID.',
    nullable: true,
  })
  sourceCitationId: string | null;

  @ApiProperty({
    description: 'Target document UUID (the document that was just resolved).',
  })
  targetDocumentId: string;

  @ApiProperty({
    description: 'Raw citation text that was used to resolve the reference.',
  })
  rawCitationText: string;

  @ApiPropertyOptional({
    description: 'Reference type.',
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
  referenceType?: string;
}

export class SyncRefsByCitationResponseDto {
  @ApiProperty({
    description: 'Document UUID that was found by the given citation.',
  })
  documentId: string;

  @ApiProperty({
    description: 'Citation ID of the synced document.',
  })
  citationId: string;

  @ApiProperty({
    description: 'Document title.',
  })
  title: string;

  @ApiProperty({
    description:
      'Number of dangling references that were healed (target_document_id NULL rows resolved to this document).',
  })
  healedReferences: number;

  @ApiProperty({
    type: [SyncRefsResultItem],
    description:
      'Details of each healed reference, showing which document referenced this one and how.',
  })
  healed: SyncRefsResultItem[];
}
