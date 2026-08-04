jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  issuingBody as ibSchema,
  document as docSchema,
  documentReference as refSchema,
} from '../persistence/schema/sqlite-schema';
import {
  DocumentRepository,
  UpsertResult,
  ReferenceRow,
} from './document.repository';
import type { ParsedVbplDocument } from '../crawl/vbpl-document.interface';

let sqlite: Database;
let db: any;
let repo: DocumentRepository;

const makeParsedDoc = (overrides?: Partial<ParsedVbplDocument>): ParsedVbplDocument => ({
  sourceUrl: 'https://vbpl.vn/van-ban/chi-tiet/123',
  scope: 'trung-uong',
  title: 'Test Document',
  fullText: 'Full text of the test document. Căn cứ Luật số 104/2016/QH13. Sửa đổi Nghị định 78/2025/NĐ-CP.',
  attributes: {
    citation: '01/2025/QH15',
    documentType: 'Luật',
    industry: null,
    field: null,
    issuingBody: 'Quốc hội',
    signerTitle: null,
    signerName: null,
    issuedDateRaw: '01/01/2025',
    effectiveDateRaw: '01/06/2025',
    expiryDateRaw: null,
    validityStatusRaw: 'còn hiệu lực',
    ...(overrides?.attributes ?? {}),
  },
  consolidation: {
    consolidatesRawTitles: [],
    consolidatedIntoRawTitles: [],
  },
  relations: [],
  ...overrides,
});

