# Scraper Resilience: Job Queue + Hardening

## Goal

Two separate, non-overlapping goals — kept distinct because they have different risk profiles and don't share a fix:

1. **Remove the HTTP-timeout/blocking-request problem for large scraping runs.** `POST /crawl/all`, `POST /crawl/batch`, `PUT /crawl/batch`, and `POST /crawl/search` (when syncing) currently tie up one HTTP request for the duration of a potentially hundreds-of-documents crawl, with no polling/progress/cancel story. An async job queue (Phase 1–4) fixes this.
2. **Fix concrete resilience bugs in the code path every endpoint (sync or async) shares** — a browser-recycle interval that's too high, an unguarded shared-browser concurrency race, O(n²) reference-healing calls, an oversized query select, no explicit DB pool size, no request timeout. These are Phase 5, and are independent of whether Phase 1–4 ships.

> **Vietnamese version:** [scraper-resilience-plan.vi.md](scraper-resilience-plan.vi.md). This English version is canonical — prefer it where the two diverge.

**Explicit non-goal:** this plan does not claim to fix, and should not be read as fixing, the undiagnosed crash pattern logged in `docs/monitoring/law-index-flagged-documents.md` §11 ("Server crashed and self-recovered repeatedly during the tier-5 pass"). That incident was investigated and explicitly *not* attributed to memory pressure or a concurrency race (both were checked and ruled out); root cause is still unknown, and something external to this codebase restarted the process. Phase 1–4's job queue runs its worker **in the same process** as the API server (see Design Decisions), so it does not provide crash isolation — if §11's root cause turns out to live inside the Playwright scrape loop, that code still runs in the same OS process whether it's invoked from an HTTP handler or a BullMQ job handler. §11 stays open, tracked separately in the monitoring log, until it's actually diagnosed.

---

## Design Decisions (Resolved)

