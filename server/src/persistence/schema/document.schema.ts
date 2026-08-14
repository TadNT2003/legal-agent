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
  // "Ngày hết hiệu lực" — the closing end of the validity interval. Parsed by
  // vbpl.parser.ts all along (ParsedVbplAttributes.expiryDateRaw) and folded
  // into content_version's hash, but until now had no column to land in, so
  // the value was discarded on every scrape.
  //
  // Nullable *by design*, not as a data gap: a document still in force
  // genuinely has no expiry date, so NULL is the open right endpoint that a
  // validity filter reads as "still running" —
  // `effective_date <= :as_of AND (expiry_date IS NULL OR expiry_date > :as_of)`
  // — the same convention document_node.validTo already uses. The one
  // combination that *is* a data gap is NULL alongside a het_hieu_luc /
  // het_hieu_luc_mot_phan / ngung_hieu_luc status; treat that as a flag-worthy
  // inconsistency rather than an open interval.
  expiryDate: date('expiry_date', { mode: 'string' }),
  gazettePublishedDate: date('gazette_published_date', { mode: 'string' }),
  // Nullable: a handful of very-recently-issued documents (confirmed live,
  // e.g. Luật Trí tuệ nhân tạo số 134/2025/QH15) have no "Tình trạng hiệu
  // lực" row on vbpl.vn's own attributes tab at all yet — an upstream data
  // gap, not a scrape failure, so this is stored as null rather than
  // blocking the whole document from being persisted.
  status: validityStatusEnum('status'),
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
  // Direct download URLs for vbpl.vn's "Văn bản gốc" tab — the scanned
  // original file(s) vbpl.vn itself renders via its PDF viewer for every
  // document (not just documents with no "Nội dung" tab; see
  // law-index-flagged-documents.md §3). Not in the DBML. Constructed (not
  // scraped as a literal href — the file-list items are React click
  // handlers with no href in the DOM, same pattern as search results) from
  // the vbpl.vn internal document id plus each file's name, which together
  // deterministically address vbpl.vn's own MinIO-backed storage gateway —
  // see buildOriginalDocumentUrl in vbpl.parser.ts. Empty array, not null,
  // when vbpl.vn reports zero files (not observed live yet, but the "Danh
  // sách văn bản gốc (N file)" heading implies N can be 0).
  originalDocumentUrls: text('original_document_urls')
    .array()
    .notNull()
    .default([]),
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
