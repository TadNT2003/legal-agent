-- Hand-added: drizzle-kit has no knowledge of Postgres extensions. Required
-- before "path"'s ltree column type below can be created. Postgres's
-- standard image (postgres:17-alpine, see docker-compose.yml) ships ltree as
-- a bundled contrib extension — no extra image/package needed.
CREATE EXTENSION IF NOT EXISTS ltree;--> statement-breakpoint
CREATE TYPE "public"."content_class" AS ENUM('normative', 'template');--> statement-breakpoint
CREATE TYPE "public"."node_type" AS ENUM('phan', 'chuong', 'muc', 'tieu_muc', 'dieu', 'khoan', 'diem', 'phu_luc');--> statement-breakpoint
CREATE TABLE "document_node" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"parent_id" uuid,
	"node_type" "node_type" NOT NULL,
	"content_class" "content_class",
	"path" "ltree" NOT NULL,
	"ordinal" text NOT NULL,
	"label" text NOT NULL,
	"heading" text,
	"text_content" text,
	"content_hash" text NOT NULL,
	"status" "validity_status",
	"valid_from" date NOT NULL,
	"valid_to" date,
	"superseded_by_node_id" uuid
);
--> statement-breakpoint
-- Hand-added: drizzle-orm 0.45.2 has no way to express the gist_ltree_ops
-- opclass via its index builder, so this isn't declared in document-node.schema.ts.
CREATE INDEX "document_node_path_gist_idx" ON "document_node" USING gist ("path" gist_ltree_ops);--> statement-breakpoint
ALTER TABLE "document_reference" ADD COLUMN "source_node_id" uuid;--> statement-breakpoint
ALTER TABLE "document_reference" ADD COLUMN "target_node_id" uuid;--> statement-breakpoint
ALTER TABLE "document_node" ADD CONSTRAINT "document_node_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_node" ADD CONSTRAINT "document_node_parent_id_document_node_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."document_node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_node" ADD CONSTRAINT "document_node_superseded_by_node_id_document_node_id_fk" FOREIGN KEY ("superseded_by_node_id") REFERENCES "public"."document_node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reference" ADD CONSTRAINT "document_reference_source_node_id_document_node_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."document_node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reference" ADD CONSTRAINT "document_reference_target_node_id_document_node_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."document_node"("id") ON DELETE no action ON UPDATE no action;