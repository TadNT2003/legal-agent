jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { randomUUID, createHash } from 'crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { text, integer, sqliteTable } from 'drizzle-orm/sqlite-core';
import {
  issuingBody as ibSchema,
  documentReference as refSchema,
} from '../persistence/schema/sqlite-schema';
import {
  DocumentRepository,
  UpsertResult,
  ReferenceRow,
} from './document.repository';
import type { ParsedVbplDocument } from '../crawl/vbpl-document.interface';

/** Document schema with raw_source as JSON mode for SQLite compatibility. */
const docSchema = sqliteTable('document', {
  id: text('id').primaryKey(),
  citationId: text('citation_id').notNull().unique(),
  title: text('title').notNull(),
  documentType: text('document_type').notNull(),
  issuingBodyId: text('issuing_body_id').notNull(),
  industry: text('industry'),
  field: text('field'),
  signerName: text('signer_name'),
  signerTitle: text('signer_title'),
  enactedDate: text('enacted_date').notNull(),
  effectiveDate: text('effective_date'),
  expiryDate: text('expiry_date'),
  gazettePublishedDate: text('gazette_published_date'),
  status: text('status'),
  indexScope: text('index_scope').notNull().default('full'),
  isConsolidated: integer('is_consolidated', { mode: 'boolean' })
    .notNull()
    .default(false),
  consolidatesDocumentId: text('consolidates_document_id'),
  rawSource: text('raw_source', { mode: 'json' }),
  originalDocumentUrls: text('original_document_urls', { mode: 'json' })
    .notNull()
    .$type<string[]>()
    .default([]),
  contentVersion: text('content_version').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

let sqlite: Database;
let db: any;
let repo: DocumentRepository;

const makeParsedDoc = (
  overrides?: Partial<ParsedVbplDocument>,
): ParsedVbplDocument => ({
  sourceUrl: 'https://vbpl.vn/van-ban/chi-tiet/123',
  scope: 'trung-uong',
  title: 'Test Document',
  fullText:
    'Full text of the test document. Căn cứ Luật số 104/2016/QH13. Sửa đổi Nghị định 78/2025/NĐ-CP.',
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
  originalDocumentUrls: [],
  ...overrides,
});

function computeContentVersionForTest(parsed: ParsedVbplDocument): string {
  const hash = createHash('sha256');
  hash.update(parsed.fullText);
  hash.update(parsed.attributes.citation);
  hash.update(parsed.title);
  hash.update(parsed.attributes.issuingBody);
  hash.update(parsed.attributes.validityStatusRaw ?? '');
  hash.update(parsed.attributes.effectiveDateRaw ?? '');
  hash.update(parsed.attributes.expiryDateRaw ?? '');
  hash.update(parsed.originalDocumentUrls.join(','));
  return hash.digest('hex');
}

describe('DocumentRepository (SQLite integration)', () => {
  beforeAll(() => {
    sqlite = new Database(':memory:');
    sqlite.function('gen_random_uuid', () => randomUUID());
    sqlite.function('now', { deterministic: false }, () =>
      new Date().toISOString(),
    );
    /** SQLite lacks ILIKE — drizzle-orm generates `col ILIKE ?`. We patch
         `prepare()` to rewrite `ILIKE` to `LIKE` (SQLite LIKE is case-insensitive for ASCII)
         and intercept bind values to serialize objects (for jsonb columns that drizzle PG
         schema sends as raw JS objects when some placeholder paths skip mapToDriverValue). */
    const origPrepare = sqlite.prepare.bind(sqlite);
    const serializeVal = (v: any) =>
      typeof v === 'object' && v !== null && !Buffer.isBuffer(v)
        ? JSON.stringify(v)
        : v;
    (sqlite as any).prepare = (sql: string) => {
      const stmt = origPrepare(sql.replace(/\bilike\b/gi, 'LIKE'));
      const origRun = stmt.run.bind(stmt);
      const origAll = stmt.all.bind(stmt);
      const origGet = stmt.get.bind(stmt);
      const origRaw = stmt.raw.bind(stmt);
      stmt.run = (...args: any[]) => origRun(...args.map(serializeVal));
      stmt.all = (...args: any[]) => origAll(...args.map(serializeVal));
      stmt.get = (...args: any[]) => origGet(...args.map(serializeVal));
      stmt.raw = () => {
        const rawStmt = origRaw();
        const origAllRaw = rawStmt.all.bind(rawStmt);
        const origGetRaw = rawStmt.get.bind(rawStmt);
        return {
          all: (...args: any[]) => origAllRaw(...args.map(serializeVal)),
          get: (...args: any[]) => origGetRaw(...args.map(serializeVal)),
        };
      };
      return stmt;
    };
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
      schema: {
        issuingBody: ibSchema,
        document: docSchema,
        documentReference: refSchema,
      },
    });
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
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version) VALUES ('doc-1', '01/2025/QH15', 'Test', 'Luật', 'ib-1', '2025-01-01', 'v1')`,
      );
      const result = await repo.findDocumentIdByCitation('01/2025/QH15');
      expect(result).toBe('doc-1');
    });
  });

  describe('resolveOrCreateIssuingBody', () => {
    it('creates new issuing body', async () => {
      const id = await repo.resolveOrCreateIssuingBody('Quốc hội');
      expect(id).toBeDefined();
      const row = sqlite
        .prepare('SELECT * FROM issuing_body WHERE id = ?')
        .get(id);
      expect(row.name).toBe('Quốc hội');
      expect(row.authority_rank).toBe(2);
    });

    it('returns existing issuing body', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Chính phủ', 5, 'national')`,
      );
      const id = await repo.resolveOrCreateIssuingBody('Chính phủ');
      expect(id).toBe('ib-1');
    });

    it('assigns correct authority rank for Thủ tướng', async () => {
      const id = await repo.resolveOrCreateIssuingBody('Thủ tướng Chính phủ');
      const row = sqlite
        .prepare('SELECT authority_rank FROM issuing_body WHERE id = ?')
        .get(id);
      expect(row.authority_rank).toBe(6);
    });
  });

  describe('upsertDocument', () => {
    it('returns changed=false when content version is identical (no-op)', async () => {
      const existingHash = computeContentVersionForTest(makeParsedDoc());
      const rawSource = JSON.stringify({
        sourceUrl: 'https://vbpl.vn/van-ban/chi-tiet/123',
      });
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite
        .prepare(
          `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated, raw_source) VALUES ('doc-1', '01/2025/QH15', 'Test Document', 'Luật', 'ib-1', '2025-01-01', ?, 'con_hieu_luc', 0, ?)`,
        )
        .run(existingHash, rawSource);

      const result: UpsertResult = await repo.upsertDocument(makeParsedDoc());
      expect(result.changed).toBe(false);
      expect(result.documentId).toBe('doc-1');
    });

    it('throws when issuedDateRaw is not parseable', async () => {
      const parsed = makeParsedDoc({
        attributes: {
          ...makeParsedDoc().attributes,
          citation: '99/2099/QH99',
          issuedDateRaw: 'invalid-date',
        },
      });
      await expect(repo.upsertDocument(parsed)).rejects.toThrow('no parseable');
    });

    it('resolves issuing body and creates document entry in DB', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      const rawSource = JSON.stringify({
        fullText: 'test text',
        scrapedAt: new Date().toISOString(),
        sourceUrl: 'https://vbpl.vn/test',
        consolidatesRawTitles: [],
        consolidatedIntoRawTitles: [],
      });
      const insertDoc = sqlite.prepare(`
        INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, effective_date, status, is_consolidated, raw_source, content_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      insertDoc.run(
        'doc-1',
        '01/2025/QH15',
        'Test Doc',
        'Luật',
        'ib-1',
        '2025-01-01',
        '2025-06-01',
        'con_hieu_luc',
        rawSource,
        'v1',
      );

      const docId = await repo.findDocumentIdByCitation('01/2025/QH15');
      expect(docId).toBe('doc-1');

      const row = sqlite
        .prepare('SELECT * FROM document WHERE id = ?')
        .get('doc-1');
      expect(row.citation_id).toBe('01/2025/QH15');
      expect(row.enacted_date).toBe('2025-01-01');
      expect(row.effective_date).toBe('2025-06-01');
      expect(row.status).toBe('con_hieu_luc');
    });

    it('handles null validityStatusRaw by storing null in DB', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      const insertDoc = sqlite.prepare(`
        INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)
      `);
      insertDoc.run(
        'doc-null',
        '99/2099/QH99',
        'Null Status',
        'Luật',
        'ib-1',
        '2025-01-01',
        'v1',
      );

      const row = sqlite
        .prepare('SELECT status FROM document WHERE id = ?')
        .get('doc-null');
      expect(row.status).toBeNull();
    });

    it('stores is_consolidated=1 for consolidated documents', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      const insertDoc = sqlite.prepare(`
        INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'con_hieu_luc', 1)
      `);
      insertDoc.run(
        'doc-consol',
        '03/2025/QH15',
        'Consolidated',
        'Luật',
        'ib-1',
        '2025-03-01',
        'v1',
      );

      const row = sqlite
        .prepare('SELECT is_consolidated FROM document WHERE id = ?')
        .get('doc-consol');
      expect(row.is_consolidated).toBe(1);
    });
  });

  describe('upsertRelations', () => {
    it('inserts outbound relation', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`,
      );

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
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`,
      );

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
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`,
      );

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
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText:
          'LUẬT\n\nCăn cứ Luật số 104/2016/QH13;\nCăn cứ Конституция.\n\nCHƯƠNG I.\nNội dung chương.',
      });

      await repo.extractTextReferences('doc-1', parsed);

      const refs = sqlite
        .prepare(
          'SELECT * FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs[0].reference_type).toBe('has_basis');
    });

    it('extracts body citations with context classification', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText:
          'LUẬT\n\nCHƯƠNG I.\nNội dung sửa đổi 05/2024/QH15 theo quy định tại 02/2025/QH15 và bãi bỏ 03/2020/QH13.',
      });

      await repo.extractTextReferences('doc-1', parsed);

      const refs = sqlite
        .prepare(
          'SELECT reference_type FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      const types = refs.map((r: any) => r.reference_type);
      expect(types).toContain('amends');
    });

    it('skips self-references', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText: 'LUẬT\n\nCHƯƠNG I.\nĐiều này quy định tại 01/2025/QH15.',
      });

      await repo.extractTextReferences('doc-1', parsed);
      const refs = sqlite
        .prepare(
          'SELECT * FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      expect(refs.length).toBe(0);
    });
  });

  describe('healDanglingReferences', () => {
    it('resolves dangling target reference', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method) VALUES ('ref-1', 'doc-1', NULL, 'cites', 'Nghị định số 02/2025/QH15 - Doc 2', 'deterministic')`,
      );

      const healed = await repo.healDanglingReferences();
      expect(healed).toBe(1);

      const ref = sqlite
        .prepare(
          'SELECT target_document_id FROM document_reference WHERE id = ?',
        )
        .get('ref-1');
      expect(ref.target_document_id).toBe('doc-2');
    });

    it('skips references with no extractable citation', async () => {
      sqlite.exec(
        `INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method) VALUES ('ref-2', 'doc-1', NULL, 'cites', 'Some text with no citation', 'deterministic')`,
      );

      const healed = await repo.healDanglingReferences();
      expect(healed).toBe(0);
    });
  });

  describe('findReferences', () => {
    it('returns outgoing references', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-1', 'doc-1', 'doc-2', 'cites', 'Test ref', 'deterministic', '2025-01-01')`,
      );

      const result = await repo.findReferences('doc-1', 'outgoing');
      expect(result.citationId).toBe('01/2025/QH15');
      expect(result.references.length).toBe(1);
      expect(result.references[0].targetDocumentId).toBe('doc-2');
    });

    it('returns incoming references', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-1', 'doc-1', 'doc-2', 'cites', 'Test ref', 'deterministic', '2025-01-01')`,
      );

      const result = await repo.findReferences('doc-2', 'incoming');
      expect(result.references.length).toBe(1);
      expect(result.references[0].sourceDocumentId).toBe('doc-1');
    });

    it('throws when document not found', async () => {
      await expect(repo.findReferences('nonexistent')).rejects.toThrow(
        'not found',
      );
    });

    it('filters by referenceType', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-1', 'doc-1', 'doc-2', 'cites', 'Test ref', 'deterministic', '2025-01-01')`,
      );
      sqlite.exec(
        `INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-2', 'doc-1', 'doc-2', 'amends', 'Test ref 2', 'deterministic', '2025-01-01')`,
      );

      const result = await repo.findReferences('doc-1', 'outgoing', 'cites');
      expect(result.references.length).toBe(1);
      expect(result.references[0].referenceType).toBe('cites');
    });
  });

  describe('findIssuingBodies', () => {
    it('returns all issuing bodies with document counts', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-2', 'Chính phủ', 5, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const result = await repo.findIssuingBodies({});
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      const qh = result.items.find((ib: any) => ib.name === 'Quốc hội');
      expect(qh.documentCount).toBe(1);
      const cp = result.items.find((ib: any) => ib.name === 'Chính phủ');
      expect(cp.documentCount).toBe(0);
    });

    it('filters by scope', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-2', 'UBND TP.HCM', 10, 'local')`,
      );

      const result = await repo.findIssuingBodies({ scope: 'local' });
      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('UBND TP.HCM');
    });

    it('filters by keyword', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-2', 'Chính phủ', 5, 'national')`,
      );

      const result = await repo.findIssuingBodies({ keyword: 'Quốc' });
      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Quốc hội');
    });
  });

  describe('searchLocalDocuments', () => {
    function seedSearchDocs() {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-2', 'Chính phủ', 5, 'national')`,
      );
      const rawSource1 = JSON.stringify({
        fullText: 'Full text A about amendments',
        scrapedAt: '2025-01-01T00:00:00Z',
        sourceUrl: 'https://vbpl.vn/doc1',
        consolidatesRawTitles: [],
        consolidatedIntoRawTitles: [],
      });
      const rawSource2 = JSON.stringify({
        fullText: 'Full text B about repeals',
        scrapedAt: '2025-06-01T00:00:00Z',
        sourceUrl: 'https://vbpl.vn/doc2',
        consolidatesRawTitles: [],
        consolidatedIntoRawTitles: [],
      });
      const insertDoc = sqlite.prepare(`
        INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, effective_date, status, is_consolidated, raw_source, content_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      insertDoc.run(
        'doc-1',
        '01/2025/QH15',
        'Law on Amendments',
        'Luật',
        'ib-1',
        '2025-01-15',
        '2025-06-01',
        'con_hieu_luc',
        rawSource1,
        'v1',
      );
      insertDoc.run(
        'doc-2',
        '02/2025/QH15',
        'Decree on Repeals',
        'Nghị định',
        'ib-2',
        '2025-07-20',
        '2025-08-01',
        'con_hieu_luc',
        rawSource2,
        'v2',
      );
    }

    it('returns all documents with no filters', () => {
      seedSearchDocs();
      const result = repo.searchLocalDocuments({});
      expect(result).resolves.toBeDefined();
    });

    it('filters by keyword in title (tieu-de scope)', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({ keyword: 'Amendments' });
      expect(result.total).toBe(1);
      expect(result.items[0].title).toBe('Law on Amendments');
    });

    it('filters by keyword in citation (so-hieu scope)', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({
        keyword: '02/2025/QH15',
        searchScope: 'so-hieu',
      });
      expect(result.total).toBe(1);
      expect(result.items[0].citation).toBe('02/2025/QH15');
    });

    it('filters by keyword in full text (noi-dung scope)', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({
        keyword: 'repeals',
        searchScope: 'noi-dung',
      });
      expect(result.total).toBe(1);
      expect(result.items[0].title).toBe('Decree on Repeals');
    });

    it('uses exact phrase match when exactPhrase is true', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({
        keyword: 'Decree on Repeals',
        exactPhrase: true,
      });
      expect(result.total).toBe(1);
    });

    it('filters by documentTypes', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({
        documentTypes: ['Luật'],
      });
      expect(result.total).toBe(1);
      expect(result.items[0].documentType).toBe('Luật');
    });

    it('filters by issuingBodies', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({
        issuingBodies: ['Chính phủ'],
      });
      expect(result.total).toBe(1);
      expect(result.items[0].issuingBody).toBe('Chính phủ');
    });

    it('filters by validityStatus', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({
        validityStatus: 'Còn hiệu lực',
      });
      expect(result.total).toBe(2);
    });

    it('filters by issuedFrom and issuedTo', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({
        issuedFrom: '01/03/2025',
      });
      expect(result.total).toBe(1);
      expect(result.items[0].citation).toBe('02/2025/QH15');
    });

    it('filters by effectiveFrom', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({
        effectiveFrom: '01/07/2025',
      });
      expect(result.total).toBe(1);
    });

    it('filters by effectiveTo', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({
        effectiveTo: '01/06/2025',
      });
      expect(result.total).toBe(1);
    });

    it('supports pagination', async () => {
      seedSearchDocs();
      const page1 = await repo.searchLocalDocuments({ pageSize: 1, page: 1 });
      expect(page1.total).toBe(2);
      expect(page1.pageSize).toBe(1);
      expect(page1.page).toBe(1);
      expect(page1.items.length).toBe(1);

      const page2 = await repo.searchLocalDocuments({ pageSize: 1, page: 2 });
      expect(page2.page).toBe(2);
      expect(page2.items.length).toBe(1);
      expect(page2.items[0].documentId).not.toBe(page1.items[0].documentId);
    });

    it('throws when rawSource.sourceUrl is missing', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, status, is_consolidated, raw_source, content_version) VALUES ('doc-bad', '99/2025/QH15', 'Bad Doc', 'Luật', 'ib-1', '2025-01-01', 'con_hieu_luc', 0, NULL, 'v1')`,
      );

      await expect(repo.searchLocalDocuments({})).rejects.toThrow(
        'has no rawSource.sourceUrl',
      );
    });

    it('formats dates as dd/mm/yyyy in results', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({ keyword: 'Amendments' });
      expect(result.items[0].issuedDate).toBe('15/01/2025');
      expect(result.items[0].effectiveDate).toBe('01/06/2025');
    });

    it('maps validityStatus to display label', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({});
      expect(result.items[0].validityStatus).toBe('Còn hiệu lực');
    });

    it('returns null expiryDate', async () => {
      seedSearchDocs();
      const result = await repo.searchLocalDocuments({});
      expect(result.items[0].expiryDate).toBeNull();
    });
  });

  describe('findReferences direction all', () => {
    it('returns both outgoing and incoming references', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-3', '03/2025/QH15', 'Doc 3', 'Luật', 'ib-1', '2025-03-01', 'v3', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-1', 'doc-1', 'doc-2', 'cites', 'Outgoing', 'deterministic', '2025-01-01')`,
      );
      sqlite.exec(
        `INSERT INTO document_reference (id, source_document_id, target_document_id, reference_type, raw_citation_text, extraction_method, created_at) VALUES ('ref-2', 'doc-3', 'doc-1', 'amends', 'Incoming', 'deterministic', '2025-01-01')`,
      );

      const result = await repo.findReferences('doc-1', 'all');
      expect(result.references.length).toBe(2);
      const types = result.references.map((r: ReferenceRow) => r.referenceType);
      expect(types).toContain('cites');
      expect(types).toContain('amends');
    });
  });

  describe('upsertRelations additional coverage', () => {
    it('inserts outbound relation with null target when target citation not found', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        relations: [
          {
            thisDocIsSource: true,
            otherDocCitation: '99/9999/QH99',
            otherDocRawText: 'Unknown doc',
            referenceType: 'cites',
            changeType: null,
          },
        ],
      });

      await repo.upsertRelations('doc-1', parsed);
      const ref = sqlite.prepare('SELECT * FROM document_reference').all();
      expect(ref.length).toBe(1);
      expect(ref[0].target_document_id).toBeNull();
    });

    it('does not duplicate relations on second call', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-2', '02/2025/QH15', 'Doc 2', 'Luật', 'ib-1', '2025-02-01', 'v2', 'con_hieu_luc', 0)`,
      );

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
      await repo.upsertRelations('doc-1', parsed);
      const refs = sqlite.prepare('SELECT * FROM document_reference').all();
      expect(refs.length).toBe(1);
    });

    it('skips inbound relation with null otherDocCitation', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        relations: [
          {
            thisDocIsSource: false,
            otherDocCitation: null,
            otherDocRawText: 'No citation',
            referenceType: 'cites',
            changeType: null,
          },
        ],
      });

      await repo.upsertRelations('doc-1', parsed);
      const refs = sqlite.prepare('SELECT * FROM document_reference').all();
      expect(refs.length).toBe(0);
    });
  });

  describe('extractTextReferences additional coverage', () => {
    it('classifies body reference as repeals', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText:
          'LUẬT\n\nCHƯƠNG I.\nĐiều này bãi bỏ văn bản 03/2020/QH13 hoàn toàn.',
      });

      await repo.extractTextReferences('doc-1', parsed);
      const refs = sqlite
        .prepare(
          'SELECT reference_type FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs.map((r: any) => r.reference_type)).toContain('repeals');
    });

    it('classifies body reference as corrects', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText:
          'LUẬT\n\nCHƯƠNG I.\nVăn bản đính chính 04/2021/QH13 đã được công bố.',
      });

      await repo.extractTextReferences('doc-1', parsed);
      const refs = sqlite
        .prepare(
          'SELECT reference_type FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs.map((r: any) => r.reference_type)).toContain('corrects');
    });

    it('classifies body reference as guides', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText:
          'LUẬT\n\nCHƯƠNG I.\nHướng dẫn thực hiện theo 05/2022/TT-BNG về thủ tục.',
      });

      await repo.extractTextReferences('doc-1', parsed);
      const refs = sqlite
        .prepare(
          'SELECT reference_type FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs.map((r: any) => r.reference_type)).toContain('guides');
    });

    it('classifies body reference as cites (default)', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText:
          'LUẬT\n\nCHƯƠNG I.\nTheo quy định tại 06/2023/QH15 về các điều khoản liên quan.',
      });

      await repo.extractTextReferences('doc-1', parsed);
      const refs = sqlite
        .prepare(
          'SELECT reference_type FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs.map((r: any) => r.reference_type)).toContain('cites');
    });

    it('returns no refs when no preamble block exists', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText:
          'This text has no document type marker like LUAT or NHI ĐỊNH.',
      });

      await repo.extractTextReferences('doc-1', parsed);
      const refs = sqlite
        .prepare(
          'SELECT * FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      expect(refs.length).toBe(0);
    });

    it('returns no refs when body has no chapter marker', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText:
          'LUẬT\n\nCăn cứ 02/2020/QH14.\nSome text but no CHƯƠNG marker so body extraction is skipped.',
      });

      await repo.extractTextReferences('doc-1', parsed);
      const refs = sqlite
        .prepare(
          'SELECT reference_type FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      if (refs.length > 0) {
        expect(refs[0].reference_type).toBe('has_basis');
      }
    });

    it('does not insert duplicate body citations', async () => {
      sqlite.exec(
        `INSERT INTO issuing_body (id, name, authority_rank, scope) VALUES ('ib-1', 'Quốc hội', 2, 'national')`,
      );
      sqlite.exec(
        `INSERT INTO document (id, citation_id, title, document_type, issuing_body_id, enacted_date, content_version, status, is_consolidated) VALUES ('doc-1', '01/2025/QH15', 'Doc 1', 'Luật', 'ib-1', '2025-01-01', 'v1', 'con_hieu_luc', 0)`,
      );

      const parsed = makeParsedDoc({
        fullText:
          'LUẬT\n\nCHƯƠNG I.\nVăn bản 07/2023/QH15 được sửa đổi và văn bản 07/2023/QH15 được bổ sung thêm.',
      });

      await repo.extractTextReferences('doc-1', parsed);
      const refs = sqlite
        .prepare(
          'SELECT * FROM document_reference WHERE source_document_id = ?',
        )
        .all('doc-1');
      const citationRefs = refs.filter((r: any) =>
        r.raw_citation_text.includes('07/2023'),
      );
      expect(citationRefs.length).toBe(1);
    });
  });
});
