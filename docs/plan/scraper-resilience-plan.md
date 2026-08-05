# Scraper Resilience: Job Queue + Hardening

## Goal

Eliminate server shutdowns during large-scale scraping (hundreds of documents) by introducing an async job queue for long-running operations, and hardening the synchronous single-document endpoints against memory leaks, O(n²) database operations, and concurrency races.

## Design Decisions (Resolved)

| Decision | Choice |
|----------|--------|
| Approach | BullMQ job queue + immediate hardening fixes |
| Async endpoints | `POST /crawl/all`, `POST /crawl/batch`, `PUT /crawl/batch`, `POST /crawl/search` (when syncing) |
| Sync endpoints | `POST /crawl/url`, `PUT /crawl/url`, `GET /crawl/search` remain synchronous |
| Job API | Simple poll: POST returns job ID, GET `/laws/index/jobs/:jobId` returns status/progress/result |
| Redis | New `redis:7-alpine` container in docker-compose.yml |

---

## Phase 1: Infrastructure — Redis + BullMQ Setup

### 1.1. Add Redis to docker-compose.yml

Add a Redis service to `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  container_name: legal-agent-redis
  volumes:
    - redis-data:/data
  ports:
    - "6379:6379"
  networks:
    - legal-agent-net
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
  restart: unless-stopped
```

Add `redis-data` to the volumes section.

### 1.2. Install BullMQ dependencies

```bash
cd server && npm install bullmq ioredis
```

### 1.3. Create `JobQueueModule`

New module at `server/src/law-index/job-queue/` with:

- **`job-queue.config.ts`** — `registerAs('jobQueue')` reading `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` from env
- **`job-queue.module.ts`** — Provides `BullMQ Queue` and `Worker`, exports them
- **`job-queue.service.ts`** — Wraps BullMQ queue operations: `addJob()`, `getJob()`, cleanup of completed jobs (e.g., keep 24h)

Configuration:
- Queue name: `law-index-crawl`
- Worker concurrency: `1` (critical — only one scrape job runs at a time, since `VbplClientService` uses a shared singleton browser)
- Job attempt/retry: 1 (no retry — scrape failures are data-dependent, not transient)
- Job lock duration: 300000ms (5 min, enough for browser recycling mid-job)
- Completed job cleanup: `removeOnComplete: { count: 100 }` (keep last 100 completed jobs)
- Failed job cleanup: `removeOnFail: { count: 50 }`

### 1.4. Add Redis env vars

Update `server/.env.example`:
```
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

Add `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` to Joi validation in `env.validation.ts`.

---

## Phase 2: Job Definitions

### 2.1. Define job types

Create `server/src/law-index/job-queue/job-types.ts`:

```ts
export type JobType = 'crawlAll' | 'crawlBatch' | 'searchAndSync';

export interface CrawlAllJob { limit?: number }
export interface CrawlBatchJob { urls: string[]; force?: boolean }
export interface SearchAndSyncJob { filters: SearchSyncDocumentsDto }

export type JobPayload = CrawlAllJob | CrawlBatchJob | SearchAndSyncJob;

export interface JobResult {
  type: JobType;
  status: 'completed';
  result: SyncSummary | BatchUpdateSummary | any;
  completedAt: string;
}

