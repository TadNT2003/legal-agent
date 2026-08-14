import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsString,
  ArrayUnique,
} from 'class-validator';

export class SyncRefsBulkByCitationDto {
  @ApiProperty({
    description: 'List of citation IDs to heal refs for (max 100).',
    example: ['03/2009/TT-BNG', '78/2025/ND-CP'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  citations: string[];
}
