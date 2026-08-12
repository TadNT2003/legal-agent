import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SyncRefsByCitationDto {
  @ApiProperty({
    description:
      'Citation ID of the document to heal refs for (e.g. "03/2009/TT-BNG").',
    example: '03/2009/TT-BNG',
  })
  @IsString()
  citation: string;
}
