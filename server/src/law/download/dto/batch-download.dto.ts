import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { DownloadByUrlDto } from './download-by-url.dto';

export class BatchDownloadDto {
  @ApiProperty({
    description:
      'Up to 100 vanban.chinhphu.vn document detail page URLs to download.',
    type: [DownloadByUrlDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DownloadByUrlDto)
  documents: DownloadByUrlDto[];
}
