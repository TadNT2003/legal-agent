import { Module, forwardRef } from '@nestjs/common';
import { LawIndexModule } from '../law-index/law-index.module';
import { JobQueueService } from './job-queue.service';
import { JobWorkerService } from './job-worker';

/**
 * Async job queue for the long-running crawl endpoints (POST /crawl/all,
 * POST/PUT /crawl/batch, POST /crawl/search) — see
 * docs/plan/scraper-resilience-plan.md. jobQueueConfig is registered
 * globally in app.module.ts (same pattern as every other config namespace
 * here), so no local ConfigModule.forFeature() is needed. Imports
 * LawIndexModule (for JobWorkerService to call LawIndexService) via
 * forwardRef since LawIndexModule also imports this module (for
 * LawIndexController to submit jobs via JobQueueService) — a genuine
 * two-way dependency, not an accident.
 */
@Module({
  imports: [forwardRef(() => LawIndexModule)],
  providers: [JobQueueService, JobWorkerService],
  exports: [JobQueueService],
})
export class JobQueueModule {}
