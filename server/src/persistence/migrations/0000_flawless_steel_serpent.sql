CREATE TYPE "public"."issuing_scope" AS ENUM('national', 'local');--> statement-breakpoint
CREATE TYPE "public"."index_scope" AS ENUM('full', 'metadata_only');--> statement-breakpoint
CREATE TYPE "public"."validity_status" AS ENUM('con_hieu_luc', 'het_hieu_luc', 'het_hieu_luc_mot_phan', 'chua_co_hieu_luc', 'ngung_hieu_luc');--> statement-breakpoint
CREATE TYPE "public"."change_type" AS ENUM('replace', 'suspend_execution', 'suspend_effect');--> statement-breakpoint
CREATE TYPE "public"."extraction_method" AS ENUM('deterministic', 'llm');--> statement-breakpoint
CREATE TYPE "public"."reference_type" AS ENUM('cites', 'amends', 'repeals', 'corrects', 'implements', 'guides', 'has_basis', 'explains', 'promulgates', 'defines_term');--> statement-breakpoint
CREATE TABLE "issuing_body" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"authority_rank" integer NOT NULL,
	"scope" "issuing_scope" DEFAULT 'national' NOT NULL,
	"parent_body_id" uuid,
	CONSTRAINT "issuing_body_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"citation_id" text NOT NULL,
	"title" text NOT NULL,
	"document_type" text NOT NULL,
	"issuing_body_id" uuid NOT NULL,
	"industry" text,
	"field" text,
	"signer_name" text,
	"signer_title" text,
	"enacted_date" date NOT NULL,
	"effective_date" date,
	"gazette_published_date" date,
	"status" "validity_status" NOT NULL,
	"index_scope" "index_scope" DEFAULT 'full' NOT NULL,
	"is_consolidated" boolean DEFAULT false NOT NULL,
	"consolidates_document_id" uuid,
	"raw_source" jsonb,
	"content_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_citation_id_unique" UNIQUE("citation_id")
);
--> statement-breakpoint
CREATE TABLE "document_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid,
	"target_document_id" uuid,
	"reference_type" "reference_type" NOT NULL,
	"change_type" "change_type",
	"raw_citation_text" text NOT NULL,
	"extraction_method" "extraction_method" DEFAULT 'deterministic' NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issuing_body" ADD CONSTRAINT "issuing_body_parent_body_id_issuing_body_id_fk" FOREIGN KEY ("parent_body_id") REFERENCES "public"."issuing_body"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_issuing_body_id_issuing_body_id_fk" FOREIGN KEY ("issuing_body_id") REFERENCES "public"."issuing_body"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_consolidates_document_id_document_id_fk" FOREIGN KEY ("consolidates_document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reference" ADD CONSTRAINT "document_reference_source_document_id_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_reference" ADD CONSTRAINT "document_reference_target_document_id_document_id_fk" FOREIGN KEY ("target_document_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_reference_resolved_edge_idx" ON "document_reference" USING btree ("source_document_id","target_document_id","reference_type","change_type") WHERE "document_reference"."target_document_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "document_reference_unresolved_edge_idx" ON "document_reference" USING btree ("source_document_id","reference_type","change_type","raw_citation_text") WHERE "document_reference"."target_document_id" is null;