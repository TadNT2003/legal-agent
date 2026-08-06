import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  index,
} from 'drizzle-orm/pg-core';
import { document } from './document.schema';
import { documentNode } from './document-node.schema';

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

export const documentReference = pgTable(
  'document_reference',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceDocumentId: uuid('source_document_id').references(() => document.id),
    targetDocumentId: uuid('target_document_id').references(() => document.id),
    // Re-added now that document_node exists (was previously omitted per this
    // file's own comment — "re-add once that table exists"). Schema-only:
    // no logic populates these yet. Citation-to-specific-node resolution
    // (parsing "khoản 2 Điều 5 của ..." out of relation raw text down to an
    // exact document_node row, not just the whole document) is a separate,
    // larger feature than the document_node tree itself — see the law-index
    // plan's document_node follow-up section.
    sourceNodeId: uuid('source_node_id').references(() => documentNode.id),
    targetNodeId: uuid('target_node_id').references(() => documentNode.id),
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
  },
  // Performance indexes for the scraper's hot paths. Must live in this
  // extraConfig callback, not as standalone `index(...).on(documentReference.x)`
  // exports — the columns handed to a standalone `.on()` call are plain
  // PgColumn instances with no `defaultConfig`, which crashes
  // (`"undefined" is not valid JSON` inside drizzle-orm's IndexBuilderOn.on,
  // confirmed live: it JSON.parses `it.defaultConfig`) the moment this module
  // loads. Only the `table` passed into this callback carries the
  // ExtraConfigColumn wrapper that actually has `defaultConfig`.
  //
  // The resolved-edge and unresolved-edge *unique* indexes from 0000 were
  // dropped in 0001 due to the NULL-in-unique-index footgun (see below), but
  // plain (non-unique) indexes on the same columns are safe and dramatically
  // speed up the per-document heal, insertReferenceIfNotExists dedup selects,
  // and upsertRelations lookups.
  (table) => [
    index('document_reference_source_doc_idx').on(table.sourceDocumentId),
    index('document_reference_target_doc_idx').on(table.targetDocumentId),
  ],
);

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
