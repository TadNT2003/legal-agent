import { Test, TestingModule } from '@nestjs/testing';
import { DbModule, DRIZZLE } from './db.module';
import { postgresConfig } from '../../config/configuration';

describe('DbModule', () => {
  let moduleRef: TestingModule;

  describe('with mocked config and DRIZZLE', () => {
    beforeEach(async () => {
      const mockDb = {
        select: jest.fn(),
        insert: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      };

      moduleRef = await Test.createTestingModule({
        imports: [DbModule],
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
        .useValue(mockDb)
        .compile();
    });

    afterEach(async () => {
      await moduleRef.close();
    });

    it('compiles without error', () => {
      expect(moduleRef).toBeDefined();
    });

    it('provides DRIZZLE token', () => {
      const drizzle = moduleRef.get(DRIZZLE);
      expect(drizzle).toBeDefined();
    });

    it('DRIZZLE token is the mock object', () => {
      const drizzle = moduleRef.get(DRIZZLE);
      expect(typeof drizzle.select).toBe('function');
      expect(typeof drizzle.insert).toBe('function');
      expect(typeof drizzle.update).toBe('function');
      expect(typeof drizzle.delete).toBe('function');
    });
  });
});
