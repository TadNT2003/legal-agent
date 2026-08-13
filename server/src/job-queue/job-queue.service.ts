import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import { jobQueueConfig } from './job-queue.config';
import type { JobPayload, JobProgress, JobRunResult } from './job-types';

export interface JobStatus {
  jobId: string;
  status: string;
  phase: JobProgress['phase'] | null;
  /** Percent complete, 0-100, or null while total is unknown (see JobProgress). */
  progress: number | null;
  processed: number;
  total: number | null;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  result: JobRunResult | null;
  failedReason: string | null;
}

export type CancelJobResult = 'not-found' | 'cancelled' | 'already-running';

/**
 * Thin wrapper around a single BullMQ Queue: submit jobs, poll their
 * status/progress/result, cancel a pending one. The actual job execution
 * (dispatching to CrawlService) lives in job-worker.ts, not here — this
 * service only ever talks to Redis via the Queue, never runs job logic
 * itself.
 */
@Injectable()
export class JobQueueService implements OnModuleDestroy {
  readonly queue: Queue<JobPayload, JobRunResult>;

  constructor(
    @Inject(jobQueueConfig.KEY)
    private readonly config: ConfigType<typeof jobQueueConfig>,
  ) {
    this.queue = new Queue<JobPayload, JobRunResult>(this.config.queueName, {
      connection: this.config.redis,
    });
  }

  async addJob(payload: JobPayload): Promise<{ jobId: string }> {
    const job = await this.queue.add(payload.type, payload, {
      // See scraper-resilience-plan.md's Design Decisions: retries are for
      // the worker process dying mid-job (idempotent upserts make a retried
      // job cheap), not for a single bad URL — those are already collected
      // per-URL inside the job itself without ever throwing.
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });
    if (!job.id) {
      throw new Error('BullMQ did not assign a job id');
    }
    return { jobId: job.id };
  }

  async getJob(jobId: string): Promise<JobStatus | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress =
      job.progress && typeof job.progress === 'object'
        ? (job.progress as JobProgress)
        : null;
    const hasTotal = progress !== null && progress.total !== null;

    return {
      jobId: job.id!,
      status: state,
      phase: progress?.phase ?? null,
      progress: hasTotal
        ? Math.round((progress.processed / progress.total!) * 100)
        : null,
      processed: progress?.processed ?? 0,
      total: hasTotal ? progress.total : null,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      startedAt: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : null,
      completedAt: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : null,
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
    };
  }

  /** Removes a pending/waiting job. A job already being processed cannot be
   * removed (BullMQ throws) — reported back as 'already-running' rather than
   * propagating that error, since it's an expected outcome here, not a bug. */
  async cancelJob(jobId: string): Promise<CancelJobResult> {
    const job = await this.queue.getJob(jobId);
    if (!job) return 'not-found';
    try {
      await job.remove();
      return 'cancelled';
    } catch {
      return 'already-running';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
