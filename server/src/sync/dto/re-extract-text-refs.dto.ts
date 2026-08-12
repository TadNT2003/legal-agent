import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ReExtractTextRefsDto {
  @ApiProperty({
    description: 'Document UUID to re-extract text-based references for.',
    example: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
  })
  @IsString()
  documentId: string;
}
