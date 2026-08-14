import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

let sqlite: InstanceType<typeof Database> | null = null;
let db: any = null;

export function createTestDb() {
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema: {} });
  return db;
}

export function createTables() {
  if (!sqlite) throw new Error('Call createTestDb() first');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS issuing_body (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      name_en TEXT,
      authority_rank INTEGER NOT NULL,
      scope TEXT NOT NULL DEFAULT 'national',
      parent_body_id TEXT
    );

    CREATE TABLE IF NOT EXISTS document (
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

    CREATE TABLE IF NOT EXISTS document_node (
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

    CREATE TABLE IF NOT EXISTS document_reference (
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
}

export function dropTables() {
  if (!sqlite) return;
  sqlite.exec(`
    DROP TABLE IF EXISTS document_reference;
    DROP TABLE IF EXISTS document_node;
    DROP TABLE IF EXISTS document;
    DROP TABLE IF EXISTS issuing_body;
  `);
}

export function closeTestDb() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}
