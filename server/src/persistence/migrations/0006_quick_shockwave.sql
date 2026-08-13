-- Performance indexes for document_reference. The resolved/unresolved unique
-- indexes from 0000 were dropped in 0001 (NULL-in-unique-index footgun), but
-- plain non-unique indexes on source/target are safe and speed up the scraper's
-- hot paths: insertReferenceIfNotExists dedup selects, upsertRelations lookups,
-- and healDanglingReferences scans (WHERE target_document_id IS NULL).
CREATE INDEX "document_reference_source_doc_idx" ON "document_reference" USING btree ("source_document_id");--> statement-breakpoint
CREATE INDEX "document_reference_target_doc_idx" ON "document_reference" USING btree ("target_document_id");