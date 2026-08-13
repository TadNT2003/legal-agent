import { Module, forwardRef } from '@nestjs/common';
import { CrawlModule } from '../crawl/crawl.module';
import { JobQueueService } from './job-queue.service';
import { JobWorkerService } from './job-worker';

/**
 * Async job queue for the long-running crawl endpoints (POST /crawl/all,
 * POST/PUT /crawl/batch, POST /crawl/search) — see
 * docs/plan/scraper-resilience-plan.md. jobQueueConfig is registered
 * globally in app.module.ts (same pattern as every other config namespace
 * here), so no local ConfigModule.forFeature() is needed. Imports
 * CrawlModule (for JobWorkerService to call CrawlService) via forwardRef
 * since CrawlModule also imports this module (for CrawlController to
 * submit jobs via JobQueueService) — a genuine two-way dependency, not an
 * accident. (Formerly LawIndexModule, before the law-index umbrella was
 * dismantled and CrawlController/CrawlService merged into crawl/.)
 */
@Module({
  imports: [forwardRef(() => CrawlModule)],
  providers: [JobQueueService, JobWorkerService],
  exports: [JobQueueService],
})
export class JobQueueModule {}
