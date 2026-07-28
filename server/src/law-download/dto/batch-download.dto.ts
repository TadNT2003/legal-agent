import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { DownloadByUrlDto } from './download-by-url.dto';

export class BatchDownloadDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DownloadByUrlDto)
  documents: DownloadByUrlDto[];
}