| Decision | Choice |
|----------|--------|
| Approach | BullMQ job queue + immediate hardening fixes |
| Async endpoints | `POST /crawl/all`, `POST /crawl/batch`, `PUT /crawl/batch`, `POST /crawl/search` (when syncing) |
| Sync endpoints | `POST /crawl/url`, `PUT /crawl/url`, `GET /crawl/search` remain synchronous |
| Job API | Simple poll: POST returns job ID, GET `/laws/index/jobs/:jobId` returns status/progress/result |
| Redis | New `redis:7-alpine` container in docker-compose.yml |
| Worker process placement | In-process (same NestJS app as the API), for simplicity. Trade-off: no crash isolation between the API and a running job (see Goal's non-goal note) — accepted for now since this is a single-operator internal tool, revisit if §11 is ever diagnosed as scrape-loop-caused. |
| Job retry policy | 2 attempts with backoff, **not** 1 — see Phase 1.3. Redis-backed job durability is only useful if a stalled/crashed job actually gets retried; `attempts: 1` would throw that away for no benefit, given per-document upserts are already idempotent (`content_version`-gated) so a retried job is cheap. |

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
- **Job attempts: `2`, with exponential backoff (e.g. `{ type: 'exponential', delay: 5000 }`)** — not 1. Reasoning: there are two distinct failure classes here, and they need different handling. A single URL failing mid-scrape is already handled *inside* a job, per-document, by the existing try/catch in `syncDocumentsBatch`/`syncAll` (`law-index.service.ts`) — that doesn't need a BullMQ-level retry, and shouldn't get one (retrying a data-dependent failure just wastes a scrape). But the *whole worker process dying mid-job* (the failure mode actually observed in §11) is a different class entirely, and `attempts: 1` leaves it completely unhandled — a job in flight when the process restarts is simply lost. Since document upserts are idempotent (`content_version`-gated no-op skip), re-running a stalled job from scratch after a crash is cheap, so there's no reason not to let BullMQ retry it.
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

Add `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` to Joi validation in `server/src/config/env.validation.ts`.

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

While a `crawlAll` job's sitemap enumeration is still in progress (no `limit` set — the actual "hundreds of documents" case this plan targets), `total` isn't known yet: `syncAll` discovers document URLs incrementally, one sitemap page at a time (`fetchTrungUongSitemapUrls` → `fetchDocumentUrls` per page), so there's a real window where the eventual total is genuinely unknown, not just zero. Represent that explicitly rather than reporting a misleading `total: 0` or `progress: 0`:

```json
{
  "jobId": "abc123",
  "status": "running",
  "phase": "discovering",
  "progress": null,
  "processed": 12,
  "total": null,
  "createdAt": "2025-01-01T00:00:00.000Z",
  "startedAt": "2025-01-01T00:01:00.000Z",
  "result": null
}
```

Once enumeration finishes (or immediately, for `crawlBatch`/`searchAndSync` where the total is known up front):

```json
{
  "jobId": "abc123",
  "status": "running",
  "phase": "syncing",
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
  "phase": "done",
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

`syncAll` needs a slightly different shape, since `total` isn't known until sitemap enumeration completes: report `onProgress?.(processed, null)` (or omit `total`) during discovery, and switch to real `(processed, total)` calls once enumeration finishes — matching the `phase: 'discovering'` vs `phase: 'syncing'` split in 3.5.

The worker maps `onProgress` to `job.updateProgress({ phase, processed, total })` which BullMQ stores and exposes via `getJob()`.

### 4.2. Progress in job poll response

The `GET /jobs/:jobId` endpoint maps BullMQ's progress object to the response:

```ts
const job = await queue.getJob(jobId);
const state = await job.getState();
const progress = await job.progress();
const hasTotal = typeof progress === 'object' && progress.total != null;
return {
  jobId,
  status: state,
  phase: typeof progress === 'object' ? progress.phase : null,
  progress: hasTotal ? Math.round((progress.processed / progress.total) * 100) : null,
  processed: typeof progress === 'object' ? progress.processed : 0,
  total: hasTotal ? progress.total : null,
  result: state === 'completed' ? job.returnvalue : null,
  failedReason: state === 'failed' ? job.failedReason : null,
};
```

---

## Phase 5: Hardening Fixes — Sync Endpoints

These fixes apply to the remaining synchronous endpoints (`POST /crawl/url`, `PUT /crawl/url`) which still use `VbplClientService` directly.

### 5.1. Remove per-document `healDanglingReferences` call — and update the runbook that relies on the old behavior

**Files**: `server/src/law-index/law-index.service.ts`, `CLAUDE.md`, `server/src/law-index/law-index.service.spec.ts`, response DTOs

Remove `healDanglingReferences()` calls at:

- `syncDocument()` — remove entirely
- `updateDocumentByUrl()` — remove entirely

These single-document endpoints don't need to heal dangling references after each sync. The healing is already done at the end of batch operations (`syncDocumentsBatch`, `updateDocumentsBatch`, `syncAll`, `searchAndSyncDocuments`).

**Real gap this creates, and how it's addressed:** this repo's own documented backfill workflow (CLAUDE.md's "Running a law-index scrape/backfill pass," step 3) drives large passes through **repeated individual `POST /crawl/url` calls from an external script**, not the batch endpoints — specifically to avoid the reliability history of large unattended single-shot batches (§6/§11 in the monitoring log). That workflow gets none of the "batch jobs already heal at the end" safety net, since it never calls a batch endpoint. So removing the per-doc heal call would silently stop reference healing during exactly the workflow this repo actually uses for large passes, unless something else covers it. Two changes required together, not as a follow-up:

1. **Update `CLAUDE.md`'s runbook** ("Running a law-index scrape/backfill pass" section) to add an explicit final step: after any pass driven by individual `POST /crawl/url` calls, call `PATCH /laws/index/sync/refs/all` once to heal references accumulated during the pass. This endpoint already exists (`sync.controller.ts`) — this is a documentation-only addition, no new code.
2. **Decide what `healedReferences` means in the single-doc response now.** `SyncDocumentResult.healedReferences`/`UpdateDocumentByUrlResult.healedReferences` (and their Swagger DTOs, `SyncDocumentResponseDto`/`UpdateDocumentByUrlResultDto`) are currently populated directly from the per-doc heal call being removed. Hardcode both to `0` on the single-doc path (don't silently repurpose the field), and update the DTO/Swagger descriptions to say healing no longer happens per-document — point readers at the new runbook step and at `PATCH /sync/refs/all`.

**Also update tests as part of this change, not separately:** `law-index.service.spec.ts` currently has assertions mocking `healDanglingReferences` return values that feed the single-doc response's `healedReferences` field — these need to change to assert `healedReferences: 0` and that `repo.healDanglingReferences` is *not* called on the single-doc path, while the existing batch-path assertions (which call it once at the end) should be unaffected.

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

**File**: `server/src/config/env.validation.ts`

Add:
```ts
LAW_INDEX_BROWSER_RECYCLE_INTERVAL: Joi.number().min(1).default(20),
```

### 5.4. Add a concurrency guard to `VbplClientService` — covering the browser-recycle call too, not just fetch/search

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

**Scope this correctly — the recycle check must be inside the same lock, not a separate call from the service layer.** Today, `LawIndexService.syncDocument()`/`updateDocumentByUrl()` call `client.fetchDocument()` and then, *after* it returns (and after several DB writes — `upsertDocument`, `upsertRelations`, `extractTextReferences`, `syncNodes`), separately call `client.shouldRecycle()`/`client.recycleBrowser()`. If the mutex only wraps `fetchDocument()`/`searchDocuments()`, that gap is still exploitable: a second request can acquire the lock and start using the page during the window between the first request's `fetchDocument()` returning (lock released) and its later `recycleBrowser()` call — and then have the page torn out from under it mid-flight when that deferred `recycleBrowser()` finally runs.

Fix: move the recycle check-and-execute *inside* `VbplClientService.fetchDocument()`'s own locked block (e.g. immediately before `releaseLock()` runs in the `finally`), so recycling happens atomically with the fetch that triggered it, under the same lock. Remove the separate `shouldRecycle()`/`recycleBrowser()` calls from `LawIndexService` — the client should own its own recycling lifecycle entirely; the service shouldn't need to know it happens at all.

Call `acquireLock()` at the start of `fetchDocument()` and `searchDocuments()`, and `releaseLock()` in a `finally` block that runs after the (now-internal) recycle check.

The job queue worker already runs with concurrency=1, so this guard only protects the sync endpoints from colliding with each other (or with a job worker, since they share the same process — see Design Decisions).

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

**File**: `server/src/law-index/persistence/document.repository.ts`, `searchLocalDocuments()` (currently around line 989)

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
2. **Single doc sync** (unchanged): `POST /crawl/url` with a known vbpl.vn URL — verify it still returns immediately with sync result, and `healedReferences: 0` (see 5.1)
3. **Batch job submission**: `POST /crawl/batch` with 5 URLs — verify it returns a job ID immediately
4. **Job polling**: `GET /laws/index/jobs/:jobId` — verify status transitions: `waiting` → `active` → `completed`, with progress updates, including the `phase: 'discovering'` / `total: null` state for an unbounded `crawl/all` job before sitemap enumeration finishes
5. **Full crawl job**: `POST /crawl/all` with `limit: 10` — verify job completes with correct summary
6. **Concurrency guard**: Send two `POST /crawl/url` requests simultaneously — second should get 409 Conflict; also verify a request that lands during another request's browser-recycle window gets a clean 409 rather than a stale-page error (5.4)
7. **Memory profile**: Run a batch of 100 documents and monitor `process.memoryUsage()` — verify no unbounded growth
8. **Browser recycling**: Verify Chromium process recycling occurs every 20 documents (check logs for "Recycled browser after 20 documents")
9. **Dangling ref healing**: After batch sync, verify refs are healed only once (at end), not per-document; after a manual `PATCH /sync/refs/all` call, verify refs accumulated from individual `POST /crawl/url` calls get healed
10. **Job-level retry**: Simulate a worker crash mid-job (e.g. kill the process during a `crawl/batch` job) — verify BullMQ retries the job on restart (up to `attempts: 2`) rather than losing it
11. **Unit tests**: update `law-index.service.spec.ts`'s existing `healDanglingReferences` assertions (single-doc path now expects it not to be called, `healedReferences: 0`); add new specs for the mutex (409 on concurrent access, no stale-page error across a recycle), the job-worker dispatch logic, and progress-callback wiring (including the discovering/unknown-total state)

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| This plan doesn't fix the undiagnosed §11 crash pattern | Out of scope by design (see Goal's non-goal note) — tracked separately in `docs/monitoring/law-index-flagged-documents.md` §11 until actually diagnosed. Don't claim victory over "server shutdowns" broadly based on this plan alone. |
| BullMQ adds significant dependency surface | BullMQ is well-maintained, widely used. Redis is already in infra. |
| In-process worker means a job crash can take down the API too | Accepted trade-off for a single-operator internal tool (see Design Decisions). Revisit (separate worker process) if §11 is ever diagnosed as caused by the scrape loop itself. |
| Job results may exceed response size limits | Job results are `SyncSummary` objects (small JSON). The full document data stays in Postgres. |
| Stale jobs accumulate in Redis | `removeOnComplete: { count: 100 }` and `removeOnFail: { count: 50 }` auto-cleanup. |
| Worker and sync endpoint share browser mutex — sync endpoints block during job execution | Acceptable trade-off. The mutex is explicit about this via 409 error. Alternative is separate browser instances per worker, which increases memory. |
| Large job results stored in Redis | `SyncSummary` is compact (~2KB max). Not a concern. |
| Removing per-doc reference healing (5.1) silently breaks the individual-URL backfill workflow | Addressed directly in 5.1: `CLAUDE.md` runbook gets an explicit healing step, not left as a gap. |

---

## Files Affected

| File | Change |
|------|--------|
| `docker-compose.yml` | Add Redis service |
| `server/package.json` | Add `bullmq`, `ioredis` deps |
| `server/.env.example` | Add Redis env vars, update recycle-interval default/comment |
| `server/src/config/env.validation.ts` | Add Redis + browserRecycleInterval validation |
| `server/src/law-index/law-index.config.ts` | Change browserRecycleInterval default to 20 |
| `server/src/law-index/law-index.module.ts` | Import JobQueueModule |
| `server/src/law-index/law-index.controller.ts` | New job endpoints, modify batch/all/search to submit jobs |
| `server/src/law-index/law-index.service.ts` | Remove per-doc healDanglingReferences and recycle calls, add progress callback support |
| `server/src/law-index/law-index.service.spec.ts` | Update healDanglingReferences/healedReferences assertions for single-doc path |
| `server/src/law-index/crawl/vbpl-client.service.ts` | Add concurrency mutex, fold recycle check into the locked `fetchDocument()` block |
| `server/src/law-index/crawl/vbpl-client.service.spec.ts` | Add mutex/409 and recycle-under-lock coverage |
| `server/src/law-index/crawl/dto/sync-document-response.dto.ts`, `update-document-by-url-response.dto.ts` | Document that `healedReferences` is always 0 on the single-doc path |
| `server/src/law-index/persistence/db.module.ts` | Set explicit pool max |
| `server/src/law-index/persistence/document.repository.ts` | Remove rawSource from search select |
| `server/src/main.ts` | Add HTTP timeout |
| `CLAUDE.md` | Add explicit `PATCH /sync/refs/all` step to the backfill runbook |
| `server/src/law-index/job-queue/job-queue.config.ts` | **New** |
| `server/src/law-index/job-queue/job-queue.module.ts` | **New** |
| `server/src/law-index/job-queue/job-queue.service.ts` | **New** |
| `server/src/law-index/job-queue/job-types.ts` | **New** |
| `server/src/law-index/job-queue/job-worker.ts` | **New** |
| `server/src/law-index/job-queue/*.spec.ts` | **New** — job dispatch and progress-callback coverage |
