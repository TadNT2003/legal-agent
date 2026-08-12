import { ApiProperty } from '@nestjs/swagger';
import { SearchDocumentItemDto } from '../../law-index/dto/search-documents-response.dto';
import { SyncErrorDto } from './sync-error.dto';

export class SearchSyncDocumentItemDto extends SearchDocumentItemDto {
  @ApiProperty({
    description:
      'Result of syncing this document into Postgres. Null for dry runs.',
    nullable: true,
  })
  syncResult?:
    | { documentId: string; changed: boolean }
    | { skippedReason: string }
    | { error: string }
    | null;
}

export class SearchSyncDocumentsResponseDto {
  @ApiProperty({
    description: 'Total matches found on vbpl.vn.',
  })
  total: number;

  @ApiProperty({ description: 'Current page number (1-based).' })
  page: number;

  @ApiProperty({ description: 'Results per page.' })
  pageSize: number;

  @ApiProperty({ type: [SearchSyncDocumentItemDto] })
  items: SearchSyncDocumentItemDto[];

  @ApiProperty({
    description:
      'Documents successfully synced (created or updated) into Postgres.',
  })
  synced: number;

  @ApiProperty({
    description:
      'Documents skipped (e.g., địa phương scope) during sync phase.',
  })
  skipped: number;

  @ApiProperty({
    description:
      "document_reference rows whose target_document_id was null and got resolved during the sync's heal pass.",
  })
  healedReferences: number;

  @ApiProperty({
    type: [SyncErrorDto],
    description:
      'Per-URL sync failures — the call still completes and reports these.',
  })
  errors: SyncErrorDto[];
}
