import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ArrayMinSize, IsString, ArrayUnique } from 'class-validator';

export class SyncRefsBulkByCitationDto {
  @ApiProperty({
    description: 'List of citation IDs to heal refs for.',
    example: ['03/2009/TT-BNG', '78/2025/ND-CP'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  citations: string[];
}