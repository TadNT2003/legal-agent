const mockOn = jest.fn();
const mockClose = jest.fn().mockResolvedValue(undefined);
let capturedProcessor: ((job: any) => Promise<any>) | null = null;

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_name: string, processor: any) => {
    capturedProcessor = processor;
    return { on: mockOn, close: mockClose };
  }),
}));

// JobWorkerService imports the real LawIndexService class only for its
// constructor's type — mocking the whole module here avoids ever loading
// the real module.repository.ts -> db.module.ts -> schema chain, which is
// broken in this dev environment for reasons unrelated to this file (see
// docs/monitoring — same root cause blocks law-index.service.spec.ts).
jest.mock('../law-index.service', () => ({
  LawIndexService: jest.fn(),
}));

import { JobWorkerService } from './job-worker';

const MOCK_CONFIG = {
  redis: { host: 'localhost', port: 6379, password: undefined },
  queueName: 'law-index-crawl',
};

function makeJobMock(data: unknown) {
  return {
    id: 'job-1',
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };
}

describe('JobWorkerService', () => {
  let mockLawIndexService: {
    syncAll: jest.Mock;
    syncDocumentsBatch: jest.Mock;
    updateDocumentsBatch: jest.Mock;
    searchAndSyncDocuments: jest.Mock;
  };
  let worker: JobWorkerService;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = null;
    mockLawIndexService = {
      syncAll: jest.fn(),
      syncDocumentsBatch: jest.fn(),
      updateDocumentsBatch: jest.fn(),
      searchAndSyncDocuments: jest.fn(),
    };
    worker = new JobWorkerService(MOCK_CONFIG, mockLawIndexService as any);
    worker.onModuleInit();
  });

  it('constructs the BullMQ Worker with concurrency 1 and the configured queue name', () => {
    const { Worker } = jest.requireMock('bullmq');
    expect(Worker).toHaveBeenCalledWith(
      'law-index-crawl',
      expect.any(Function),
      expect.objectContaining({
        connection: MOCK_CONFIG.redis,
        concurrency: 1,
        lockDuration: 300000,
      }),
    );
  });

  it('dispatches a crawlAll job to LawIndexService.syncAll with limit and onProgress', async () => {
    mockLawIndexService.syncAll.mockResolvedValue({ totalUrls: 1 });
    const job = makeJobMock({ type: 'crawlAll', limit: 10 });

    const result = await capturedProcessor!(job);

    expect(mockLawIndexService.syncAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, onProgress: expect.any(Function) }),
    );
    expect(result).toEqual({ totalUrls: 1 });
  });

  it('dispatches a crawlBatch job to LawIndexService.syncDocumentsBatch', async () => {
    mockLawIndexService.syncDocumentsBatch.mockResolvedValue({ synced: 2 });
    const job = makeJobMock({ type: 'crawlBatch', urls: ['a', 'b'] });

    const result = await capturedProcessor!(job);

    expect(mockLawIndexService.syncDocumentsBatch).toHaveBeenCalledWith(
      ['a', 'b'],
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(result).toEqual({ synced: 2 });
  });

  it('dispatches a crawlUpdateBatch job to LawIndexService.updateDocumentsBatch with force', async () => {
    mockLawIndexService.updateDocumentsBatch.mockResolvedValue({ updated: 1 });
    const job = makeJobMock({
      type: 'crawlUpdateBatch',
      urls: ['a'],
      force: true,
    });

    const result = await capturedProcessor!(job);

    expect(mockLawIndexService.updateDocumentsBatch).toHaveBeenCalledWith(
      ['a'],
      true,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(result).toEqual({ updated: 1 });
  });

  it('dispatches a searchAndSync job to LawIndexService.searchAndSyncDocuments', async () => {
    mockLawIndexService.searchAndSyncDocuments.mockResolvedValue({ synced: 3 });
    const filters = { keyword: 'test' };
    const job = makeJobMock({ type: 'searchAndSync', filters });

    const result = await capturedProcessor!(job);

    expect(mockLawIndexService.searchAndSyncDocuments).toHaveBeenCalledWith(
      filters,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(result).toEqual({ synced: 3 });
  });

  it("maps onProgress(processed, null) to a 'discovering' phase update", async () => {
    mockLawIndexService.syncAll.mockImplementation(
      (options: { onProgress?: (p: number, t: number | null) => void }) => {
        options.onProgress?.(5, null);
        return Promise.resolve({ totalUrls: 5 });
      },
    );
    const job = makeJobMock({ type: 'crawlAll' });

    await capturedProcessor!(job);

    expect(job.updateProgress).toHaveBeenCalledWith({
      phase: 'discovering',
      processed: 5,
      total: null,
    });
  });

  it("maps onProgress(processed, total) to a 'syncing' phase update", async () => {
    mockLawIndexService.syncDocumentsBatch.mockImplementation(
      (
        _urls: string[],
        options: { onProgress?: (p: number, t: number | null) => void },
      ) => {
        options.onProgress?.(3, 10);
        return Promise.resolve({ synced: 3 });
      },
    );
    const job = makeJobMock({ type: 'crawlBatch', urls: [] });

    await capturedProcessor!(job);

    expect(job.updateProgress).toHaveBeenCalledWith({
      phase: 'syncing',
      processed: 3,
      total: 10,
    });
  });

  it('closes the worker on module destroy', async () => {
    await worker.onModuleDestroy();
    expect(mockClose).toHaveBeenCalled();
  });
});
