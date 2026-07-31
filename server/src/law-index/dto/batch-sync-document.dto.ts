import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsUrl,
  ValidateNested,
} from 'class-validator';

class BatchSyncUrlItem {
  @ApiProperty({
    description: 'A vbpl.vn document detail page URL (/van-ban/chi-tiet/...).',
    example:
      'https://vbpl.vn/van-ban/chi-tiet/thong-tu-so-05-2026-tt-bng--f15ad6d0-8afc-11f1-90a3-2b21216af9cb',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url: string;
}

export class BatchSyncDocumentDto {
  @ApiProperty({
    description:
      'Up to 100 vbpl.vn document detail page URLs to crawl and sync into Postgres.',
    type: [BatchSyncUrlItem],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BatchSyncUrlItem)
  urls: BatchSyncUrlItem[];
}
