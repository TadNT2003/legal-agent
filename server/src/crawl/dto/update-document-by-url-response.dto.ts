import { ApiProperty } from '@nestjs/swagger';

export class UpdateDocumentByUrlResultDto {
  @ApiProperty({
    description: 'Document UUID.',
    example: '9631d7b9-1d46-4938-aec7-3c88e2b609e0',
  })
  documentId: string;

  @ApiProperty({
    description:
      'true when the document was updated (content_version changed). Always true for a successful update (unchanged content returns early without reaching here — see unchanged).',
  })
  changed: boolean;

  @ApiProperty({
    description:
      'true if the document existed but its content_version was unchanged — the write was skipped as a no-op.',
  })
  unchanged: boolean;

  @ApiProperty({
    description: 'Citation ID of the updated document.',
    example: '01/2026/QH16',
  })
  citationId: string;

  @ApiProperty({
    description:
      'Always 0 on this single-document path — dangling document_reference rows are no longer healed per document (that was an expensive full-table scan on every sync). Batch endpoints (PUT /crawl/batch) heal once at the end of the batch instead; for passes driven by repeated single-URL updates, call PATCH /laws/index/sync/refs/all afterward.',
    example: 0,
  })
  healedReferences: number;
}

export class UpdateDocumentByUrlErrorDto {
  @ApiProperty({
    description: 'Human-readable error message.',
    example:
      'No document found in the index matching vbpl.vn URL. The page resolved to citation "99/9999/QH99" which does not exist in the local database. Sync it first via POST /laws/index/crawl/url.',
  })
  message: string;

  @ApiProperty({
    description: 'Citation ID extracted from the vbpl.vn page.',
    example: '99/9999/QH99',
  })
  citationId: string;

  @ApiProperty({
    description: 'The source URL that was fetched.',
    example: 'https://vbpl.vn/van-ban/chi-tiet/...',
  })
  url: string;
}
