// CrawlController imports the real CrawlService/ChinhPhuCrawlService for
// their DI tokens, whose own module graphs (CrawlService/ChinhPhuCrawlService
// -> DocumentRepository -> db.module -> schema/document-reference.schema.ts)
// are broken in this dev environment for reasons unrelated to this file (a
// drizzle-orm/Node interaction — same root cause blocks crawl.service.spec.ts
// and document.repository.integration.spec.ts too). Mocking both modules
// before importing the controller makes the controller's own `import {
// CrawlService } from './crawl.service'` / `import { ChinhPhuCrawlService }
// from './chinhphu-crawl.service'` resolve to these stubs instead, so the
// real schema chain is never loaded. FallbackSearchService only imports
// CrawlService (already mocked above) and ChinhPhuSearchService (which only
// touches download/, no schema chain) — safe to leave unmocked.
jest.mock('./crawl.service', () => ({
  CrawlService: jest.fn(),
}));
jest.mock('./chinhphu-crawl.service', () => ({
  ChinhPhuCrawlService: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { CrawlController } from './crawl.controller';
import { CrawlService } from './crawl.service';
import { ChinhPhuCrawlService } from './chinhphu-crawl.service';
import { FallbackSearchService } from './fallback-search.service';
import { JobQueueService } from '../job-queue/job-queue.service';

describe('CrawlController', () => {
  let app: INestApplication;
  let mockService: jest.Mocked<Partial<CrawlService>>;
  let mockJobQueue: jest.Mocked<Partial<JobQueueService>>;
  let mockChinhPhuCrawl: jest.Mocked<Partial<ChinhPhuCrawlService>>;
  let mockFallbackSearch: jest.Mocked<Partial<FallbackSearchService>>;

  const mockSyncResult = {
    documentId: 'test-doc-id',
    changed: true,
    healedReferences: 0,
  };

  const mockChinhPhuSyncResult = {
    documentId: 'test-chinhphu-doc-id',
    changed: true,
    hasFullText: false,
  };

  const mockSearchResult = {
    total: 5,
    page: 1,
    pageSize: 10,
    items: [
      {
        title: 'Luật Test 1',
        citation: '01/2025/QH15',
        documentType: 'Luật',
        issuedDate: '01/01/2025',
        sourceUrl: 'https://vbpl.vn/test',
      },
    ],
  };

  const mockFallbackResult = {
    source: 'vbpl.vn' as const,
    result: mockSearchResult,
  };

  beforeEach(async () => {
    mockService = {
      syncDocument: jest.fn().mockResolvedValue(mockSyncResult),
      searchDocuments: jest.fn().mockResolvedValue(mockSearchResult),
      searchAndSyncDocuments: jest.fn().mockResolvedValue({
        ...mockSearchResult,
        synced: 2,
        skipped: 1,
        healedReferences: 0,
        errors: [],
      }),
    };
    mockJobQueue = {
      addJob: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
      getJob: jest.fn(),
      cancelJob: jest.fn(),
    };
    mockChinhPhuCrawl = {
      syncDocument: jest.fn().mockResolvedValue(mockChinhPhuSyncResult),
    };
    mockFallbackSearch = {
      search: jest.fn().mockResolvedValue(mockFallbackResult),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CrawlController],
      providers: [
        { provide: CrawlService, useValue: mockService },
        { provide: JobQueueService, useValue: mockJobQueue },
        { provide: ChinhPhuCrawlService, useValue: mockChinhPhuCrawl },
        { provide: FallbackSearchService, useValue: mockFallbackSearch },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /crawl/url', () => {
    it('returns 201 with sync result for valid URL', async () => {
      const res = await request(app.getHttpServer())
        .post('/crawl/url')
        .send({ url: 'https://vbpl.vn/van-ban/chi-tiet/test' })
        .expect(201);

      expect(res.body).toHaveProperty('documentId', mockSyncResult.documentId);
      expect(res.body).toHaveProperty('changed', mockSyncResult.changed);
      expect(mockService.syncDocument).toHaveBeenCalledWith(
        'https://vbpl.vn/van-ban/chi-tiet/test',
      );
    });

    it('returns 400 when URL is missing', async () => {
      await request(app.getHttpServer())
        .post('/crawl/url')
        .send({})
        .expect(400);
    });

    it('returns 400 when URL is invalid', async () => {
      await request(app.getHttpServer())
        .post('/crawl/url')
        .send({ url: 'not-a-url' })
        .expect(400);
    });
  });

  describe('POST /crawl/chinhphu/url', () => {
    it('returns 201 with sync result for valid URL', async () => {
      const res = await request(app.getHttpServer())
        .post('/crawl/chinhphu/url')
        .send({ url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=1' })
        .expect(201);

      expect(res.body).toHaveProperty(
        'documentId',
        mockChinhPhuSyncResult.documentId,
      );
      expect(mockChinhPhuCrawl.syncDocument).toHaveBeenCalledWith(
        'https://vanban.chinhphu.vn/?pageid=27160&docid=1',
      );
    });

    it('returns 400 when URL is missing', async () => {
      await request(app.getHttpServer())
        .post('/crawl/chinhphu/url')
        .send({})
        .expect(400);
    });
  });

  describe('POST /crawl/batch (async)', () => {
    it('submits a crawlBatch job and returns the job id', async () => {
      const res = await request(app.getHttpServer())
        .post('/crawl/batch')
        .send({
          urls: [
            { url: 'https://vbpl.vn/van-ban/chi-tiet/1' },
            { url: 'https://vbpl.vn/van-ban/chi-tiet/2' },
          ],
        })
        .expect(201);

      expect(res.body).toEqual({
        jobId: 'job-1',
        status: 'pending',
        message: expect.any(String),
      });
      expect(mockJobQueue.addJob).toHaveBeenCalledWith({
        type: 'crawlBatch',
        urls: [
          'https://vbpl.vn/van-ban/chi-tiet/1',
          'https://vbpl.vn/van-ban/chi-tiet/2',
        ],
      });
    });

    it('returns 400 when urls array is empty', async () => {
      await request(app.getHttpServer())
        .post('/crawl/batch')
        .send({ urls: [] })
        .expect(400);
    });

    it('returns 400 when urls exceed max size of 100', async () => {
      const urls = Array.from({ length: 101 }, (_, i) => ({
        url: `https://vbpl.vn/van-ban/chi-tiet/${i}`,
      }));
      await request(app.getHttpServer())
        .post('/crawl/batch')
        .send({ urls })
        .expect(400);
    });
  });

  describe('PUT /crawl/batch (async)', () => {
    it('submits a crawlUpdateBatch job with force passed through', async () => {
      const res = await request(app.getHttpServer())
        .put('/crawl/batch?force=true')
        .send({ urls: [{ url: 'https://vbpl.vn/van-ban/chi-tiet/1' }] })
        .expect(200);

      expect(res.body.jobId).toBe('job-1');
      expect(mockJobQueue.addJob).toHaveBeenCalledWith({
        type: 'crawlUpdateBatch',
        urls: ['https://vbpl.vn/van-ban/chi-tiet/1'],
        force: true,
      });
    });

    it('defaults force to false', async () => {
      await request(app.getHttpServer())
        .put('/crawl/batch')
        .send({ urls: [{ url: 'https://vbpl.vn/van-ban/chi-tiet/1' }] })
        .expect(200);

      expect(mockJobQueue.addJob).toHaveBeenCalledWith(
        expect.objectContaining({ force: false }),
      );
    });
  });

  describe('POST /crawl/all (async)', () => {
    it('submits a crawlAll job with limit', async () => {
      const res = await request(app.getHttpServer())
        .post('/crawl/all')
        .send({ limit: 5 })
        .expect(201);

      expect(res.body.jobId).toBe('job-1');
      expect(mockJobQueue.addJob).toHaveBeenCalledWith({
        type: 'crawlAll',
        limit: 5,
      });
    });

    it('works without limit', async () => {
      await request(app.getHttpServer())
        .post('/crawl/all')
        .send({})
        .expect(201);

      expect(mockJobQueue.addJob).toHaveBeenCalledWith({
        type: 'crawlAll',
        limit: undefined,
      });
    });
  });

  describe('GET /crawl/search', () => {
    it('returns 200 with a { source, result } envelope from FallbackSearchService', async () => {
      const res = await request(app.getHttpServer())
        .get('/crawl/search')
        .query({ keyword: 'luat lao dong', page: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('source', 'vbpl.vn');
      expect(res.body.result).toHaveProperty('total', mockSearchResult.total);
      expect(mockFallbackSearch.search).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'luat lao dong', page: 1 }),
      );
    });

    it('passes all filter params to FallbackSearchService (vbpl.vn side keeps its full filter set)', async () => {
      await request(app.getHttpServer())
        .get('/crawl/search')
        .query({
          keyword: 'test',
          searchScope: 'noi-dung',
          documentTypes: 'Luật',
          issuedFrom: '01/01/2020',
          issuedTo: '31/12/2025',
        })
        .expect(200);

      expect(mockFallbackSearch.search).toHaveBeenCalledWith(
        expect.objectContaining({
          keyword: 'test',
          searchScope: 'noi-dung',
          documentTypes: ['Luật'],
          issuedFrom: '01/01/2020',
          issuedTo: '31/12/2025',
        }),
      );
    });

    it('surfaces a vanban.chinhphu.vn fallback result', async () => {
      mockFallbackSearch.search!.mockResolvedValueOnce({
        source: 'vanban.chinhphu.vn',
        result: { total: 1, items: [], issuingBodyUnresolved: false },
      });

      const res = await request(app.getHttpServer())
        .get('/crawl/search')
        .query({ keyword: 'test' })
        .expect(200);

      expect(res.body.source).toBe('vanban.chinhphu.vn');
    });
  });

  describe('POST /crawl/search', () => {
    it('stays synchronous and returns results directly when dryRun is true', async () => {
      const res = await request(app.getHttpServer())
        .post('/crawl/search')
        .send({ keyword: 'test', dryRun: true })
        .expect(201);

      expect(res.body).toHaveProperty('total');
      expect(mockService.searchAndSyncDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'test', dryRun: true }),
      );
      expect(mockJobQueue.addJob).not.toHaveBeenCalled();
    });

    it('submits a searchAndSync job when dryRun is not set', async () => {
      const res = await request(app.getHttpServer())
        .post('/crawl/search')
        .send({ keyword: 'test', maxResults: 10 })
        .expect(201);

      expect(res.body.jobId).toBe('job-1');
      expect(mockJobQueue.addJob).toHaveBeenCalledWith({
        type: 'searchAndSync',
        filters: expect.objectContaining({ keyword: 'test', maxResults: 10 }),
      });
      expect(mockService.searchAndSyncDocuments).not.toHaveBeenCalled();
    });
  });

  describe('GET /jobs/:jobId', () => {
    it('returns the job status', async () => {
      mockJobQueue.getJob!.mockResolvedValue({
        jobId: 'job-1',
        status: 'active',
        phase: 'syncing',
        progress: 50,
        processed: 5,
        total: 10,
        createdAt: null,
        startedAt: null,
        completedAt: null,
        result: null,
        failedReason: null,
      });

      const res = await request(app.getHttpServer())
        .get('/jobs/job-1')
        .expect(200);

      expect(res.body).toHaveProperty('status', 'active');
      expect(mockJobQueue.getJob).toHaveBeenCalledWith('job-1');
    });

    it('returns 404 when the job does not exist', async () => {
      mockJobQueue.getJob!.mockResolvedValue(null);

      await request(app.getHttpServer()).get('/jobs/missing').expect(404);
    });
  });

  describe('POST /jobs/:jobId/cancel', () => {
    it('returns the cancel result', async () => {
      mockJobQueue.cancelJob!.mockResolvedValue('cancelled');

      const res = await request(app.getHttpServer())
        .post('/jobs/job-1/cancel')
        .expect(201);

      expect(res.body).toEqual({ jobId: 'job-1', result: 'cancelled' });
    });
  });

  describe('error propagation', () => {
    it('returns 500 when service throws', async () => {
      mockService.syncDocument!.mockRejectedValueOnce(
        new Error('vbpl.vn unreachable'),
      );

      await request(app.getHttpServer())
        .post('/crawl/url')
        .send({ url: 'https://vbpl.vn/test' })
        .expect(500);
    });
  });
});