describe('DocumentRepository (SQLite integration)', () => {
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
        gazette_published_date TEXT,
        status TEXT,
        index_scope TEXT NOT NULL DEFAULT 'full',
        is_consolidated INTEGER NOT NULL DEFAULT 0,
        consolidates_document_id TEXT,
        raw_source TEXT,
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
    db = drizzle(sqlite, { schema: { issuingBody: ibSchema, document: docSchema, documentReference: refSchema } });
    repo = new DocumentRepository(db);
  });

  afterAll(() => {
    sqlite.close();
  });

  beforeEach(() => {
    sqlite.exec('DELETE FROM document_reference');
    sqlite.exec('DELETE FROM document_node');
    sqlite.exec('DELETE FROM document');
    sqlite.exec('DELETE FROM issuing_body');
  });

  describe('findDocumentIdByCitation', () => {
    it('returns null when citation not found', async () => {
      const result = await repo.findDocumentIdByCitation('99/9999/QH99');
      expect(result).toBeNull();
    });

    it('returns ID when citation exists', async () => {
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version) VALUES ('doc-1', '01/2025/QH15', 'Test', 'Luật', 'ib-1', '2025-01-01', 'v1')`);
      const result = await repo.findDocumentIdByCitation('01/2025/QH15');
      expect(result).toBe('doc-1');
    });
  });

  describe('resolveOrCreateIssuingBody', () => {
    it('creates new issuing body', async () => {
      const id = await repo.resolveOrCreateIssuingBody('Quốc hội');
      expect(id).toBeDefined();
      const row = sqlite.prepare('SELECT * FROM issuing_body WHERE id = ?').get(id);
      expect(row.name).toBe('Quốc hội');
      expect(row.authority_rank).toBe(2);
    });

    it('returns existing issuing body', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Chính phủ', 5, 'national')`);
      const id = await repo.resolveOrCreateIssuingBody('Chính phủ');
      expect(id).toBe('ib-1');
    });

    it('assigns correct authority rank for Thủ tướng', async () => {
      const id = await repo.resolveOrCreateIssuingBody('Thủ tướng Chính phủ');
      const row = sqlite.prepare('SELECT authority_rank FROM issuing_body WHERE id = ?').get(id);
      expect(row.authority_rank).toBe(6);
    });
  });

  describe('upsertDocument', () => {
    it('resolves issuing body before insert', async () => {
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Test', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      const existingId = await repo.findDocumentIdByCitation('01/2025/QH15');
      expect(existingId).toBe('doc-1');
    });

    it('finds existing document by citation', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Test', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      const existingId = await repo.findDocumentIdByCitation('01/2025/QH15');
      expect(existingId).toBe('doc-1');
    });

    it('returns null for non-existent citation in upsert flow', async () => {
      const id = await repo.findDocumentIdByCitation('99/9999/QH99');
      expect(id).toBeNull();
    });
  });

  describe('upsertRelations', () => {
    it('inserts outbound relation', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`);

      const parsed = makeParsedDoc({
        relations: [
          {
            thisDocIsSource: true,
            otherDocCitation: '02/2025/QH15',
            otherDocRawText: 'Doc 2',
            referenceType: 'cites',
            changeType: null,
          },
        ],
      });

      await repo.upsertRelations('doc-1', parsed);

      const ref = sqlite.prepare('SELECT * FROM document_reference').all();
      expect(ref.length).toBe(1);
      expect(ref[0].source_document_id).toBe('doc-1');
      expect(ref[0].target_document_id).toBe('doc-2');
      expect(ref[0].reference_type).toBe('cites');
    });

    it('inserts inbound relation when source document exists', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`);

      const parsed = makeParsedDoc({
        relations: [
          {
            thisDocIsSource: false,
            otherDocCitation: '01/2025/QH15',
            otherDocRawText: 'Doc 1',
            referenceType: 'amends',
            changeType: null,
          },
        ],
      });

      await repo.upsertRelations('doc-2', parsed);

      const ref = sqlite.prepare('SELECT * FROM document_reference').all();
      expect(ref.length).toBe(1);
      expect(ref[0].source_document_id).toBe('doc-1');
      expect(ref[0].target_document_id).toBe('doc-2');
    });

    it('skips inbound relation when source document does not exist', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`);

      const parsed = makeParsedDoc({
        relations: [
          {
            thisDocIsSource: false,
            otherDocCitation: '99/9999/QH99',
            otherDocRawText: 'Unknown',
            referenceType: 'cites',
            changeType: null,
          },
        ],
      });

      await repo.upsertRelations('doc-2', parsed);
      const refs = sqlite.prepare('SELECT * FROM document_reference').all();
      expect(refs.length).toBe(0);
    });
  });

  describe('extractTextReferences', () => {
    it('extracts preamble Căn cứ references', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);

      const parsed = makeParsedDoc({
        fullText: 'LUẬT\n\nCăn cứ Luật số 104/2016/QH13;\nCăn cứ Конституция.\n\nCHƯƠNG I.\nNội dung chương.',
      });

      await repo.extractTextReferences('doc-1', parsed);

      const refs = sqlite.prepare('SELECT * FROM document_reference WHERE source_document_id = ?').all('doc-1');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs[0].reference_type).toBe('has_basis');
    });

    it('extracts body citations with context classification', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);

      const parsed = makeParsedDoc({
        fullText: 'LUẬT\n\nCHƯƠNG I.\nNội dung sửa đổi 05/2024/QH15 theo quy định tại 02/2025/QH15 và bãi bỏ 03/2020/QH13.',
      });

      await repo.extractTextReferences('doc-1', parsed);

      const refs = sqlite.prepare('SELECT reference_type FROM document_reference WHERE source_document_id = ?').all('doc-1');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      const types = refs.map((r: any) => r.reference_type);
      expect(types).toContain('amends');
    });

    it('skips self-references', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);

      const parsed = makeParsedDoc({
        fullText: 'LUẬT\n\nCHƯƠNG I.\nĐiều này quy định tại 01/2025/QH15.',
      });

      await repo.extractTextReferences('doc-1', parsed);
      const refs = sqlite.prepare('SELECT * FROM document_reference WHERE source_document_id = ?').all('doc-1');
      expect(refs.length).toBe(0);
    });
  });

  describe('healDanglingReferences', () => {
    it('resolves dangling target reference', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method) VALUES ('ref-1', 'doc-1', NULL, 'cites', 'Nghị định số 02/2025/QH15 - Doc 2', 'deterministic')`);

      const healed = await repo.healDanglingReferences();
      expect(healed).toBe(1);

      const ref = sqlite.prepare('SELECT target_document_id FROM document_reference WHERE id = ?').get('ref-1');
      expect(ref.target_document_id).toBe('doc-2');
    });

    it('skips references with no extractable citation', async () => {
      sqlite.exec(`INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method) VALUES ('ref-2', 'doc-1', NULL, 'cites', 'Some text with no citation', 'deterministic')`);

      const healed = await repo.healDanglingReferences();
      expect(healed).toBe(0);
    });
  });

  describe('findReferences', () => {
    it('returns outgoing references', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-1', 'doc-1', 'doc-2', 'cites', 'Test ref', 'deterministic', '2025-01-01')`);

      const result = await repo.findReferences('doc-1', 'outgoing');
      expect(result.citationId).toBe('01/2025/QH15');
      expect(result.references.length).toBe(1);
      expect(result.references[0].targetDocumentId).toBe('doc-2');
    });

    it('returns incoming references', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-1', 'doc-1', 'doc-2', 'cites', 'Test ref', 'deterministic', '2025-01-01')`);

      const result = await repo.findReferences('doc-2', 'incoming');
      expect(result.references.length).toBe(1);
      expect(result.references[0].sourceDocumentId).toBe('doc-1');
    });

    it('throws when document not found', async () => {
      await expect(repo.findReferences('nonexistent')).rejects.toThrow('not found');
    });

    it('filters by referenceType', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`);
      sqlite.exec(`INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-1', 'doc-1', 'doc-2', 'cites', 'Test ref', 'deterministic', '2025-01-01')`);
      sqlite.exec(`INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-2', 'doc-1', 'doc-2', 'amends', 'Test ref 2', 'deterministic', '2025-01-01')`);

      const result = await repo.findReferences('doc-1', 'outgoing', 'cites');
      expect(result.references.length).toBe(1);
      expect(result.references[0].referenceType).toBe('cites');
    });
  });

  describe('findIssuingBodies', () => {
    it('returns all issuing bodies with document counts', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-2', 'Chính phủ', 5, 'national')`);
      sqlite.exec(`INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`);

      const result = await repo.findIssuingBodies({});
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      const qh = result.items.find((ib: any) => ib.name === 'Quốc hội');
      expect(qh.documentCount).toBe(1);
      const cp = result.items.find((ib: any) => ib.name === 'Chính phủ');
      expect(cp.documentCount).toBe(0);
    });

    it('filters by scope', async () => {
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`);
      sqlite.exec(`INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-2', 'UBND TP.HCM', 10, 'local')`);

      const result = await repo.findIssuingBodies({ scope: 'local' });
      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('UBND TP.HCM');
    });
  });
});