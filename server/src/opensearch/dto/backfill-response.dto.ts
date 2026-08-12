import { ApiProperty } from '@nestjs/swagger';

export class BackfillErrorDto {
  @ApiProperty({
    description:
      'Either a document.id (that document processing failed before any provisions were produced) or a provision document_node.id (that one provision failed a bulk index, per a bulk response item error).',
  })
  id: string;

  @ApiProperty()
  error: string;
}

export class BackfillResponseDto {
  @ApiProperty({
    description: 'Documents whose document_node tree was read and projected.',
  })
  documentsProcessed: number;

  @ApiProperty({
    description:
      'Provisions (Điều + normative Phụ lục) actually sent to the write alias.',
  })
  provisionsIndexed: number;

  @ApiProperty({
    description: 'Template Phụ lục nodes skipped (never indexed, per §3a).',
  })
  templatePhuLucSkipped: number;

  @ApiProperty({
    type: [BackfillErrorDto],
    description:
      'Non-fatal per-document/per-item failures, capped at 100 entries. A connection-level cluster failure throws instead of accumulating here.',
  })
  errors: BackfillErrorDto[];

  @ApiProperty({
    description:
      'True if more than 100 errors occurred — the errors array was truncated, not the run itself.',
  })
  errorsTruncated: boolean;
}
