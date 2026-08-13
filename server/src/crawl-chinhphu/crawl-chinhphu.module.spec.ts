import { Test, TestingModule } from '@nestjs/testing';
import { postgresConfig } from '../config/configuration';
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
import { CrawlChinhPhuModule } from './crawl-chinhphu.module';
import {
  DOCUMENT_TEXT_EXTRACTOR,
  NullDocumentTextExtractor,
} from './document-text-extractor';

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

  it('registers ChinhPhuCrawlController', () => {
    const controller = moduleRef.get(ChinhPhuCrawlController);
    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(ChinhPhuCrawlController);
  });
});
