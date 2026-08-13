const mockAdd = jest.fn();
const mockGetJob = jest.fn();
const mockClose = jest.fn().mockResolvedValue(undefined);

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockAdd,
    getJob: mockGetJob,
    close: mockClose,
  })),
}));

import { JobQueueService } from './job-queue.service';
import type { JobPayload } from './job-types';

const MOCK_CONFIG = {
  redis: { host: 'localhost', port: 6379, password: undefined },
  queueName: 'law-index-crawl',
};

function makeJobMock(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    timestamp: 1000,
    processedOn: undefined,
    finishedOn: undefined,
    returnvalue: undefined,
    failedReason: undefined,
    progress: undefined,
    getState: jest.fn().mockResolvedValue('waiting'),
    remove: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('JobQueueService', () => {
  let service: JobQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobQueueService(MOCK_CONFIG);
  });

  describe('addJob', () => {
    it('submits the job to the queue keyed by its type and returns the assigned id', async () => {
      mockAdd.mockResolvedValue({ id: 'job-42' });
      const payload: JobPayload = { type: 'crawlAll', limit: 10 };

      const result = await service.addJob(payload);

      expect(mockAdd).toHaveBeenCalledWith(
        'crawlAll',
        payload,
        expect.objectContaining({
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        }),
      );
      expect(result).toEqual({ jobId: 'job-42' });
    });

    it('throws if BullMQ does not assign a job id', async () => {
      mockAdd.mockResolvedValue({ id: undefined });

      await expect(
        service.addJob({ type: 'crawlBatch', urls: [] }),
      ).rejects.toThrow('BullMQ did not assign a job id');
    });
  });

  describe('getJob', () => {
    it('returns null when the job does not exist', async () => {
      mockGetJob.mockResolvedValue(null);

      const result = await service.getJob('missing');

      expect(result).toBeNull();
    });

    it('maps an in-progress job with a known total to a percent-complete progress', async () => {
      const job = makeJobMock({
        getState: jest.fn().mockResolvedValue('active'),
        processedOn: 2000,
        progress: { phase: 'syncing', processed: 45, total: 100 },
      });
      mockGetJob.mockResolvedValue(job);

      const result = await service.getJob('job-1');

      expect(result).toEqual({
        jobId: 'job-1',
        status: 'active',
        phase: 'syncing',
        progress: 45,
        processed: 45,
        total: 100,
        createdAt: new Date(1000).toISOString(),
        startedAt: new Date(2000).toISOString(),
        completedAt: null,
        result: null,
        failedReason: null,
      });
    });

    it('reports progress: null and total: null while total is unknown (discovering phase)', async () => {
      const job = makeJobMock({
        getState: jest.fn().mockResolvedValue('active'),
        progress: { phase: 'discovering', processed: 12, total: null },
      });
      mockGetJob.mockResolvedValue(job);

      const result = await service.getJob('job-1');

      expect(result?.phase).toBe('discovering');
      expect(result?.progress).toBeNull();
      expect(result?.total).toBeNull();
      expect(result?.processed).toBe(12);
    });

    it('surfaces the result once completed', async () => {
      const summary = {
        totalUrls: 5,
        synced: 5,
        skipped: 0,
        healedReferences: 0,
        errors: [],
      };
      const job = makeJobMock({
        getState: jest.fn().mockResolvedValue('completed'),
        finishedOn: 3000,
        returnvalue: summary,
        progress: { phase: 'syncing', processed: 5, total: 5 },
      });
      mockGetJob.mockResolvedValue(job);

      const result = await service.getJob('job-1');

      expect(result?.status).toBe('completed');
      expect(result?.completedAt).toBe(new Date(3000).toISOString());
      expect(result?.result).toEqual(summary);
    });

    it('surfaces failedReason once failed', async () => {
      const job = makeJobMock({
        getState: jest.fn().mockResolvedValue('failed'),
        failedReason: 'worker crashed',
      });
      mockGetJob.mockResolvedValue(job);

      const result = await service.getJob('job-1');

      expect(result?.status).toBe('failed');
      expect(result?.failedReason).toBe('worker crashed');
      expect(result?.result).toBeNull();
    });
  });

  describe('cancelJob', () => {
    it('returns not-found when the job does not exist', async () => {
      mockGetJob.mockResolvedValue(null);

      const result = await service.cancelJob('missing');

      expect(result).toBe('not-found');
    });

    it('removes a pending job and returns cancelled', async () => {
      const remove = jest.fn().mockResolvedValue(undefined);
      mockGetJob.mockResolvedValue(makeJobMock({ remove }));

      const result = await service.cancelJob('job-1');

      expect(remove).toHaveBeenCalled();
      expect(result).toBe('cancelled');
    });

    it('returns already-running when BullMQ refuses to remove an active job', async () => {
      const remove = jest
        .fn()
        .mockRejectedValue(new Error('Could not remove job'));
      mockGetJob.mockResolvedValue(makeJobMock({ remove }));

      const result = await service.cancelJob('job-1');

      expect(result).toBe('already-running');
    });
  });

  describe('onModuleDestroy', () => {
    it('closes the underlying queue', async () => {
      await service.onModuleDestroy();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
