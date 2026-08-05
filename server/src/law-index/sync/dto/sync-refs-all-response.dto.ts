import { ApiProperty } from '@nestjs/swagger';
import { SyncRefsResultItem } from './sync-refs-response.dto';

export class SyncRefsAllResponseDto {
  @ApiProperty({
    description:
      'Total number of dangling references that were healed across all documents.',
  })
  healedReferences: number;

  @ApiProperty({
    type: [SyncRefsResultItem],
    description: 'Details of each healed reference.',
  })
  healed: SyncRefsResultItem[];
}
