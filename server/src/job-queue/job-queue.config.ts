import { registerAs } from '@nestjs/config';

/**
 * Backing store for the async job queue (POST /crawl/all|batch|search — see
 * job-queue.module.ts). New infra dependency introduced by
 * docs/plan/scraper-resilience-plan.md; not required by any other part of
 * this codebase.
 */
export const jobQueueConfig = registerAs('jobQueue', () => ({
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  queueName: 'law-index-crawl',
}));
