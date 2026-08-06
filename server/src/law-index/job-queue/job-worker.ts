import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { jobQueueConfig } from './job-queue.config';
import { LawIndexService } from '../law-index.service';
import type { JobPayload, JobProgress, JobRunResult } from './job-types';

/**
 * Owns the single BullMQ Worker for this process and dispatches each job to
 * the matching LawIndexService batch method. Concurrency is fixed at 1 —
 * VbplClientService's shared browser/page can only serve one caller at a
 * time (see vbpl-client.service.ts's acquireLock) — so running more than one
 * job concurrently here would just serialize on that lock anyway, worse,
 * with wasted job-slot churn instead of a clean queue.
 *
 * Runs in the same NestJS process as the HTTP API (see
 * scraper-resilience-plan.md's Design Decisions on worker process
 * placement) — a crash inside a running job's scrape loop is not isolated
 * from the API server by this design.
 */
@Injectable()
export class JobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWorkerService.name);
  private worker: Worker<JobPayload, JobRunResult> | null = null;

  constructor(
    @Inject(jobQueueConfig.KEY)
    private readonly config: ConfigType<typeof jobQueueConfig>,
    @Inject(forwardRef(() => LawIndexService))
    private readonly lawIndexService: LawIndexService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<JobPayload, JobRunResult>(
      this.config.queueName,
      (job) => this.handleJob(job),
      {
        connection: this.config.redis,
        concurrency: 1,
        // Enough for a browser recycle mid-job (see VbplClientService); a
        // job that legitimately takes longer than this renews the lock on
        // its own via BullMQ's lock-extension, so this bounds recovery time
        // after a genuinely stuck/crashed job, not normal job duration.
        lockDuration: 300000,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id} (${job?.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async handleJob(job: Job<JobPayload>): Promise<JobRunResult> {
    const payload = job.data;
    const onProgress = (processed: number, total: number | null) => {
      const progress: JobProgress = {
        phase: total === null ? 'discovering' : 'syncing',
        processed,
        total,
      };
      job.updateProgress(progress).catch((err: unknown) => {
        this.logger.warn(
          `Failed to update progress for job ${job.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    };

    switch (payload.type) {
      case 'crawlAll':
        return this.lawIndexService.syncAll({
          limit: payload.limit,
          onProgress,
        });
      case 'crawlBatch':
        return this.lawIndexService.syncDocumentsBatch(payload.urls, {
          onProgress,
        });
      case 'crawlUpdateBatch':
        return this.lawIndexService.updateDocumentsBatch(
          payload.urls,
          payload.force,
          { onProgress },
        );
      case 'searchAndSync':
        return this.lawIndexService.searchAndSyncDocuments(payload.filters, {
          onProgress,
        });
      default: {
        const exhaustiveCheck: never = payload;
        throw new Error(
          `Unknown job payload: ${JSON.stringify(exhaustiveCheck)}`,
        );
      }
    }
  }
}
