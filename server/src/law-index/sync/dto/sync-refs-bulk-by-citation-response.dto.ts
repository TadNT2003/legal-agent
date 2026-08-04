import { ApiProperty } from '@nestjs/swagger';
import { SyncRefsResultItem } from './sync-refs-response.dto';

export class SyncRefsBulkItem {
  @ApiProperty({
    description: 'Citation ID that was requested.',
  })
  citation: string;

  @ApiProperty({
    description: 'Document UUID found for this citation.',
    nullable: true,
  })
  documentId: string | null;

  @ApiProperty({
    description: 'Document title.',
    nullable: true,
  })
  title: string | null;

  @ApiProperty({
    description: 'Number of dangling references healed for this document.',
  })
  healedReferences: number;

  @ApiProperty({
    type: [SyncRefsResultItem],
    description: 'Details of each healed reference.',
  })
  healed: SyncRefsResultItem[];

  @ApiProperty({
    description: 'Set when no document was found for this citation.',
    nullable: true,
  })
  error?: string | null;
}

export class SyncRefsBulkByCitationResponseDto {
  @ApiProperty({
    description: 'Total number of dangling references healed across all citations.',
  })
  healedReferences: number;

  @ApiProperty({
    description: 'Total number of unique dangling rows matched before healing.',
  })
  totalDangling: number;

  @ApiProperty({
    type: [SyncRefsBulkItem],
    description: 'Per-citation result.',
  })
  results: SyncRefsBulkItem[];
}