import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncDocumentResponseDto {
  @ApiProperty({
    description:
      "The document row's id, or null if the document was skipped (see skippedReason).",
    nullable: true,
    example: '9631d7b9-1d46-4938-aec7-3c88e2b609e0',
  })
  documentId: string | null;

  @ApiProperty({
    description:
      'false if the document already existed with an unchanged content_version (full text + key attributes hash) — the write was skipped as a no-op.',
  })
  changed: boolean;

  @ApiPropertyOptional({
    description:
      'Set when the document was not persisted — currently only "scope=dia-phuong" (the page\'s own breadcrumb says it\'s a local, not trung-ương, document, regardless of which sitemap bucket it was discovered in).',
    example: 'scope=dia-phuong',
  })
  skippedReason?: string;

  @ApiProperty({
    description:
      'Always 0 on this single-document path — dangling document_reference rows are no longer healed per document (that was an expensive full-table scan on every sync). Batch endpoints (POST /crawl/batch, /crawl/all, /crawl/search) heal once at the end of the batch instead; for passes driven by repeated single-URL syncs, call PATCH /laws/index/sync/refs/all afterward.',
    example: 0,
  })
  healedReferences: number;
}
