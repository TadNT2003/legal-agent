import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class SyncDocumentDto {
  @ApiProperty({
    description: 'A vbpl.vn document detail page URL (/van-ban/chi-tiet/...).',
    example:
      'https://vbpl.vn/van-ban/chi-tiet/thong-tu-so-05-2026-tt-bng--f15ad6d0-8afc-11f1-90a3-2b21216af9cb',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;
}
