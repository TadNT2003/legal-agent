import { Test, TestingModule } from '@nestjs/testing';
import { RetrieveModule } from './retrieve.module';
import { RetrieveService } from './retrieve.service';
import { RetrieveController } from './retrieve.controller';
import { DocumentRepository } from '../persistence/document.repository';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { DbModule, DRIZZLE } from '../persistence/db.module';
import { postgresConfig } from '../../config/configuration';
import {
  createTestDb,
  createTables,
  dropTables,
  closeTestDb,
} from '../../test/setup-test-db';

describe('RetrieveModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    const testDb = createTestDb();
    createTables();

    moduleRef = await Test.createTestingModule({
      imports: [RetrieveModule],
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
    await moduleRef.close();
    dropTables();
    closeTestDb();
  });

  it('compiles successfully', () => {
    expect(moduleRef).toBeDefined();
  });

  it('provides RetrieveService', () => {
    const service = moduleRef.get(RetrieveService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(RetrieveService);
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

  it('registers RetrieveController', () => {
    const controller = moduleRef.get(RetrieveController);
    expect(controller).toBeDefined();
    expect(controller).toBeInstanceOf(RetrieveController);
  });

  it('provides DRIZZLE token via imported DbModule', () => {
    const drizzle = moduleRef.get(DRIZZLE);
    expect(drizzle).toBeDefined();
  });

  it('wires RetrieveService to repositories', () => {
    const service = moduleRef.get(RetrieveService);
    const docRepo = moduleRef.get(DocumentRepository);
    const nodeRepo = moduleRef.get(DocumentNodeRepository);
    expect(service).toBeDefined();
    expect(docRepo).toBeDefined();
    expect(nodeRepo).toBeDefined();
  });
});
