import type { SearchSyncDocumentsDto } from '../crawl/dto/search-sync-documents.dto';
import type {
  BatchUpdateSummary,
  SearchAndSyncSummary,
  SyncSummary,
} from '../law-index.service';

/**
 * Four distinct job types rather than a `force` flag distinguishing two of
 * them — `POST /crawl/batch` (create-or-update, syncDocumentsBatch) and
 * `PUT /crawl/batch` (update-only, updateDocumentsBatch) are different
 * service methods with different semantics, not the same call toggled by
 * `force` (force only ever meant "re-write even if content_version is
 * unchanged", within the PUT/update-only path).
 */
export type JobType =
  'crawlAll' | 'crawlBatch' | 'crawlUpdateBatch' | 'searchAndSync';

export interface CrawlAllJobPayload {
  type: 'crawlAll';
  limit?: number;
}

export interface CrawlBatchJobPayload {
  type: 'crawlBatch';
  urls: string[];
}

export interface CrawlUpdateBatchJobPayload {
  type: 'crawlUpdateBatch';
  urls: string[];
  force: boolean;
}

export interface SearchAndSyncJobPayload {
  type: 'searchAndSync';
  filters: SearchSyncDocumentsDto;
}

export type JobPayload =
  | CrawlAllJobPayload
  | CrawlBatchJobPayload
  | CrawlUpdateBatchJobPayload
  | SearchAndSyncJobPayload;

export type JobRunResult =
  SyncSummary | BatchUpdateSummary | SearchAndSyncSummary;

/**
 * Reported via BullMQ's job.updateProgress() as each document finishes (see
 * job-worker.ts) and read back by GET /laws/index/jobs/:jobId (see
 * job-queue.service.ts). `total` is null while it isn't known yet — an
 * unbounded `crawlAll` job (no `limit`) discovers document URLs
 * incrementally while it syncs them, so there's no true total until the run
 * itself is already finished, not just during some initial "discovery"
 * phase (see LawIndexService.syncAll's doc comment). `phase` is derived
 * from whether `total` is known, not tracked independently.
 */
export interface JobProgress {
  phase: 'discovering' | 'syncing';
  processed: number;
  total: number | null;
}
