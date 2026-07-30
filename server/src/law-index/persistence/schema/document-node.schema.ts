import {
  customType,
  date,
  pgEnum,
  pgTable,
  text,
  uuid,
  AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { document, validityStatusEnum } from './document.schema';

// docs/schema/legal-agent.dbml's 7 values, plus `phu_luc` (see below).
export const nodeTypeEnum = pgEnum('node_type', [
  'phan',
  'chuong',
  'muc',
  'tieu_muc',
  'dieu',
  'khoan',
  'diem',
  // Not in the DBML — database-design.md §1a designs a phu_luc node_type
  // with a content_class gate, but the shipped DBML omitted it, and
  // docs/law-index-plan.md explicitly flagged that as a deferred gap only
  // because document_node itself was deferred at the time. That's no
  // longer true, so it's added here rather than re-deferred again.
  'phu_luc',
]);

// Only meaningful when node_type = 'phu_luc' — gates whether a phụ lục's
// content flows into OpenSearch/ChromaDB/Neo4j (normative: danh mục/bảng/
// repeal-replacement lists) or stops at Postgres for audit only (template:
// blank biểu mẫu forms). See database-design.md §1a.
export const contentClassEnum = pgEnum('content_class', [
  'normative',
  'template',
]);

// No built-in ltree column type in drizzle-orm 0.45.2 (confirmed — no
// ltree.d.ts under drizzle-orm/pg-core, unlike cidr/inet/point/line which
// do have one). customType is the documented escape hatch for exotic
// Postgres types; drizzle-kit generate just emits whatever dataType()
// returns as the column's SQL type.
const ltree = customType<{ data: string }>({
  dataType() {
    return 'ltree';
  },
});

export const documentNode = pgTable('document_node', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => document.id),
  parentId: uuid('parent_id').references((): AnyPgColumn => documentNode.id),
  nodeType: nodeTypeEnum('node_type').notNull(),
  contentClass: contentClassEnum('content_class'),
  // Materialized path mirroring parent_id, e.g. 'chuong2.muc1.dieu5.khoan2'
  // — kept for fast ancestor/descendant queries once a downstream projector
  // needs them; parent_id is the actual source of truth for the tree. The
  // GiST index enabling those queries is added by hand in the migration
  // (drizzle-orm has no way to express the gist_ltree_ops opclass) — see
  // the law-index plan's document_node follow-up section.
  path: ltree('path').notNull(),
  // Sort key, e.g. "5", "5a", "2" — always ASCII/arabic, even for
  // Phần/Chương whose `label` displays a roman numeral (Điều 64.3, Nghị
  // định 78/2025/NĐ-CP: roman numerals are a display convention only;
  // sorting/comparing roman-numeral strings lexically is wrong, e.g. "IX"
  // < "V"). An inserted amendment appends the next letter instead of
  // renumbering siblings (Điều 69.4, Nghị định 78/2025/NĐ-CP).
  ordinal: text('ordinal').notNull(),
  // Display text as literally parsed, e.g. "Điều 5", "Chương II", "Phụ lục I".
  label: text('label').notNull(),
  // Required for phan/chuong/muc/tieu_muc/dieu per Điều 63.3, Nghị định
  // 78/2025/NĐ-CP; null for khoan/diem, which never carry their own title.
  heading: text('heading'),
  // Null for pure container nodes (a Chương that only holds a heading);
  // real prose for leaf/atomic nodes.
  textContent: text('text_content'),
  // Drives downstream re-chunk/re-embed/re-index diffing once a projector
  // exists to consume it — see computeContentVersion in document.repository.ts
  // for the sibling document-level hash this mirrors.
  contentHash: text('content_hash').notNull(),
  // Nullable, not not-null as the DBML has it — mirrors document.status's
  // own precedent (document.schema.ts): no per-node amendment/validity
  // diffing exists yet (needs the CDC pipeline), so every node's status is
  // simply inherited from its parent document at build time, and a
  // document with unknown status (see document.schema.ts's comment on real
  // vbpl.vn upstream gaps) can't populate a not-null child column either.
  status: validityStatusEnum('status'),
  // Inherited from the parent document (effective_date, falling back to
  // enacted_date) at build time — real per-node valid_from tracking is
  // future work, same CDC dependency as status above.
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  // Always null this pass — no amendment history exists to close a row out yet.
  validTo: date('valid_to', { mode: 'string' }),
  supersededByNodeId: uuid('superseded_by_node_id').references(
    (): AnyPgColumn => documentNode.id,
  ),
});
