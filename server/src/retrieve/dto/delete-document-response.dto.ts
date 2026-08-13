import { ApiProperty } from '@nestjs/swagger';

export class DeleteDocumentResultDto {
  @ApiProperty({ description: 'Document UUID that was deleted.' })
  documentId: string;

  @ApiProperty({ description: 'Citation ID of the deleted document.' })
  citationId: string;

  @ApiProperty({ description: 'Number of document_node rows removed.' })
  nodesDeleted: number;

  @ApiProperty({ description: 'Number of document_reference rows removed.' })
  referencesDeleted: number;
}

export class DeleteDocumentsBySearchResponseDto {
  @ApiProperty({
    description: 'Total document IDs matched by the search filters.',
  })
  matched: number;

  @ApiProperty({ description: 'Documents successfully deleted.' })
  deleted: number;

  @ApiProperty({
    description: 'Documents that were not found (already deleted).',
  })
  notFound: number;

  @ApiProperty({
    type: [DeleteDocumentResultDto],
    description: 'Per-document deletion details.',
  })
  results: DeleteDocumentResultDto[];
}
