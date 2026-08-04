import { ApiProperty } from '@nestjs/swagger';

export class ReExtractTextRefsResponseDto {
  @ApiProperty({
    description: 'Document UUID that was re-extracted.',
  })
  documentId: string;

  @ApiProperty({
    description: 'Document citation ID.',
  })
  citationId: string;

  @ApiProperty({
    description: 'Number of new text-based reference rows inserted.',
  })
  newReferencesInserted: number;
}