export interface JobError {
  type: JobType;
  status: 'failed';
  error: string;
  completedAt: string;
}
```

### 2.2. Worker handler

Create `server/src/law-index/job-queue/job-worker.ts`:

A single function that receives a `Job` from BullMQ and dispatches to the appropriate service method:

```ts
async function handleJob(job: Job) {
  const { type, ...payload } = job.data as JobPayload;
  let result;
  switch (type) {
    case 'crawlAll':
      result = await lawIndexService.syncAll(payload);
      break;
    case 'crawlBatch':
      result = payload.force
        ? await lawIndexService.updateDocumentsBatch(payload.urls, payload.force)
        : await lawIndexService.syncDocumentsBatch(payload.urls);
      break;
    case 'searchAndSync':
      result = await lawIndexService.searchAndSyncDocuments(payload.filters);
      break;
  }
  return result;
}
```

The worker should:
- Inject `LawIndexService` via NestJS dependency injection
- Handle each job type, calling the existing service methods
- Catch errors and return structured failure results
- Optionally update job progress via `job.updateProgress()` as each document completes (see Phase 3)

---

## Phase 3: Controller Changes — Async Endpoints

### 3.1. Add job management endpoints to `LawIndexController`

New endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/laws/index/jobs/:jobId` | Get job status, progress, result |
| POST | `/laws/index/jobs/:jobId/cancel` | Cancel a pending/running job |

### 3.2. Modify `crawl/all` endpoint

`POST /crawl/all` now:
1. Validates input
2. Calls `jobQueueService.addJob('crawlAll', { limit: dto.limit })`
3. Returns `{ jobId, status: 'pending', message: 'Crawl job submitted. Poll GET /laws/index/jobs/:jobId for status.' }`

### 3.3. Modify `crawl/batch` endpoints

`POST /crawl/batch` and `PUT /crawl/batch` now:
1. Validate input (up to 100 URLs)
2. Call `jobQueueService.addJob('crawlBatch', { urls, force })` or `jobQueueService.addJob('crawlUpdateBatch', { urls, force })`
3. Return `{ jobId, status: 'pending' }`

### 3.4. Modify `crawl/search` endpoint (POST, when not dryRun)

`POST /crawl/search` with `dryRun: false`:
1. Submit job via `jobQueueService.addJob('searchAndSync', { filters: dto })`
2. Return `{ jobId, status: 'pending' }`

When `dryRun: true`, keep synchronous behavior (only reads, no scraping).

### 3.5. Response shape for job poll endpoint

```json
{
  "jobId": "abc123",
  "status": "running",
  "progress": 45,
  "processed": 90,
  "total": 200,
  "createdAt": "2025-01-01T00:00:00.000Z",
  "startedAt": "2025-01-01T00:01:00.000Z",
  "result": null
}
```

When completed:
```json
{
  "jobId": "abc123",
  "status": "completed",
  "progress": 100,
  "processed": 200,
  "total": 200,
  "completedAt": "2025-01-01T00:30:00.000Z",
  "result": {
    "totalUrls": 200,
    "synced": 195,
    "skipped": 3,
    "healedReferences": 12,
    "errors": []
  }
}
```

---

## Phase 4: Progress Reporting

### 4.1. Wrap batch loops to emit progress

The worker's batch loops need to report progress back to BullMQ. Create a wrapper around the existing service batch methods that accepts a `onProgress` callback:

Modify `LawIndexService` to accept an optional progress reporter in batch operations:

```ts
async syncDocumentsBatch(
  urls: string[],
  options?: { onProgress?: (processed: number, total: number) => void }
): Promise<SyncSummary>
```

Inside the `for` loop, call `options?.onProgress?.(index + 1, urls.length)` after each document.

The worker maps `onProgress` to `job.updateProgress({ processed, total })` which BullMQ stores and exposes via `getJob()`.

### 4.2. Progress in job poll response

The `GET /jobs/:jobId` endpoint maps BullMQ's progress object to the response:

```ts
const job = await queue.getJob(jobId);
const state = await job.getState();
const progress = await job.progress();
return {
  jobId,
  status: state,
  progress: typeof progress === 'object' ? Math.round((progress.processed / progress.total) * 100) : 0,
  processed: typeof progress === 'object' ? progress.processed : 0,
  total: typeof progress === 'object' ? progress.total : 0,
  result: state === 'completed' ? job.returnvalue : null,
  failedReason: state === 'failed' ? job.failedReason : null,
};
```

---

## Phase 5: Hardening Fixes — Sync Endpoints

