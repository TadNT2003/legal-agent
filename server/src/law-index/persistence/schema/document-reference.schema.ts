import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  real,
} from 'drizzle-orm/pg-core';
import { document } from './document.schema';

// Extended beyond docs/schema/legal-agent.dbml's 8 values — see the
// law-index plan's Context section for the full vbpl.vn-vs-DBML gap
// analysis this resolves. Notably: `consolidated_by` dropped (redundant with
// document.isConsolidated/consolidatesDocumentId); `guides`/`has_basis`/
// `explains`/`promulgates` added (vbpl.vn tracks each as its own distinct
// relation category vs. all colliding into `implements`/nothing).
export const referenceTypeEnum = pgEnum('reference_type', [
  'cites',
  'amends',
  'repeals',
  'corrects',
  'implements',
  'guides',
  'has_basis',
  'explains',
  'promulgates',
  // Not sourced from vbpl.vn's Lược đồ tab — kept for the future LLM-based
  // definition-extraction use case database-design.md designed it for.
  'defines_term',
]);

// Only 3 values (vs. DBML's 4: replace/add/repeal/suspend) — `repeal` is
// redundant with the standalone `repeals` reference_type above; `add` isn't
// distinguishable from a generic `amends` at document-level granularity (that
// distinction only becomes knowable once document_node lands). `suspend` is
// split into suspend_execution ("đình chỉ thi hành", Điều 3.1) and
// suspend_effect ("tạm ngưng hiệu lực", Điều 56) — legally distinct concepts
// vbpl.vn itself tracks as separate relation categories.
export const changeTypeEnum = pgEnum('change_type', [
  'replace',
  'suspend_execution',
  'suspend_effect',
]);

export const extractionMethodEnum = pgEnum('extraction_method', [
  'deterministic',
  'llm',
]);

export const documentReference = pgTable('document_reference', {
  id: uuid('id').primaryKey().defaultRandom(),
  // source_node_id / target_node_id from the DBML are omitted — they'd
  // reference document_node, which is deferred (see plan). Re-add once
  // that table exists.
  sourceDocumentId: uuid('source_document_id').references(() => document.id),
  targetDocumentId: uuid('target_document_id').references(() => document.id),
  referenceType: referenceTypeEnum('reference_type').notNull(),
  changeType: changeTypeEnum('change_type'),
  rawCitationText: text('raw_citation_text').notNull(),
  extractionMethod: extractionMethodEnum('extraction_method')
    .notNull()
    .default('deterministic'),
  confidence: real('confidence'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Deliberately no DB-level unique index for dedup here. A pair of partial
// unique indexes (source/target/type/changeType WHERE target IS NULL, and
// its mirror) was tried first and hit a real Postgres footgun, confirmed
// against a live re-scrape: standard unique indexes never treat two NULLs as
// equal, so rows with a null changeType — the common case, since only
// `amends` ever sets one — never actually conflicted, and duplicates piled
// up on every re-sync. The proper DB-level fix needs `NULLS NOT DISTINCT`,
// which drizzle-orm's `uniqueIndex` builder can't express for a *partial*
// index in the installed version. Deduping at the application layer instead —
// document.repository.ts's insertReferenceIfNotExists uses the same
// select-then-insert pattern its resolveOrCreateIssuingBody already does —
// sidesteps the whole class of NULL-in-unique-index subtleties.
