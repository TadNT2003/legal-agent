import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { LawIndexController } from './law-index.controller';
import { LawIndexService } from './law-index.service';

describe('LawIndexController', () => {
  let app: INestApplication;
  let mockService: jest.Mocked<Partial<LawIndexService>>;

  const mockSyncResult = {
    documentId: 'test-doc-id',
    changed: true,
    healedReferences: 0,
  };

  const mockSyncSummary = {
    totalUrls: 3,
    synced: 2,
    skipped: 1,
    healedReferences: 0,
    errors: [],
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

  beforeEach(async () => {
    mockService = {
      syncDocument: jest.fn().mockResolvedValue(mockSyncResult),
      syncDocumentsBatch: jest.fn().mockResolvedValue(mockSyncSummary),
      syncAll: jest.fn().mockResolvedValue(mockSyncSummary),
      searchDocuments: jest.fn().mockResolvedValue(mockSearchResult),
      searchAndSyncDocuments: jest.fn().mockResolvedValue({
        ...mockSearchResult,
        synced: 2,
        skipped: 1,
        healedReferences: 0,
        errors: [],
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [LawIndexController],
      providers: [
        { provide: LawIndexService, useValue: mockService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /laws/index/crawl/url', () => {
    it('returns 201 with sync result for valid URL', async () => {
      const res = await request(app.getHttpServer())
        .post('/laws/index/crawl/url')
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
        .post('/laws/index/crawl/url')
        .send({})
        .expect(400);
    });

    it('returns 400 when URL is invalid', async () => {
      await request(app.getHttpServer())
        .post('/laws/index/crawl/url')
        .send({ url: 'not-a-url' })
        .expect(400);
    });
  });

  describe('POST /laws/index/crawl/batch', () => {
    it('returns sync summary for valid batch', async () => {
      const res = await request(app.getHttpServer())
        .post('/laws/index/crawl/batch')
        .send({
          urls: [
            { url: 'https://vbpl.vn/van-ban/chi-tiet/1' },
            { url: 'https://vbpl.vn/van-ban/chi-tiet/2' },
          ],
        })
        .expect(201);

      expect(res.body).toHaveProperty('totalUrls', mockSyncSummary.totalUrls);
      expect(mockService.syncDocumentsBatch).toHaveBeenCalledWith([
        'https://vbpl.vn/van-ban/chi-tiet/1',
        'https://vbpl.vn/van-ban/chi-tiet/2',
      ]);
    });

    it('returns 400 when urls array is empty', async () => {
      await request(app.getHttpServer())
        .post('/laws/index/crawl/batch')
        .send({ urls: [] })
        .expect(400);
    });

    it('returns 400 when urls exceed max size of 100', async () => {
      const urls = Array.from({ length: 101 }, (_, i) => ({
        url: `https://vbpl.vn/van-ban/chi-tiet/${i}`,
      }));
      await request(app.getHttpServer())
        .post('/laws/index/crawl/batch')
        .send({ urls })
        .expect(400);
    });
  });

  describe('POST /laws/index/crawl/all', () => {
    it('passes limit to service', async () => {
      await request(app.getHttpServer())
        .post('/laws/index/crawl/all')
        .send({ limit: 5 })
        .expect(201);

      expect(mockService.syncAll).toHaveBeenCalledWith({ limit: 5 });
    });

    it('works without limit', async () => {
      await request(app.getHttpServer())
        .post('/laws/index/crawl/all')
        .send({})
        .expect(201);

      expect(mockService.syncAll).toHaveBeenCalledWith({ limit: undefined });
    });
  });

  describe('GET /laws/index/crawl/search', () => {
    it('returns 200 with search results', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/index/crawl/search')
        .query({ keyword: 'luat lao dong', page: 1 })
        .expect(200);

      expect(res.body).toHaveProperty('total', mockSearchResult.total);
      expect(mockService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'luat lao dong', page: 1 }),
      );
    });

    it('passes all filter params to service', async () => {
      await request(app.getHttpServer())
        .get('/laws/index/crawl/search')
        .query({
          keyword: 'test',
          searchScope: 'noi-dung',
          documentTypes: 'Luật',
          issuedFrom: '01/01/2020',
          issuedTo: '31/12/2025',
        })
        .expect(200);

      expect(mockService.searchDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          keyword: 'test',
          searchScope: 'noi-dung',
          documentTypes: ['Luật'],
          issuedFrom: '01/01/2020',
          issuedTo: '31/12/2025',
        }),
      );
    });
  });

  describe('POST /laws/index/crawl/search', () => {
    it('returns 200 with search-and-sync results', async () => {
      const res = await request(app.getHttpServer())
        .post('/laws/index/crawl/search')
        .send({ keyword: 'test', maxResults: 10 })
        .expect(201);

      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('synced');
      expect(mockService.searchAndSyncDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'test', maxResults: 10 }),
      );
    });
  });

  describe('error propagation', () => {
    it('returns 500 when service throws', async () => {
      mockService.syncDocument.mockRejectedValueOnce(new Error('vbpl.vn unreachable'));

      await request(app.getHttpServer())
        .post('/laws/index/crawl/url')
        .send({ url: 'https://vbpl.vn/test' })
        .expect(500);
    });
  });
});