jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  document as docSchema,
  documentNode as docNodeSchema,
  issuingBody as ibSchema,
} from './schema/sqlite-schema';
import { DocumentNodeRepository } from './document-node.repository';
import type { ParsedVbplDocument } from '../crawl/vbpl-document.interface';

let sqlite: Database;
let db: any;
let repo: DocumentNodeRepository;

const makeParsedDoc = (fullText: string, effectiveDateRaw?: string): ParsedVbplDocument => ({
  sourceUrl: 'https://vbpl.vn/van-ban/chi-tiet/123',
  scope: 'trung-uong',
  title: 'Test Document',
  fullText,
  attributes: {
    citation: '01/2025/QH15',
    documentType: 'Luật',
    industry: null,
    field: null,
    issuingBody: 'Quốc hội',
    signerTitle: null,
    signerName: null,
    issuedDateRaw: '01/01/2025',
    effectiveDateRaw: effectiveDateRaw ?? '01/06/2025',
    expiryDateRaw: null,
    validityStatusRaw: 'còn hiệu lực',
  },
  consolidation: {
    consolidatesRawTitles: [],
    consolidatedIntoRawTitles: [],
  },
  relations: [],
});

describe('DocumentNodeRepository (SQLite integration)', () => {
  beforeAll(() => {
    sqlite = new Database(':memory:');
    sqlite.function('gen_random_uuid', () => randomUUID());
    sqlite.function('now', { deterministic: false }, () => new Date().toISOString());
    sqlite.exec(`
      CREATE TABLE issuing_body (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        name_en TEXT,
        authority_rank INTEGER NOT NULL,
        scope TEXT NOT NULL DEFAULT 'national',
        parent_body_id TEXT
      );
      CREATE TABLE document (
        id TEXT PRIMARY KEY,
        citation_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        document_type TEXT NOT NULL,
        issuing_body_id TEXT NOT NULL,
        industry TEXT,
        field TEXT,
        signer_name TEXT,
        signer_title TEXT,
        enacted_date TEXT NOT NULL,
        effective_date TEXT,
        expiry_date TEXT,
        gazette_published_date TEXT,
        status TEXT,
        index_scope TEXT NOT NULL DEFAULT 'full',
        is_consolidated INTEGER NOT NULL DEFAULT 0,
        consolidates_document_id TEXT,
        raw_source TEXT,
        original_document_urls TEXT NOT NULL DEFAULT '[]',
        content_version TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE document_node (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        parent_id TEXT,
        node_type TEXT NOT NULL,
        content_class TEXT,
        path TEXT NOT NULL,
        ordinal TEXT NOT NULL,
        label TEXT NOT NULL,
        heading TEXT,
        text_content TEXT,
        content_hash TEXT NOT NULL,
        status TEXT,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        superseded_by_node_id TEXT
      );
      CREATE TABLE document_reference (
        id TEXT PRIMARY KEY,
        source_document_id TEXT,
        target_document_id TEXT,
        source_node_id TEXT,
        target_node_id TEXT,
        reference_type TEXT NOT NULL,
        change_type TEXT,
        raw_citation_text TEXT NOT NULL,
        extraction_method TEXT NOT NULL DEFAULT 'deterministic',
        confidence REAL,
        created_at TEXT
      );
    `);
    db = drizzle(sqlite, {
      schema: { document: docSchema, documentNode: docNodeSchema, issuingBody: ibSchema },
    });
    repo = new DocumentNodeRepository(db);
  });

  afterAll(() => {
    sqlite.close();
  });

  beforeEach(() => {
    sqlite.exec('DELETE FROM document_node');
    sqlite.exec('DELETE FROM document');
    sqlite.exec('DELETE FROM issuing_body');
  });

  describe('syncNodes', () => {
    it('builds nodes from full text when content changed', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, effective_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Test', 'Luật', 'ib-1', '2025-01-01', '2025-06-01', 'v1', 'con_hieu_luc', 0)`);

      const parsed = makeParsedDoc('PHẦN I\n\nCHƯƠNG I. Quy định chung\n\nĐiều 1. Phạm vi điều chỉnh\n\n1. Phạm vi điều chỉnh áp dụng.\n\na) Áp dụng đối với tổ chức.\nb) Áp dụng đối với cá nhân.\n\nĐiều 2. Điều khoản thi hành\n\nLuật có hiệu lực từ ngày promulgationDate.');

      await repo.syncNodes('doc-1', parsed, true);

      const nodes = sqlite.prepare('SELECT * FROM document_node WHERE document_id = ? ORDER BY path').all('doc-1');
      expect(nodes.length).toBeGreaterThan(0);

      const rootNodes = nodes.filter((n: any) => n.parent_id === null);
      expect(rootNodes.length).toBeGreaterThan(0);

      const partNode = nodes.find((n: any) => n.node_type === 'phan');
      expect(partNode).toBeDefined();

      const chapterNode = nodes.find((n: any) => n.node_type === 'chuong');
      expect(chapterNode).toBeDefined();

      const articleNodes = nodes.filter((n: any) => n.node_type === 'dieu');
      expect(articleNodes.length).toBeGreaterThanOrEqual(2);
    });

    it('skips sync when content unchanged and nodes exist', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, effective_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Test', 'Luật', 'ib-1', '2025-01-01', '2025-06-01', 'v1', 'con_hieu_luc', 0)`);

      const parsed = makeParsedDoc('CHƯƠNG I.\nĐiều 1. Test\n1. Text.');

      await repo.syncNodes('doc-1', parsed, true);

      const nodeCountBefore = sqlite.prepare('SELECT COUNT(*) as cnt FROM document_node WHERE document_id = ?').get('doc-1');

      await repo.syncNodes('doc-1', parsed, false);

      const nodeCountAfter = sqlite.prepare('SELECT COUNT(*) as cnt FROM document_node WHERE document_id = ?').get('doc-1');

      expect(nodeCountAfter.cnt).toBe(nodeCountBefore.cnt);
    });

    it('backfills nodes when content unchanged but no nodes exist', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, effective_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Test', 'Luật', 'ib-1', '2025-01-01', '2025-06-01', 'v1', 'con_hieu_luc', 0)`);

      const parsed = makeParsedDoc('CHƯƠNG I.\nĐiều 1. Test\n1. Text.');

      await repo.syncNodes('doc-1', parsed, false);

      const nodes = sqlite.prepare('SELECT COUNT(*) as cnt FROM document_node WHERE document_id = ?').get('doc-1');
      expect(nodes.cnt).toBeGreaterThan(0);
    });

    it('throws when document not found', async () => {
      const parsed = makeParsedDoc('CHƯƠNG I.\nĐiều 1. Test.');
      await expect(repo.syncNodes('nonexistent', parsed, true)).rejects.toThrow('not found');
    });
  });

  describe('fetchDocumentInfo', () => {
    it('returns citation and title for existing document', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Test Document', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);

      const info = await repo.fetchDocumentInfo('doc-1');
      expect(info.citationId).toBe('01/2025/QH15');
      expect(info.title).toBe('Test Document');
    });

    it('throws NotFoundException for missing document', async () => {
      await expect(repo.fetchDocumentInfo('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('findAllNodes', () => {
    it('returns all nodes ordered by path', async () => {
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n1', 'doc-1', NULL, 'chuong', 'chuong1', '1', 'Chương I', 'Quy định chung', NULL, 'hash1', '2025-06-01', 'con_hieu_luc')`);
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n2', 'doc-1', 'n1', 'dieu', 'chuong1.dieu1', '1', 'Điều 1', 'Phạm vi', 'Content', 'hash2', '2025-06-01', 'con_hieu_luc')`);
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n3', 'doc-1', 'n1', 'dieu', 'chuong1.dieu2', '2', 'Điều 2', 'Thi hành', 'Content 2', 'hash3', '2025-06-01', 'con_hieu_luc')`);

      const nodes = await repo.findAllNodes('doc-1');
      expect(nodes.length).toBe(3);
      expect(nodes[0].nodeType).toBe('chuong');
      expect(nodes[1].nodeType).toBe('dieu');
      expect(nodes[1].ordinal).toBe('1');
      expect(nodes[2].ordinal).toBe('2');
    });

    it('filters by nodeType', async () => {
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n1', 'doc-1', NULL, 'chuong', 'chuong1', '1', 'Chương I', 'Quy định chung', NULL, 'hash1', '2025-06-01', 'con_hieu_luc')`);
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n2', 'doc-1', 'n1', 'dieu', 'chuong1.dieu1', '1', 'Điều 1', 'Phạm vi', 'Content', 'hash2', '2025-06-01', 'con_hieu_luc')`);

      const nodes = await repo.findAllNodes('doc-1', 'dieu');
      expect(nodes.length).toBe(1);
      expect(nodes[0].nodeType).toBe('dieu');
    });

    it('filters by ordinal number', async () => {
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n1', 'doc-1', 'n1p', 'dieu', 'chuong1.dieu1', '1', 'Điều 1', 'Phạm vi', 'Content', 'hash1', '2025-06-01', 'con_hieu_luc')`);
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n2', 'doc-1', 'n1p', 'dieu', 'chuong1.dieu2', '2', 'Điều 2', 'Thi hành', 'Content 2', 'hash2', '2025-06-01', 'con_hieu_luc')`);

      const nodes = await repo.findAllNodes('doc-1', undefined, '2');
      expect(nodes.length).toBe(1);
      expect(nodes[0].ordinal).toBe('2');
    });

    it('returns empty for non-existent document', async () => {
      const nodes = await repo.findAllNodes('nonexistent');
      expect(nodes.length).toBe(0);
    });
  });

  describe('findNodeSubtree', () => {
    it('returns all nodes when nodeId exists in document', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Test Document', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n1', 'doc-1', NULL, 'chuong', 'chuong1', '1', 'Chương I', 'Quy định chung', NULL, 'hash1', '2025-06-01', 'con_hieu_luc')`);
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n2', 'doc-1', 'n1', 'dieu', 'chuong1.dieu1', '1', 'Điều 1', 'Phạm vi', 'Content', 'hash2', '2025-06-01', 'con_hieu_luc')`);

      const result = await repo.findNodeSubtree('doc-1', 'n1');
      expect(result.docInfo.citationId).toBe('01/2025/QH15');
      expect(result.nodes.length).toBe(2);
    });

    it('throws NotFoundException when nodeId not in document', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Test Document', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document_node (id, document_id, parent_id, node_type, path, ordinal, label, heading, text_content, content_hash, valid_from, status) VALUES ('n1', 'doc-1', NULL, 'chuong', 'chuong1', '1', 'Chương I', 'Quy định chung', NULL, 'hash1', '2025-06-01', 'con_hieu_luc')`);

      await expect(repo.findNodeSubtree('doc-1', 'nonexistent')).rejects.toThrow('not found');
    });

    it('throws NotFoundException when document not found', async () => {
      await expect(repo.findNodeSubtree('nonexistent', 'n1')).rejects.toThrow('not found');
    });
  });
});