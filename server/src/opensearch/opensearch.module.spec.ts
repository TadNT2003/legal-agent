import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { OpenSearchModule } from './opensearch.module';
import { OpenSearchController } from './opensearch.controller';
import { IndexAdminService } from './index-admin.service';
import { OpenSearchService } from './opensearch.service';
import { OPENSEARCH_CLIENT } from './opensearch-client.module';
import { opensearchProjectorConfig } from './opensearch.config';
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

describe('OpenSearchModule', () => {
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
        OpenSearchModule,
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
      .overrideProvider(OPENSEARCH_CLIENT)
      .useValue({})
      .compile();
  });

  afterEach(async () => {
    await moduleRef.close();
    dropTables();
    closeTestDb();
  });

  it('compiles successfully', () => {
    expect(moduleRef).toBeDefined();
  });

  it('provides IndexAdminService', () => {
    const service = moduleRef.get(IndexAdminService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(IndexAdminService);
  });

  it('provides OpenSearchService', () => {
    const service = moduleRef.get(OpenSearchService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(OpenSearchService);
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

  it('registers OpenSearchController', () => {
    const controller = moduleRef.get(OpenSearchController);
    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(OpenSearchController);
  });

  it('provides DRIZZLE token via imported DbModule', () => {
    const drizzle = moduleRef.get(DRIZZLE);
    expect(drizzle).toBeDefined();
  });
});
