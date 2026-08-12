import {
  pgEnum,
  pgTable,
  text,
  uuid,
  integer,
  AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const issuingScopeEnum = pgEnum('issuing_scope', ['national', 'local']);

// docs/database-design.md §1 / docs/schema/legal-agent.dbml. Uses `text`
// instead of DBML's unqualified `varchar` throughout this module's schema —
// Postgres treats them identically performance-wise and DBML never specified
// lengths, so an explicit length would just be an arbitrary constraint.
export const issuingBody = pgTable('issuing_body', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  nameEn: text('name_en'),
  // Lower = higher authority (Điều 4, Luật 64/2025/QH15's tier ordering).
  authorityRank: integer('authority_rank').notNull(),
  scope: issuingScopeEnum('scope').notNull().default('national'),
  parentBodyId: uuid('parent_body_id').references(
    (): AnyPgColumn => issuingBody.id,
  ),
});
