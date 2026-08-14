import { Test, TestingModule } from '@nestjs/testing';
import { CrawlModule } from './crawl.module';
import { CrawlService } from './crawl.service';
import { CrawlController } from './crawl.controller';
import { ChinhPhuCrawlService } from './chinhphu-crawl.service';
import { ChinhPhuSearchService } from './chinhphu-search.service';
import { FallbackSearchService } from './fallback-search.service';
import {
  DOCUMENT_TEXT_EXTRACTOR,
  NullDocumentTextExtractor,
} from './document-text-extractor';
import { VbplClientService } from './vbpl-client.service';
import { VbplSitemapService } from './vbpl-sitemap.service';
import { ChinhPhuDocumentRepository } from '../persistence/chinhphu-document.repository';
import { DocumentRepository } from '../persistence/document.repository';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { DRIZZLE } from '../persistence/db.module';
import { postgresConfig } from '../config/configuration';
import {
  createTestDb,
  createTables,
  dropTables,
  closeTestDb,
} from '../test/setup-test-db';
import { crawlConfig } from './crawl.config';
import { JobQueueService } from '../job-queue/job-queue.service';
import { JobWorkerService } from '../job-queue/job-worker';

describe('CrawlModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    const testDb = createTestDb();
    createTables();

    moduleRef = await Test.createTestingModule({
      imports: [CrawlModule],
    })
      .overrideProvider(postgresConfig.KEY)
      .useValue({
        host: 'localhost',
        port: 5432,
        username: 'test',
        password: 'test',
        database: 'test',
      })
      .overrideProvider(DRIZZLE)
      .useValue(testDb)
      .overrideProvider(crawlConfig.KEY)
      .useValue({
        vbplBaseUrl: 'https://vbpl.vn',
        maxTier: 9,
        requestDelayMs: 0,
        headless: true,
      })
      .overrideProvider(VbplClientService)
      .useValue({
        fetchDocument: jest.fn().mockResolvedValue({}),
        searchDocuments: jest.fn().mockResolvedValue(''),
        assertTrustedDocumentUrl: jest
          .fn()
          .mockImplementation((url) => new URL(url)),
        onModuleDestroy: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(VbplSitemapService)
      .useValue({
        fetchTrungUongSitemapUrls: jest.fn().mockResolvedValue([]),
      })
      // JobWorkerService's real onModuleInit() would construct a real BullMQ
      // Worker (needing a real Redis connection) — not what this module-
      // wiring test is about, so both job-queue providers are replaced with
      // plain mocks the same way VbplClientService/VbplSitemapService are
      // above.
      .overrideProvider(JobQueueService)
      .useValue({
        addJob: jest.fn(),
        getJob: jest.fn(),
        cancelJob: jest.fn(),
        onModuleDestroy: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(JobWorkerService)
      .useValue({
        onModuleDestroy: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
  });

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
    dropTables();
    closeTestDb();
  });

  it('compiles successfully', () => {
    expect(moduleRef).toBeDefined();
  });

  it('provides CrawlService', () => {
    const service = moduleRef.get(CrawlService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(CrawlService);
  });

  it('provides DocumentRepository', () => {
    const repo = moduleRef.get(DocumentRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(DocumentRepository);
  });

  it('provides DocumentNodeRepository', () => {
    const repo = moduleRef.get(DocumentNodeRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(DocumentNodeRepository);
  });

  it('provides DRIZZLE token', () => {
    const drizzle = moduleRef.get(DRIZZLE);
    expect(drizzle).toBeDefined();
  });

  it('provides ChinhPhuCrawlService', () => {
    const service = moduleRef.get(ChinhPhuCrawlService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(ChinhPhuCrawlService);
  });

  it('provides ChinhPhuSearchService', () => {
    const service = moduleRef.get(ChinhPhuSearchService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(ChinhPhuSearchService);
  });

  it('provides FallbackSearchService', () => {
    const service = moduleRef.get(FallbackSearchService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(FallbackSearchService);
  });

  it('provides ChinhPhuDocumentRepository', () => {
    const repo = moduleRef.get(ChinhPhuDocumentRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(ChinhPhuDocumentRepository);
  });

  it('provides a NullDocumentTextExtractor by default', () => {
    const extractor = moduleRef.get(DOCUMENT_TEXT_EXTRACTOR);
    expect(extractor).toBeInstanceOf(NullDocumentTextExtractor);
  });

  it('registers CrawlController', () => {
    const controller = moduleRef.get(CrawlController);
    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(CrawlController);
  });
});
