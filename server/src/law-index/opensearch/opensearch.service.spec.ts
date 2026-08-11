import { BadRequestException } from '@nestjs/common';
import type { Client } from '@opensearch-project/opensearch';
import type { FlatNodeRow } from '../persistence/document-node.repository';
import { OpenSearchService } from './opensearch.service';

const config = {
  indexBaseName: 'legal-provisions',
  indexVersion: 1,
  readAlias: 'legal-provisions-read',
  writeAlias: 'legal-provisions-write',
  bulkMaxDocs: 500,
  bulkMaxBytes: 5 * 1024 * 1024,
  numberOfShards: 1,
  numberOfReplicas: 0,
};

interface DocumentMetaRow {
  id: string;
  citationId: string;
  documentType: string;
  issuingBodyId: string;
  authorityRank: number;
  enactedDate: string;
  effectiveDate: string | null;
  contentVersion: string;
}

function buildMeta(
  overrides: Partial<DocumentMetaRow> & { id: string },
): DocumentMetaRow {
  return {
    citationId: '45/2019/QH14',
    documentType: 'Luật',
    issuingBodyId: 'body-1',
    authorityRank: 2,
    enactedDate: '2019-11-20',
    effectiveDate: '2021-01-01',
    contentVersion: 'hash-1',
    ...overrides,
  };
}

let idCounter = 0;
function buildNode(
  overrides: Partial<FlatNodeRow> & { nodeType: string; documentId: string },
): FlatNodeRow {
  idCounter += 1;
  return {
    id: `node-${idCounter}`,
    parentId: null,
    contentClass: null,
    path: `path${idCounter}`,
    ordinal: String(idCounter),
    label: `Điều ${idCounter}`,
    heading: null,
    textContent: 'Nội dung.',
    contentHash: `hash-${idCounter}`,
    status: null,
    validFrom: '2019-11-20',
    validTo: null,
    supersededByNodeId: null,
    ...overrides,
  };
}

/** Chain terminates at `.where(...)` — matches fetchDocumentMetaByIds, which never calls orderBy/limit. */
function buildDbForIds(rows: DocumentMetaRow[]) {
  return {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(rows),
  };
}

/** Chain terminates at `.limit(...)` — matches fetchDocumentMetaPage. `pages` is consumed one call per page, `[]` signals exhaustion. */
function buildDbForPages(pages: DocumentMetaRow[][]) {
  let call = 0;
  return {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockImplementation(() => {
      const page = pages[call] ?? [];
      call += 1;
      return Promise.resolve(page);
    }),
  };
}

function buildClient() {
  return {
    bulk: jest.fn().mockResolvedValue({ body: { errors: false, items: [] } }),
    deleteByQuery: jest.fn().mockResolvedValue({ body: { deleted: 0 } }),
    search: jest.fn(),
    indices: {
      refresh: jest.fn().mockResolvedValue({ body: {} }),
    },
  };
}

function buildDocumentRepository(db: unknown) {
  return {
    getDb: jest.fn().mockReturnValue(db),
    findDocumentIdByCitation: jest.fn(),
  };
}

function buildDocumentNodeRepository(
  nodesByDocumentId: Record<string, FlatNodeRow[]>,
) {
  return {
    findAllNodes: jest
      .fn()
      .mockImplementation((documentId: string) =>
        Promise.resolve(nodesByDocumentId[documentId] ?? []),
      ),
  };
}

