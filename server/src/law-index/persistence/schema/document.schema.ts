import {
  boolean,
  date,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { issuingBody } from './issuing-body.schema';

// docs/schema/legal-agent.dbml's spelling, treated as canonical over
// database-design.md §1a's (see the law-index plan's Context section).
export const validityStatusEnum = pgEnum('validity_status', [
  'con_hieu_luc',
  'het_hieu_luc',
  'het_hieu_luc_mot_phan',
  'chua_co_hieu_luc',
  'ngung_hieu_luc',
]);

// 'metadata_only' is designed (database-design.md §1a) but this pass has no
// per-document-type gating logic yet — every scraped document defaults to
// 'full' until that's built.
export const indexScopeEnum = pgEnum('index_scope', ['full', 'metadata_only']);

export const document = pgTable('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  citationId: text('citation_id').notNull().unique(),
  title: text('title').notNull(),
  // DBML models this as a 14-value enum mirroring the Điều 4 tiers. This
  // pass stores vbpl.vn's raw "Loại văn bản" text (e.g. "Thông tư") instead —
  // the trung-ương/địa-phương scope filter already comes from the page's own
  // breadcrumb (see VbplClientService), so tier classification isn't
  // load-bearing for scope filtering here the way it is in the
  // vanban.chinhphu.vn download module. Revisit once document_node lands and
  // a real classifier is needed for chunking/tier-specific rules.
  documentType: text('document_type').notNull(),
  issuingBodyId: uuid('issuing_body_id')
    .notNull()
    .references(() => issuingBody.id),
  // Not in the DBML — vbpl.vn exposes these on every document's attributes
  // tab (Ngành / Lĩnh vực / Người ký / Chức danh) with no existing column to
  // hold them; see the law-index plan's Context section for the full gap
  // analysis this schema fixes.
  industry: text('industry'),
  field: text('field'),
  signerName: text('signer_name'),
  signerTitle: text('signer_title'),
  enactedDate: date('enacted_date', { mode: 'string' }).notNull(),
  effectiveDate: date('effective_date', { mode: 'string' }),
  gazettePublishedDate: date('gazette_published_date', { mode: 'string' }),
  status: validityStatusEnum('status').notNull(),
  indexScope: indexScopeEnum('index_scope').notNull().default('full'),
  isConsolidated: boolean('is_consolidated').notNull().default(false),
  // Single FK, same as DBML — lossy for a hợp nhất document that merges more
  // than one source (rare but real); the full raw title list from vbpl.vn's
  // "Văn bản hợp nhất" section is kept in rawSource for audit even when only
  // the first resolved match ends up here. A proper many-to-many
  // representation is a follow-up, not this pass's scope.
  consolidatesDocumentId: uuid('consolidates_document_id').references(
    (): AnyPgColumn => document.id,
  ),
  // Stopgap: document_node (and its text_content column) is deferred per the
  // law-index plan, so the full scraped text has nowhere else to live yet.
  // Shape: { fullText, scrapedAt, sourceUrl, consolidatesRawTitles, consolidatedIntoRawTitles }.
  rawSource: jsonb('raw_source'),
  // SHA-256 of fullText + key attribute fields — cheap re-scrape idempotency
  // now (skip the write if unchanged), the CDC trigger later.
  contentVersion: text('content_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
