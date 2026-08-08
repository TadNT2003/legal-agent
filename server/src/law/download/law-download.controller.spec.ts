import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { LawDownloadController } from './law-download.controller';
import { LawDownloadService } from './law-download.service';

describe('LawDownloadController', () => {
  let app: INestApplication;
  let mockService: jest.Mocked<Partial<LawDownloadService>>;

  const mockDownloadOutcome = [
    {
      status: 'downloaded',
      fileUrl: 'https://vanban.chinhphu.vn/GetFile?docid=123&fileid=456',
      filename: 'luat-test-01-2025.pdf',
      subdir: '01-luat',
    },
  ];

  const mockStatusResult = {
    url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=213310',
    citation: '01/2025/QH15',
    title: 'Luat Test',
    files: [{ filename: 'main.pdf', exists: true }],
  };

  const mockSearchResult = {
    total: 10,
    items: [
      {
        url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=213310',
        title: 'Luat Test',
        citation: '01/2025/QH15',
      },
    ],
  };

  const mockSearchDownloadResult = {
    total: 10,
    items: mockSearchResult.items,
    downloaded: 5,
    skipped: 3,
    errors: [],
  };

  beforeEach(async () => {
    mockService = {
      downloadFromUrl: jest.fn().mockResolvedValue(mockDownloadOutcome),
      checkStatus: jest.fn().mockResolvedValue(mockStatusResult),
      downloadBatch: jest.fn().mockResolvedValue(mockDownloadOutcome),
      search: jest.fn().mockResolvedValue(mockSearchResult),
      downloadBySearch: jest.fn().mockResolvedValue(mockSearchDownloadResult),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [LawDownloadController],
      providers: [{ provide: LawDownloadService, useValue: mockService }],
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

  describe('POST /laws/downloads/url', () => {
    it('returns 201 and delegates to service', async () => {
      const res = await request(app.getHttpServer())
        .post('/laws/downloads/url')
        .send({ url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=213310' })
        .expect(201);

      expect(res.body).toHaveLength(1);
      expect(mockService.downloadFromUrl).toHaveBeenCalled();
    });

    it('returns 400 when url is missing', async () => {
      await request(app.getHttpServer())
        .post('/laws/downloads/url')
        .send({})
        .expect(400);
    });

    it('returns 400 when url is invalid', async () => {
      await request(app.getHttpServer())
        .post('/laws/downloads/url')
        .send({ url: 'not-a-url' })
        .expect(400);
    });
  });

  describe('GET /laws/downloads/status', () => {
    it('returns 200 and passes URL to service', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/downloads/status')
        .query({ url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=213310' })
        .expect(200);

      expect(res.body).toHaveProperty('citation');
      expect(mockService.checkStatus).toHaveBeenCalled();
    });

    it('passes subdirOverride to service', async () => {
      await request(app.getHttpServer())
        .get('/laws/downloads/status')
        .query({
          url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=213310',
          subdirOverride: '05-nghi-dinh',
        })
        .expect(200);

      expect(mockService.checkStatus).toHaveBeenCalledWith(
        'https://vanban.chinhphu.vn/?pageid=27160&docid=213310',
        '05-nghi-dinh',
      );
    });
  });

  describe('POST /laws/downloads/batch', () => {
    it('returns download outcomes for batch', async () => {
      const res = await request(app.getHttpServer())
        .post('/laws/downloads/batch')
        .send({
          documents: [
            { url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=1' },
            { url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=2' },
          ],
        })
        .expect(201);

      expect(res.body).toBeDefined();
      expect(mockService.downloadBatch).toHaveBeenCalled();
    });

    it('returns 400 when documents array is empty', async () => {
      await request(app.getHttpServer())
        .post('/laws/downloads/batch')
        .send({ documents: [] })
        .expect(400);
    });
  });

  describe('GET /laws/downloads/search', () => {
    it('returns search results with query params', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/downloads/search')
        .query({ keyword: 'luat lao dong', year: '2025' })
        .expect(200);

      expect(res.body).toHaveProperty('total');
      expect(mockService.search).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'luat lao dong', year: '2025' }),
      );
    });
  });

  describe('POST /laws/downloads/search', () => {
    it('returns search-and-download results', async () => {
      const res = await request(app.getHttpServer())
        .post('/laws/downloads/search')
        .send({ keyword: 'test', maxResults: 10, dryRun: false })
        .expect(201);

      expect(res.body).toHaveProperty('downloaded');
      expect(res.body).toHaveProperty('skipped');
      expect(mockService.downloadBySearch).toHaveBeenCalled();
    });

    it('supports dryRun mode', async () => {
      await request(app.getHttpServer())
        .post('/laws/downloads/search')
        .send({ keyword: 'test', dryRun: true })
        .expect(201);

      expect(mockService.downloadBySearch).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true }),
      );
    });
  });
});
