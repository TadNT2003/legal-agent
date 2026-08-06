import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { LawCatalogController } from './law-catalog.controller';
import { LawCatalogService } from './law-catalog.service';

jest.mock('fs/promises', () => ({
  stat: jest.fn(),
}));

jest.mock('fs', () => {
  const Stream = require('stream');
  return {
    createReadStream: jest.fn().mockImplementation((_path: string) => {
      const s = new Stream.PassThrough();
      s.end(Buffer.alloc(2048, 'x'));
      return s;
    }),
  };
});

jest.mock('archiver', () => {
  const EventEmitter = require('events');
  return jest.fn().mockImplementation(() => {
    const archive = new EventEmitter();
    (archive as any).on = jest.fn().mockReturnThis();
    (archive as any).pipe = jest.fn((dest: any) => {
      dest.end();
      return archive;
    });
    (archive as any).file = jest.fn().mockReturnThis();
    (archive as any).finalize = jest.fn().mockResolvedValue(undefined);
    return archive;
  });
});

import { stat } from 'fs/promises';
import { createReadStream } from 'fs';
import archiver from 'archiver';

const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockCreateReadStream = createReadStream as jest.MockedFunction<typeof createReadStream>;
const mockArchiver = archiver as jest.MockedFunction<typeof archiver>;

describe('LawCatalogController', () => {
  let app: INestApplication;
  let mockCatalog: jest.Mocked<Partial<LawCatalogService>>;

  const mockOverview = [
    { tier: 1, name: 'Luat', documents: 100, totalSize: 5000000 },
    { tier: 2, name: 'Nghi dinh', documents: 200, totalSize: 10000000 },
  ];

  const mockTierStats = {
    tier: 2,
    name: 'Nghi dinh',
    documents: 200,
    totalSize: 10000000,
    subfolders: [],
  };

  const mockStatusResult = {
    citation: '01/2025/QH15',
    title: 'Luat Test',
    fileCount: 2,
    files: [
      { filename: 'main.pdf', existsOnDisk: true },
      { filename: 'phu_luc_1.pdf', existsOnDisk: false },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockCatalog = {
      getTierOverview: jest.fn().mockResolvedValue(mockOverview),
      getTierStats: jest.fn().mockResolvedValue(mockTierStats),
      getDocumentStatus: jest.fn().mockResolvedValue(mockStatusResult),
      findDocumentGroup: jest.fn().mockResolvedValue({}),
    };

    mockStat.mockResolvedValue({ size: 1024 });

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [LawCatalogController],
      providers: [
        { provide: LawCatalogService, useValue: mockCatalog },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /laws/catalog/overview', () => {
    it('returns tier overview without tier parameter', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/catalog/overview')
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(mockCatalog.getTierOverview).toHaveBeenCalled();
    });

    it('returns 400 when tier parameter fails IsInt validation (query string coercion)', async () => {
      await request(app.getHttpServer())
        .get('/laws/catalog/overview')
        .query({ tier: 'notanumber' })
        .expect(400);
    });
  });

  describe('GET /laws/catalog/documents/status', () => {
    it('returns document status for valid citation', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/catalog/documents/status')
        .query({ citation: '01/2025/QH15' })
        .expect(200);

      expect(res.body).toHaveProperty('citation', mockStatusResult.citation);
      expect(res.body).toHaveProperty('fileCount');
      expect(mockCatalog.getDocumentStatus).toHaveBeenCalledWith(
        expect.objectContaining({ citation: '01/2025/QH15' }),
      );
    });

    it('returns document status for valid title', async () => {
      await request(app.getHttpServer())
        .get('/laws/catalog/documents/status')
        .query({ title: 'Bo luat Lao dong' })
        .expect(200);

      expect(mockCatalog.getDocumentStatus).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Bo luat Lao dong' }),
      );
    });

    it('returns 400 when both citation and title are missing', async () => {
      await request(app.getHttpServer())
        .get('/laws/catalog/documents/status')
        .expect(400);
    });
  });

  describe('GET /laws/catalog/documents', () => {
    it('sets up single file stream correctly', async () => {
      mockCatalog.findDocumentGroup.mockResolvedValueOnce({
        citation: '01/2025/QH15',
        title: 'Luat Test',
        score: 1.0,
        files: [
          {
            entry: { filename: 'main.pdf', folder: '01-test' },
            absolutePath: '/laws/01-test/main.pdf',
          },
        ],
      });

      mockStat.mockResolvedValueOnce({ size: 2048 });

      const res = await request(app.getHttpServer())
        .get('/laws/catalog/documents')
        .query({ citation: '01/2025/QH15' })
        .expect(200);

      expect(mockCreateReadStream).toHaveBeenCalledWith('/laws/01-test/main.pdf');
      expect(mockStat).toHaveBeenCalledWith('/laws/01-test/main.pdf');
      expect(res.headers['x-document-citation']).toBeDefined();
      expect(res.headers['x-match-score']).toBe('1');
      expect(res.headers['x-document-file-count']).toBe('1');
    });

    it('returns zip for multi-file document', async () => {
      mockCatalog.findDocumentGroup.mockResolvedValueOnce({
        citation: '02/2025/QH15',
        title: 'Luat Test Multi',
        score: 0.95,
        files: [
          {
            entry: { filename: 'main.pdf', folder: '02-test' },
            absolutePath: '/laws/02-test/main.pdf',
          },
          {
            entry: { filename: 'phu_luc.pdf', folder: '02-test' },
            absolutePath: '/laws/02-test/phu_luc.pdf',
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .get('/laws/catalog/documents')
        .query({ citation: '02/2025/QH15' })
        .expect(200);

      expect(mockArchiver).toHaveBeenCalledWith('zip');
    });

    it('returns 400 when both citation and title are missing', async () => {
      await request(app.getHttpServer())
        .get('/laws/catalog/documents')
        .expect(400);
    });
  });
});