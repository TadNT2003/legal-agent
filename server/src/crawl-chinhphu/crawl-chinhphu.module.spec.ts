import { Test, TestingModule } from '@nestjs/testing';
import { postgresConfig } from '../config/configuration';
import { crawlConfig } from '../crawl/crawl.config';
import { VbplClientService } from '../crawl/vbpl-client.service';
import { VbplSitemapService } from '../crawl/vbpl-sitemap.service';
import { JobQueueService } from '../job-queue/job-queue.service';
import { JobWorkerService } from '../job-queue/job-worker';
import { DRIZZLE } from '../persistence/db.module';
import { ChinhPhuDocumentRepository } from '../persistence/chinhphu-document.repository';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { DocumentRepository } from '../persistence/document.repository';
import {
  createTestDb,
  createTables,
  dropTables,
  closeTestDb,
} from '../test/setup-test-db';
import { ChinhPhuCrawlController } from './chinhphu-crawl.controller';
import { ChinhPhuCrawlService } from './chinhphu-crawl.service';
import { ChinhPhuSearchService } from './chinhphu-search.service';
import { CrawlChinhPhuModule } from './crawl-chinhphu.module';
import {
  DOCUMENT_TEXT_EXTRACTOR,
  NullDocumentTextExtractor,
} from './document-text-extractor';
import { FallbackSearchService } from './fallback-search.service';

describe('CrawlChinhPhuModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    const testDb = createTestDb();
    createTables();

    moduleRef = await Test.createTestingModule({
      imports: [CrawlChinhPhuModule],
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
      // Importing CrawlModule (for FallbackSearchService's real CrawlService
      // dependency, see crawl-chinhphu.module.ts's own comment) pulls in the
      // same heavy providers crawl.module.spec.ts already has to mock out —
      // a real headless-browser client and a BullMQ worker needing Redis are
      // not what this module-wiring test is about.
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

  it('provides ChinhPhuCrawlService', () => {
    const service = moduleRef.get(ChinhPhuCrawlService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(ChinhPhuCrawlService);
  });

  it('provides ChinhPhuDocumentRepository', () => {
    const repo = moduleRef.get(ChinhPhuDocumentRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(ChinhPhuDocumentRepository);
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

  it('provides a NullDocumentTextExtractor by default', () => {
    const extractor = moduleRef.get(DOCUMENT_TEXT_EXTRACTOR);
    expect(extractor).toBeInstanceOf(NullDocumentTextExtractor);
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

  it('registers ChinhPhuCrawlController', () => {
    const controller = moduleRef.get(ChinhPhuCrawlController);
    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(ChinhPhuCrawlController);
  });
});
