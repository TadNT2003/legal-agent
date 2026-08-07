-- Neither document_node.document_id/parent_id/superseded_by_node_id nor
-- document_reference.source_node_id/target_node_id had a supporting index.
-- Confirmed live (2026-08-07): every syncNodes() delete-then-reinsert paid
-- for Postgres's own per-row FK-reference check on parent_id
-- ("SELECT 1 FROM document_node WHERE parent_id = $1 FOR KEY SHARE") as a
-- full sequential scan of the whole table, on top of the WHERE document_id =
-- $1 lookup itself also being a sequential scan — caught via pg_stat_activity
-- mid-flight, still running after 3+ minutes for one 1,636-node document.
CREATE INDEX "document_node_document_id_idx" ON "document_node" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_node_parent_id_idx" ON "document_node" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "document_node_superseded_by_node_id_idx" ON "document_node" USING btree ("superseded_by_node_id");--> statement-breakpoint
CREATE INDEX "document_reference_source_node_idx" ON "document_reference" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "document_reference_target_node_idx" ON "document_reference" USING btree ("target_node_id");
