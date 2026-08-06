import { BadRequestException } from '@nestjs/common';
import type { Client } from '@opensearch-project/opensearch';
import { IndexAdminService } from './index-admin.service';
import {
  LEGAL_PROVISIONS_ANALYSIS_SETTINGS,
  LEGAL_PROVISIONS_MAPPINGS,
  LEGAL_PROVISIONS_MAX_ANALYZED_OFFSET,
} from './legal-provisions.mapping';

const config = {
  indexBaseName: 'legal_provisions',
  indexVersion: 1,
  readAlias: 'legal-provisions-read',
  writeAlias: 'legal-provisions-write',
  bulkMaxDocs: 500,
  bulkMaxBytes: 5 * 1024 * 1024,
  numberOfShards: 1,
  numberOfReplicas: 0,
};

class NotFoundError extends Error {
  statusCode = 404;
}

function buildClient() {
  return {
    indices: {
      exists: jest.fn(),
      create: jest.fn().mockResolvedValue({ body: { acknowledged: true } }),
      updateAliases: jest
        .fn()
        .mockResolvedValue({ body: { acknowledged: true } }),
      getAlias: jest.fn(),
      delete: jest.fn().mockResolvedValue({ body: { acknowledged: true } }),
    },
    cluster: {
      health: jest.fn(),
    },
    count: jest.fn(),
  };
}

describe('IndexAdminService', () => {
  let client: ReturnType<typeof buildClient>;
  let service: IndexAdminService;

  beforeEach(() => {
    client = buildClient();
    service = new IndexAdminService(client as unknown as Client, config);
  });

  describe('ensureIndex', () => {
    it('creates the concrete index with mappings, settings, and both aliases when absent', async () => {
      client.indices.exists.mockResolvedValue({ body: false });

      const result = await service.ensureIndex();

      expect(result).toEqual({ created: true, index: 'legal_provisions_v1' });
      expect(client.indices.create).toHaveBeenCalledWith({
        index: 'legal_provisions_v1',
        body: {
          settings: {
            index: {
              number_of_shards: 1,
              number_of_replicas: 0,
              highlight: {
                max_analyzed_offset: LEGAL_PROVISIONS_MAX_ANALYZED_OFFSET,
              },
            },
            analysis: LEGAL_PROVISIONS_ANALYSIS_SETTINGS,
          },
          mappings: LEGAL_PROVISIONS_MAPPINGS,
          aliases: {
            'legal-provisions-read': {},
            'legal-provisions-write': { is_write_index: true },
          },
        },
      });
    });

    it('is a no-op when the index already exists', async () => {
      client.indices.exists.mockResolvedValue({ body: true });

      const result = await service.ensureIndex();

      expect(result).toEqual({
        created: false,
        index: 'legal_provisions_v1',
      });
      expect(client.indices.create).not.toHaveBeenCalled();
    });
  });

  describe('promoteAliases', () => {
    it('atomically removes both aliases everywhere and adds them to the target version', async () => {
      const result = await service.promoteAliases(2);

      expect(result).toEqual({
        index: 'legal_provisions_v2',
        readAlias: 'legal-provisions-read',
        writeAlias: 'legal-provisions-write',
      });
      expect(client.indices.updateAliases).toHaveBeenCalledWith({
        body: {
          actions: [
            { remove: { index: '*', alias: 'legal-provisions-read' } },
            { remove: { index: '*', alias: 'legal-provisions-write' } },
            {
              add: {
                index: 'legal_provisions_v2',
                alias: 'legal-provisions-read',
              },
            },
            {
              add: {
                index: 'legal_provisions_v2',
                alias: 'legal-provisions-write',
                is_write_index: true,
              },
            },
          ],
        },
      });
    });
  });

  describe('getStatus', () => {
    it('returns nulls when the read alias resolves to nothing yet', async () => {
      client.indices.getAlias.mockRejectedValue(new NotFoundError('missing'));

      const status = await service.getStatus();

      expect(status).toEqual({
        readAlias: 'legal-provisions-read',
        writeAlias: 'legal-provisions-write',
        resolvedIndex: null,
        health: null,
        docsCount: null,
      });
      expect(client.cluster.health).not.toHaveBeenCalled();
    });

    it('resolves the alias and reports health/doc count', async () => {
      client.indices.getAlias.mockResolvedValue({
        body: { legal_provisions_v1: { aliases: {} } },
      });
      client.cluster.health.mockResolvedValue({ body: { status: 'green' } });
      client.count.mockResolvedValue({ body: { count: 70497 } });

      const status = await service.getStatus();

      expect(status).toEqual({
        readAlias: 'legal-provisions-read',
        writeAlias: 'legal-provisions-write',
        resolvedIndex: 'legal_provisions_v1',
        health: 'green',
        docsCount: 70497,
      });
      expect(client.cluster.health).toHaveBeenCalledWith({
        index: 'legal_provisions_v1',
      });
      expect(client.count).toHaveBeenCalledWith({
        index: 'legal_provisions_v1',
      });
    });
  });

  describe('dropIndex', () => {
    it('refuses to drop an index still attached to an alias', async () => {
      client.indices.getAlias.mockResolvedValue({
        body: {
          legal_provisions_v1: {
            aliases: { 'legal-provisions-read': {} },
          },
        },
      });

      await expect(service.dropIndex('legal_provisions_v1')).rejects.toThrow(
        BadRequestException,
      );
      expect(client.indices.delete).not.toHaveBeenCalled();
    });

    it('deletes an index with no aliases attached', async () => {
      client.indices.getAlias.mockResolvedValue({
        body: { legal_provisions_v0: { aliases: {} } },
      });

      await service.dropIndex('legal_provisions_v0');

      expect(client.indices.delete).toHaveBeenCalledWith({
        index: 'legal_provisions_v0',
      });
    });

    it('deletes an index that has no aliases at all (getAlias 404s)', async () => {
      client.indices.getAlias.mockRejectedValue(new NotFoundError('missing'));

      await service.dropIndex('legal_provisions_v0');

      expect(client.indices.delete).toHaveBeenCalledWith({
        index: 'legal_provisions_v0',
      });
    });
  });

  describe('dropIndexVersion', () => {
    it('resolves the version number to a concrete index name before dropping', async () => {
      client.indices.getAlias.mockResolvedValue({
        body: { legal_provisions_v0: { aliases: {} } },
      });

      await service.dropIndexVersion(0);

      expect(client.indices.delete).toHaveBeenCalledWith({
        index: 'legal_provisions_v0',
      });
    });
  });
});
