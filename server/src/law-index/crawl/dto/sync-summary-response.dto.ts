import { ApiProperty } from '@nestjs/swagger';
import { SyncErrorDto } from './sync-error.dto';

export class SyncSummaryResponseDto {
  @ApiProperty({
    description:
      'Document URLs discovered from the trung-ương sitemap block and processed in this call.',
  })
  totalUrls: number;

  @ApiProperty({
    description:
      'Documents successfully synced (created, updated, or a no-op because content_version was unchanged).',
  })
  synced: number;

  @ApiProperty({
    description:
      'Documents whose own breadcrumb reported địa phương scope and were skipped without erroring.',
  })
  skipped: number;

  @ApiProperty({
    description:
      "document_reference rows whose target_document_id was null and got resolved during this call's cleanup pass.",
  })
  healedReferences: number;

  @ApiProperty({
    type: [SyncErrorDto],
    description:
      'Per-URL failures — the call still completes and reports these rather than aborting the whole batch.',
  })
  errors: SyncErrorDto[];
}