describe('OpenSearchService', () => {
  describe('backfill', () => {
    it('projects and bulk-indexes documents given explicit documentIds', async () => {
      const meta = buildMeta({ id: 'doc-1' });
      const node = buildNode({
        nodeType: 'dieu',
        documentId: 'doc-1',
        textContent: 'Nội dung điều 1.',
      });
      const client = buildClient();
      const documentRepository = buildDocumentRepository(buildDbForIds([meta]));
      const documentNodeRepository = buildDocumentNodeRepository({
        'doc-1': [node],
      });
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const summary = await service.backfill({ documentIds: ['doc-1'] });

      expect(summary).toEqual({
        documentsProcessed: 1,
        provisionsIndexed: 1,
        templatePhuLucSkipped: 0,
        errors: [],
        errorsTruncated: false,
      });
      expect(client.bulk).toHaveBeenCalledTimes(1);
      const [{ body: bulkLines }] = client.bulk.mock.calls[0] as [
        { body: string[] },
      ];
      expect(JSON.parse(bulkLines[0])).toEqual({
        index: { _index: 'legal-provisions-write', _id: node.id },
      });
      expect(JSON.parse(bulkLines[1])).toMatchObject({
        document_id: 'doc-1',
        citation_id: '45/2019/QH14',
      });
      expect(client.indices.refresh).toHaveBeenCalledWith({
        index: 'legal-provisions-write',
      });
    });

    it('flushes the bulk buffer at bulkMaxDocs rather than waiting for the end', async () => {
      const smallBatchConfig = { ...config, bulkMaxDocs: 1 };
      const metas = [buildMeta({ id: 'doc-1' }), buildMeta({ id: 'doc-2' })];
      const nodes = {
        'doc-1': [buildNode({ nodeType: 'dieu', documentId: 'doc-1' })],
        'doc-2': [buildNode({ nodeType: 'dieu', documentId: 'doc-2' })],
      };
      const client = buildClient();
      const documentRepository = buildDocumentRepository(buildDbForIds(metas));
      const documentNodeRepository = buildDocumentNodeRepository(nodes);
      const service = new OpenSearchService(
        client as unknown as Client,
        smallBatchConfig,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const summary = await service.backfill({
        documentIds: ['doc-1', 'doc-2'],
      });

      expect(summary.documentsProcessed).toBe(2);
      expect(summary.provisionsIndexed).toBe(2);
      expect(client.bulk).toHaveBeenCalledTimes(2);
    });

    it('records a per-document processing failure without aborting the rest', async () => {
      const metas = [buildMeta({ id: 'doc-1' }), buildMeta({ id: 'doc-2' })];
      const client = buildClient();
      const documentRepository = buildDocumentRepository(buildDbForIds(metas));
      const documentNodeRepository = {
        findAllNodes: jest
          .fn()
          .mockImplementationOnce(() => Promise.reject(new Error('boom')))
          .mockImplementationOnce(() =>
            Promise.resolve([
              buildNode({ nodeType: 'dieu', documentId: 'doc-2' }),
            ]),
          ),
      };
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const summary = await service.backfill({
        documentIds: ['doc-1', 'doc-2'],
      });

      expect(summary.documentsProcessed).toBe(1);
      expect(summary.errors).toEqual([{ id: 'doc-1', error: 'boom' }]);
      expect(summary.errorsTruncated).toBe(false);
    });

    it('records per-item bulk errors without throwing', async () => {
      const meta = buildMeta({ id: 'doc-1' });
      const node = buildNode({ nodeType: 'dieu', documentId: 'doc-1' });
      const client = buildClient();
      client.bulk.mockResolvedValue({
        body: {
          errors: true,
          items: [
            {
              index: {
                _id: node.id,
                error: {
                  type: 'mapper_parsing_exception',
                  reason: 'bad field',
                },
              },
            },
          ],
        },
      });
      const documentRepository = buildDocumentRepository(buildDbForIds([meta]));
      const documentNodeRepository = buildDocumentNodeRepository({
        'doc-1': [node],
      });
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const summary = await service.backfill({ documentIds: ['doc-1'] });

      expect(summary.errors).toEqual([
        { id: node.id, error: 'mapper_parsing_exception: bad field' },
      ]);
    });

    it('caps errors at 100 and sets errorsTruncated', async () => {
      const ids = Array.from({ length: 105 }, (_, i) => `doc-${i}`);
      const metas = ids.map((id) => buildMeta({ id }));
      const client = buildClient();
      const documentRepository = buildDocumentRepository(buildDbForIds(metas));
      const documentNodeRepository = {
        findAllNodes: jest.fn().mockRejectedValue(new Error('always fails')),
      };
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const summary = await service.backfill({ documentIds: ids });

      expect(summary.errors).toHaveLength(100);
      expect(summary.errorsTruncated).toBe(true);
    });

    it('paginates by document.id keyset when no documentIds are given', async () => {
      const page1 = [buildMeta({ id: 'doc-1' }), buildMeta({ id: 'doc-2' })];
      const client = buildClient();
      const db = buildDbForPages([page1, []]);
      const documentRepository = buildDocumentRepository(db);
      const documentNodeRepository = buildDocumentNodeRepository({
        'doc-1': [buildNode({ nodeType: 'dieu', documentId: 'doc-1' })],
        'doc-2': [buildNode({ nodeType: 'dieu', documentId: 'doc-2' })],
      });
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const summary = await service.backfill({});

      expect(summary.documentsProcessed).toBe(2);
      expect(db.orderBy).toHaveBeenCalled();
      expect(db.limit).toHaveBeenCalled();
    });

    it('stops at the requested limit', async () => {
      const page1 = [
        buildMeta({ id: 'doc-1' }),
        buildMeta({ id: 'doc-2' }),
        buildMeta({ id: 'doc-3' }),
      ];
      const client = buildClient();
      const db = buildDbForPages([page1]);
      const documentRepository = buildDocumentRepository(db);
      const documentNodeRepository = buildDocumentNodeRepository({
        'doc-1': [buildNode({ nodeType: 'dieu', documentId: 'doc-1' })],
        'doc-2': [buildNode({ nodeType: 'dieu', documentId: 'doc-2' })],
        'doc-3': [buildNode({ nodeType: 'dieu', documentId: 'doc-3' })],
      });
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const summary = await service.backfill({ limit: 2 });

      expect(summary.documentsProcessed).toBe(2);
    });
  });

  describe('reprojectDocument', () => {
    it('deletes previously-indexed provisions before reindexing the fresh set', async () => {
      const meta = buildMeta({ id: 'doc-1' });
      const node = buildNode({ nodeType: 'dieu', documentId: 'doc-1' });
      const client = buildClient();
      const documentRepository = buildDocumentRepository(buildDbForIds([meta]));
      const documentNodeRepository = buildDocumentNodeRepository({
        'doc-1': [node],
      });
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const result = await service.reprojectDocument({ documentId: 'doc-1' });

      expect(client.deleteByQuery).toHaveBeenCalledWith({
        index: 'legal-provisions-write',
        body: { query: { term: { document_id: 'doc-1' } } },
      });
      expect(client.bulk).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        documentId: 'doc-1',
        citationId: '45/2019/QH14',
        provisionsIndexed: 1,
        templatePhuLucSkipped: 0,
      });
    });

    it('resolves documentId via citation when documentId is not given', async () => {
      const meta = buildMeta({ id: 'doc-1' });
      const client = buildClient();
      const documentRepository = buildDocumentRepository(buildDbForIds([meta]));
      documentRepository.findDocumentIdByCitation.mockResolvedValue('doc-1');
      const documentNodeRepository = buildDocumentNodeRepository({
        'doc-1': [buildNode({ nodeType: 'dieu', documentId: 'doc-1' })],
      });
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const result = await service.reprojectDocument({
        citation: '45/2019/QH14',
      });

      expect(documentRepository.findDocumentIdByCitation).toHaveBeenCalledWith(
        '45/2019/QH14',
      );
      expect(result.documentId).toBe('doc-1');
    });

    it('throws when neither documentId nor a resolvable citation is given', async () => {
      const client = buildClient();
      const documentRepository = buildDocumentRepository(buildDbForIds([]));
      documentRepository.findDocumentIdByCitation.mockResolvedValue(null);
      const documentNodeRepository = buildDocumentNodeRepository({});
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      await expect(
        service.reprojectDocument({ citation: 'no-such-citation' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when the resolved documentId has no matching document row', async () => {
      const client = buildClient();
      const documentRepository = buildDocumentRepository(buildDbForIds([]));
      const documentNodeRepository = buildDocumentNodeRepository({});
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      await expect(
        service.reprojectDocument({ documentId: 'missing-doc' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('search', () => {
    it('builds the §3d query shape and maps hits + inner_hits', async () => {
      const client = buildClient();
      client.search.mockResolvedValue({
        body: {
          hits: {
            total: { value: 1, relation: 'eq' },
            hits: [
              {
                _id: 'node-1',
                _score: 3.2,
                _source: {
                  document_id: 'doc-1',
                  citation_id: '45/2019/QH14',
                  document_type: 'Luật',
                  path: 'dieu5',
                  label: 'Điều 5',
                  heading: 'Some heading',
                },
                inner_hits: {
                  khoan: {
                    hits: {
                      total: { value: 1, relation: 'eq' },
                      hits: [
                        {
                          _id: 'khoan-1',
                          _source: {
                            khoan_id: 'khoan-1',
                            label: 'Khoản 2',
                            text: 'matched text',
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      });
      const documentRepository = buildDocumentRepository(buildDbForIds([]));
      const documentNodeRepository = buildDocumentNodeRepository({});
      const service = new OpenSearchService(
        client as unknown as Client,
        config,
        documentRepository as never,
        documentNodeRepository as never,
      );

      const result = await service.search({ query: 'điều kiện hiệu lực' });

      expect(client.search).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'legal-provisions-read' }),
      );
      expect(result).toEqual({
        total: 1,
        page: 1,
        pageSize: 10,
        items: [
          {
            documentId: 'doc-1',
            citationId: '45/2019/QH14',
            documentType: 'Luật',
            path: 'dieu5',
            label: 'Điều 5',
            heading: 'Some heading',
            score: 3.2,
            matchedKhoan: [
              { khoanId: 'khoan-1', label: 'Khoản 2', text: 'matched text' },
            ],
          },
        ],
      });
    });
  });
});
