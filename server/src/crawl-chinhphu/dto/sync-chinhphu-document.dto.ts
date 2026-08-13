import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class SyncChinhPhuDocumentDto {
  @ApiProperty({
    description: 'A vanban.chinhphu.vn document detail page URL.',
    example: 'https://vanban.chinhphu.vn/?pageid=27160&docid=219000',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;
}
