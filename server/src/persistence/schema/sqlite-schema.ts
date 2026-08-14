import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const issuingBody = sqliteTable('issuing_body', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  nameEn: text('name_en'),
  authorityRank: integer('authority_rank').notNull(),
  scope: text('scope', { enum: ['national', 'local'] })
    .notNull()
    .default('national'),
  parentBodyId: text('parent_body_id'),
});

export const document = sqliteTable('document', {
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
  rawSource: text('raw_source'),
  originalDocumentUrls: text('original_document_urls', { mode: 'json' })
    .notNull()
    .$type<string[]>()
    .default([]),
  contentVersion: text('content_version').notNull(),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
});

export const documentNode = sqliteTable('document_node', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  parentId: text('parent_id'),
  nodeType: text('node_type').notNull(),
  contentClass: text('content_class'),
  path: text('path').notNull(),
  ordinal: text('ordinal').notNull(),
  label: text('label').notNull(),
  heading: text('heading'),
  textContent: text('text_content'),
  contentHash: text('content_hash').notNull(),
  status: text('status'),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to'),
  supersededByNodeId: text('superseded_by_node_id'),
});

export const documentReference = sqliteTable('document_reference', {
  id: text('id').primaryKey(),
  sourceDocumentId: text('source_document_id'),
  targetDocumentId: text('target_document_id'),
  sourceNodeId: text('source_node_id'),
  targetNodeId: text('target_node_id'),
  referenceType: text('reference_type').notNull(),
  changeType: text('change_type'),
  rawCitationText: text('raw_citation_text').notNull(),
  extractionMethod: text('extraction_method')
    .notNull()
    .default('deterministic'),
  confidence: real('confidence'),
  createdAt: text('created_at'),
});
