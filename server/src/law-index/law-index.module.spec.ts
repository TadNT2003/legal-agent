import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { LawIndexModule } from './law-index.module';
import { LawIndexService } from './law-index.service';
import { LawIndexController } from './law-index.controller';
import { VbplClientService } from './crawl/vbpl-client.service';
import { VbplSitemapService } from './crawl/vbpl-sitemap.service';
import { DocumentRepository } from './persistence/document.repository';
import { DocumentNodeRepository } from './persistence/document-node.repository';
import { DRIZZLE } from './persistence/db.module';
import { RetrieveModule } from './retrieve/retrieve.module';
import { RetrieveService } from './retrieve/retrieve.service';
import { postgresConfig } from '../config/configuration';
import {
  createTestDb,
  createTables,
  dropTables,
  closeTestDb,
} from '../test/setup-test-db';
import { lawIndexConfig } from './law-index.config';
import { JobQueueService } from './job-queue/job-queue.service';
import { JobWorkerService } from './job-queue/job-worker';
import { opensearchProjectorConfig } from './opensearch/opensearch.config';
import { OPENSEARCH_CLIENT } from './opensearch/opensearch-client.module';
import { IndexAdminService } from './opensearch/index-admin.service';
import { OpenSearchService } from './opensearch/opensearch.service';

describe('LawIndexModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    const testDb = createTestDb();
    createTables();

    moduleRef = await Test.createTestingModule({
      imports: [
        // opensearchProjectorConfig is injected directly by
        // IndexAdminService/OpenSearchService's constructors (not behind a
        // factory provider we can override the way DRIZZLE/OPENSEARCH_CLIENT
        // are below) — a real ConfigModule import resolves it correctly.
        // Every field defaults from `??`, so no env vars are needed here.
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [opensearchProjectorConfig],
        }),
        LawIndexModule,
      ],
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
      .overrideProvider(lawIndexConfig.KEY)
      .useValue({
        vbplBaseUrl: 'https://vbpl.vn',
        maxTier: 9,
        requestDelayMs: 0,
        headless: true,
      })
      .overrideProvider(OPENSEARCH_CLIENT)
      .useValue({})
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

  it('provides LawIndexService', () => {
    const service = moduleRef.get(LawIndexService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(LawIndexService);
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

  it('registers LawIndexController', () => {
    const controller = moduleRef.get(LawIndexController);
    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(LawIndexController);
  });

  it('imports RetrieveModule and provides RetrieveService', () => {
    const retrieveService = moduleRef.get(RetrieveService);
    expect(retrieveService).toBeDefined();
    expect(retrieveService).toBeInstanceOf(RetrieveService);
  });

  it('imports OpenSearchModule and provides IndexAdminService/OpenSearchService', () => {
    const indexAdminService = moduleRef.get(IndexAdminService);
    expect(indexAdminService).toBeDefined();
    expect(indexAdminService).toBeInstanceOf(IndexAdminService);

    const openSearchService = moduleRef.get(OpenSearchService);
    expect(openSearchService).toBeDefined();
    expect(openSearchService).toBeInstanceOf(OpenSearchService);
  });
});
