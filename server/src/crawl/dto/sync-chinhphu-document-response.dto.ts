import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncChinhPhuDocumentResponseDto {
  @ApiProperty({
    description:
      "The document row's id, or null if the document was skipped (see skippedReason).",
    nullable: true,
    example: '9631d7b9-1d46-4938-aec7-3c88e2b609e0',
  })
  documentId: string | null;

  @ApiProperty({
    description:
      'false if the document already existed with an unchanged content_version — the write was skipped as a no-op.',
  })
  changed: boolean;

  @ApiPropertyOptional({
    description:
      'Set when the document was not persisted — currently only a citation already indexed by another source (vanban.chinhphu.vn is a supplementary source and never overwrites an existing row).',
    example:
      'citation "51/2024/QH15" already indexed (id 9631d7b9-...) — vanban.chinhphu.vn is a supplementary source and never overwrites an existing row',
  })
  skippedReason?: string;

  @ApiProperty({
    description:
      'True once fullText has been populated by a document-processing tool and a document_node tree has been built; false while the document is metadata-only (see indexScope on the persisted row, and DOCUMENT_TEXT_EXTRACTOR).',
  })
  hasFullText: boolean;
}