These fixes apply to the remaining synchronous endpoints (`POST /crawl/url`, `PUT /crawl/url`) which still use `VbplClientService` directly.

### 5.1. Remove per-document `healDanglingReferences` call

**File**: `server/src/law-index/law-index.service.ts`

Remove `healDanglingReferences()` calls at:
- Line 107 in `syncDocument()` — remove entirely
- Line 182 in `updateDocumentByUrl()` — remove entirely

These single-document endpoints don't need to heal dangling references after each sync. The healing is already done at the end of batch operations. For single-doc syncs, dangling refs will be healed by the next batch job or the manual `PATCH /sync/refs/all` endpoint.

**Risk**: A single-doc sync that resolves a previously dangling reference won't heal it immediately. Mitigation: The `PATCH /laws/index/sync/refs/all` endpoint exists for on-demand healing, and batch jobs already do a final heal pass.

### 5.2. Reduce browser recycle interval default

**File**: `server/src/law-index/law-index.config.ts`

Change default `browserRecycleInterval` from `50` to `20`:
```ts
browserRecycleInterval: parseInt(
  process.env.LAW_INDEX_BROWSER_RECYCLE_INTERVAL ?? '20',
  10,
),
```

Update `server/.env.example` to reflect new default and update the comment.

### 5.3. Add `LAW_INDEX_BROWSER_RECYCLE_INTERVAL` to Joi validation

**File**: `server/src/law-index/persistence/env.validation.ts`

Add:
```ts
LAW_INDEX_BROWSER_RECYCLE_INTERVAL: Joi.number().min(1).default(20),
```

### 5.4. Add concurrency guard to `VbplClientService`

**File**: `server/src/law-index/crawl/vbpl-client.service.ts`

Add a mutex flag to prevent concurrent use of the shared browser:

```ts
private isProcessing = false;

private async acquireLock(): Promise<void> {
  if (this.isProcessing) {
    throw new ConflictException(
      'A crawl operation is already in progress. Please wait for it to complete.'
    );
  }
  this.isProcessing = true;
}

private releaseLock(): void {
  this.isProcessing = false;
}
```

Call `acquireLock()` at the start of `fetchDocument()` and `searchDocuments()`, and `releaseLock()` in a `finally` block.

The job queue worker already runs with concurrency=1, so this guard only protects the sync endpoints from colliding with each other (or with a job worker if they share the same process).

**Alternative consideration**: If the job queue worker runs in the same NestJS process (recommended for simplicity), the mutex protects against a sync endpoint firing while a job is running. If the worker is eventually moved to a separate process, this guard becomes unnecessary for cross-process protection.

### 5.5. Add HTTP request timeout to Express

**File**: `server/src/main.ts`

Add timeout configuration:

```ts
// Allow very long requests for sync single-doc operations (4 page loads ~6s worst case)
// Async job endpoints return immediately, so timeout only affects single-doc syncs
const httpAdapter = app.getHttpAdapter();
httpAdapter.getInstance().setTimeout(300000); // 5 minutes
```

This prevents the OS/proxy from killing long-running single-doc syncs. The job-based endpoints return immediately so they are unaffected.

### 5.6. Remove `rawSource` from search results

**File**: `server/src/law-index/persistence/document.repository.ts`, line 989

Remove `rawSource: document.rawSource` from the `select()` in `searchLocalDocuments()`. The `rawSource` JSONB (containing full document text) is loaded but only used to extract `sourceUrl`. Instead, select only `raw_source->>'sourceUrl'` as a separate column:

```ts
sourceUrl: sql<string>`raw_source->>'sourceUrl'`,
```

Then reference `row.sourceUrl` directly instead of casting `row.rawSource`.

### 5.7. Set explicit Postgres connection pool size

**File**: `server/src/law-index/persistence/db.module.ts`

Add `max: 20` to the Pool configuration:

```ts
const pool = new Pool({
  host: config.host,
  port: config.port,
  user: config.username,
  password: config.password,
  database: config.database,
  max: 20,
});
```

---

## Phase 6: Module Wiring

### 6.1. Register `JobQueueModule` in `LawIndexModule`

Add `JobQueueModule` to `LawIndexModule.imports`.

### 6.2. Inject `JobQueueService` into `LawIndexController`

The controller needs `JobQueueService` to submit jobs and query job status.

### 6.3. Shutdown hook for graceful worker drain

**File**: `server/src/law-index/job-queue/job-queue.service.ts`

Implement `OnModuleDestroy` to call `worker.close()` and `queue.close()`, ensuring in-progress jobs complete before process exit. The existing `app.enableShutdownHooks()` in `main.ts` will trigger this.

---

## Validation Plan

1. **Redis connectivity**: Verify `docker-compose up -d` starts Redis, and the server connects on boot
2. **Single doc sync** (unchanged): `POST /crawl/url` with a known vbpl.vn URL — verify it still returns immediately with sync result
3. **Batch job submission**: `POST /crawl/batch` with 5 URLs — verify it returns a job ID immediately
4. **Job polling**: `GET /laws/index/jobs/:jobId` — verify status transitions: `waiting` → `active` → `completed`, with progress updates
5. **Full crawl job**: `POST /crawl/all` with `limit: 10` — verify job completes with correct summary
6. **Concurrency guard**: Send two `POST /crawl/url` requests simultaneously — second should get 409 Conflict
7. **Memory profile**: Run a batch of 100 documents and monitor `process.memoryUsage()` — verify no unbounded growth
8. **Browser recycling**: Verify Chromium process recycling occurs every 20 documents (check logs for "Recycled browser after 20 documents")
9. **Dangling ref healing**: After batch sync, verify refs are healed only once (at end), not per-document

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| BullMQ adds significant dependency surface | BullMQ is well-maintained, widely used. Redis is already in infra. |
| Job results may exceed response size limits | Job results are `SyncSummary` objects (small JSON). The full document data stays in Postgres. |
| Stale jobs accumulate in Redis | `removeOnComplete: { count: 100 }` and `removeOnFail: { count: 50 }` auto-cleanup. |
| Worker and sync endpoint share browser mutex — sync endpoints block during job execution | Acceptable trade-off. The mutex is explicit about this via 409 error. Alternative is separate browser instances per worker, which increases memory. |
| Large job results stored in Redis | `SyncSummary` is compact (~2KB max). Not a concern. |

---

## Files Affected

| File | Change |
|------|--------|
| `docker-compose.yml` | Add Redis service |
| `server/package.json` | Add `bullmq`, `ioredis` deps |
| `server/.env.example` | Add Redis env vars |
| `server/src/config/env.validation.ts` | Add Redis + browserRecycleInterval validation |
| `server/src/law-index/law-index.config.ts` | Change browserRecycleInterval default to 20 |
| `server/src/law-index/law-index.module.ts` | Import JobQueueModule |
| `server/src/law-index/law-index.controller.ts` | New job endpoints, modify batch/all/search to submit jobs |
| `server/src/law-index/law-index.service.ts` | Remove per-doc healDanglingReferences, add progress callback support |
| `server/src/law-index/crawl/vbpl-client.service.ts` | Add concurrency mutex |
| `server/src/law-index/persistence/db.module.ts` | Set explicit pool max |
| `server/src/law-index/persistence/document.repository.ts` | Remove rawSource from search select |
| `server/src/main.ts` | Add HTTP timeout |
| `server/src/law-index/job-queue/job-queue.config.ts` | **New** |
| `server/src/law-index/job-queue/job-queue.module.ts` | **New** |
| `server/src/law-index/job-queue/job-queue.service.ts` | **New** |
| `server/src/law-index/job-queue/job-types.ts` | **New** |
| `server/src/law-index/job-queue/job-worker.ts` | **New** |