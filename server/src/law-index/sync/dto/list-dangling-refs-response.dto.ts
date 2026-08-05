import { ApiProperty } from '@nestjs/swagger';

export class DanglingRefItem {
  @ApiProperty({
    description: 'UUID of the dangling document_reference row.',
  })
  id: string;

  @ApiProperty({
    description: 'Source document UUID (the document that holds the dangling reference).',
    nullable: true,
  })
  sourceDocumentId: string | null;

  @ApiProperty({
    description: 'Source document citation ID.',
    nullable: true,
  })
  sourceCitationId: string | null;

  @ApiProperty({
    description: 'Source document title.',
    nullable: true,
  })
  sourceTitle: string | null;

  @ApiProperty({
    description: 'Reference type.',
  })
  referenceType: string;

  @ApiProperty({
    description: 'Raw citation text that could not be resolved yet.',
  })
  rawCitationText: string;

  @ApiProperty({
    description: 'ISO 8601 timestamp when the reference row was created.',
  })
  createdAt: string;
}

export class ListDanglingRefsResponseDto {
  @ApiProperty({
    description: 'Total number of dangling (unresolved) references matching the filters.',
  })
  total: number;

  @ApiProperty({
    type: [DanglingRefItem],
    description: 'Dangling reference rows.',
  })
  items: DanglingRefItem[];
}