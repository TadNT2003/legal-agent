# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`legal-agent` is a Vietnamese-legal-domain RAG chatbot. Long-term architecture is hybrid retrieval — OpenSearch (BM25) + ChromaDB (semantic) + Neo4j (knowledge graph), fused via RRF, orchestrated by a tool-calling LLM agent, with Postgres as the source of truth. **Most of that is still not built.** Read `README.md` before assuming any retrieval/agent component exists — it documents the target architecture and explicitly marks what's proposal-only vs. done.

The server (`server/`) is deliberately split into **two independent workflows**, not meant to reconcile with each other:

- **`server/src/law/`** — scrapes vanban.chinhphu.vn into a flat file corpus (`laws/`), tracked by a JSON manifest, no database. Built for offline dataset-building (text processing, ML, ad-hoc analysis), scoped to all 14 Điều 4 tiers.
- **`server/src/law-index/`** — scrapes [vbpl.vn](https://vbpl.vn/) ("Cơ sở dữ liệu quốc gia về pháp luật", Bộ Tư pháp) and writes into Postgres. This is the actual ingestion path for the production RAG/chatbot system, scoped to **Trung ương only** (tiers 1–9 — central-issued documents have nationwide effect; local tiers 10–14 don't and are out of scope), **minus tier 4 (Lệnh, Quyết định của Chủ tịch nước) — deliberately excluded, not just not-yet-done.** Most tier-4 instruments are procedural (công bố luật, bổ nhiệm chức vụ, khen thưởng, …) rather than substantive legal content, so they don't contribute to the RAG corpus the way the other tiers do. vbpl.vn was chosen over vanban.chinhphu.vn for this workflow because it exposes a validity-status field, clean full text, and a curated relationship graph that vanban.chinhphu.vn structurally lacks — at the cost of needing a headless browser (Playwright) instead of a plain HTTP client, since it's a Next.js SPA.

Current build sequence (see README "Sequencing"): 3 search engines provisioned (done) → Postgres as source of truth (`document`/`issuing_body`/`document_reference`/`document_node` rows now being written by `law-index`, including the Điều/Khoản/Điểm/Phụ lục hierarchy) → CDC + sync-state + reconciliation (not started) → OpenSearch/ChromaDB/Neo4j projectors (not started) → agent/orchestration layer (not started).

## Commands

All commands run from `server/`:

```bash
npm run start:dev       # NestJS dev server with watch mode
npm run build            # nest build
npm run lint              # eslint --fix on src/apps/libs/test
npm run format             # prettier --write on src/ and test/
npm test                    # jest unit tests (run from server/, rootDir is src/)
npm test -- <pattern>        # run a single spec, e.g. npm test -- law-tier-classifier
npm run test:cov              # jest with coverage
npm run test:e2e               # e2e tests (test/jest-e2e.json)
```

Infra (Postgres/OpenSearch/ChromaDB/Neo4j), from the repo root:

```bash
cp .env.example .env      # then set strong passwords
docker compose up -d
docker compose ps          # all services should be `healthy` within ~60s
```

Server config: copy `server/.env.example` to `server/.env` (separate from the root `.env` used by docker-compose). `server/src/config/env.validation.ts` is the authoritative list of required env vars — Postgres/OpenSearch/Neo4j/ChromaDB connection info, `PORT`, `LAWS_DOWNLOAD_DIR`. The app fails fast on startup if any required var is missing.

Swagger/OpenAPI UI is served at `/api` once the server is running.

## Architecture

### `server/src/law/` — the one fully-implemented module

Umbrella module (`law.module.ts`) over three submodules, split by concern:

- **`download/`** — fetches documents from vanban.chinhphu.vn (the *only* source this module ever hits) via `VanBanChinhPhuClientService` (HTTP + cheerio HTML parsing) and `vanban-chinh-phu.parser.ts`. `LawDownloadService` orchestrates single-URL, batch (up to 100), and filtered-search downloads. `law-tier-classifier.ts` maps each document's type + issuing body to one of the 14 statutory tiers (Điều 4, Luật 64/2025/QH15); unrecognized types return an error rather than guessing, unless the caller passes `subdirOverride`.
- **`catalog/`** — read-only browsing/serving of what's already downloaded (`law-catalog.service.ts` + controller). Never touches the network. Fuzzy title search via `fuse.js` with diacritics folding; a document with attachments streams back as a zip, single-file documents stream as-is.
- **`utils/`** — plumbing shared by both: `LawManifestService` (the `laws/manifest.json` / `laws/download-log.csv` read-write layer, registered as the one shared provider in `LawUtilsModule`), plus pure non-DI helpers imported directly where needed — `document-matcher.ts` (title/citation matching), `tier-definitions.ts`, `filename.util.ts`, `text-normalize.util.ts`.

Every Bộ luật/luật document — base laws, superseded versions, and amendment laws alike — lands in one flat `02-luat-nghi-quyet-quoc-hoi/luat-bo-luat/` folder, regardless of validity status: this dataset is a text corpus for retrieval, not a "current law" database, so the classifier doesn't need to decide what's still in force. (An earlier version routed by title-based supersession detection into separate `luat/`/`luat-het-hieu-luc/`/`luat-sua-doi-bo-sung/` folders; that logic was removed once the `laws/` dataset stopped needing to double as a validity signal.) See `server/README.md` for the full endpoint list.

### `server/src/law-index/` — the Postgres ingestion module

Same layered pattern as `law/` (client / parser / service / module), plus a `persistence/` layer:

- **`crawl/`** — `VbplClientService` drives a real headless browser (Playwright) since vbpl.vn is a Next.js SPA whose document data renders client-side (confirmed by direct investigation — not present in raw server-rendered HTML, and not worth reverse-engineering the site's internal Next.js Server Action/RSC protocol). For each document it does 3 throttled page loads (default tab = full text, `?tabs=thuoc-tinh` = attributes, `?tabs=luoc-do` = relations) and returns *raw, uninterpreted* DOM extractions. `VbplSitemapService` does document discovery via plain HTTP against `sitemap.xml` (no browser needed — static XML), split into a Trung ương block (this module only ever follows this one) and a Địa phương block. `vbpl.parser.ts` is the pure, DI-free layer (mirrors `vanban-chinh-phu.parser.ts`) that turns the client's raw extractions into typed domain objects — including `RELATION_LABEL_MAP`, which maps vbpl.vn's 26 relation-card headings (13 concepts × inbound/outbound phrasing) to the schema's `reference_type`/`change_type` values.
- **`persistence/`** — Drizzle ORM schema (`schema/*.schema.ts`) + `db.module.ts` (reuses the existing `postgresConfig` namespace — this module is the first thing in the repo to actually open a Postgres connection) + `document.repository.ts` (upsert logic: resolve-or-create `issuing_body`, upsert `document` gated on a `content_version` hash so unchanged re-scrapes are cheap no-ops, upsert `document_reference` with forward-reference healing for relations pointing at not-yet-scraped documents) + `document-node.repository.ts` (`syncNodes()`: full delete-and-reinsert of a document's `document_node` tree, gated the same way — skipped when content is unchanged and nodes already exist).
- The schema is **not** a verbatim copy of `docs/schema/legal-agent.dbml` — cross-checking the DBML against vbpl.vn's real UI found real gaps (missing `document` columns for Ngành/Lĩnh vực/Người ký/Chức danh; a `reference_type` enum too coarse to keep several of vbpl.vn's 13 distinct relation categories separate, including the `promulgates`/"công bố" relationship database-design.md §1a had explicitly left as an undecided open question; a `node_type` missing `phu_luc`). The DBML has since been revised to reflect the shipped schema — see the schema files' own comments for the specifics behind each deviation.
- `document_node` (the Điều/Khoản/Điểm/Phụ lục hierarchy tree) is implemented — `document-node.parser.ts` turns a document's scraped `fullText` into the tree, `document-node.repository.ts` persists it. Full text is still also kept flat in `document.rawSource` (jsonb) as an audit copy.

### `laws/` — the workflow-A dataset

Not source code — a data directory with 14 top-level tier folders (`01-hien-phap/` … `14-quyet-dinh-ubnd-cap-huyen/`) mirroring Điều 4 of Luật 64/2025/QH15, described in `laws/README.md`. `manifest.json` is the single tracking list for every downloaded file; `download-log.csv` is an append-only per-attempt HTTP log. Only `server/src/law/` writes here (not `law-index/`, which writes to Postgres instead) — treat manual edits to `manifest.json` as something that will drift from disk state.

### Config pattern

`@nestjs/config` with `registerAs` namespaces (`app`, `postgres`, `opensearch`, `neo4j`, `chromadb`, `lawDownload`, `lawIndex` — the first five in `server/src/config/configuration.ts`, the other two colocated in their own modules as `law/utils/law-download.config.ts` and `law-index/law-index.config.ts`), loaded globally in `AppModule` and validated by a single Joi schema (`env.validation.ts`). When adding a new external dependency, follow this pattern: a `registerAs` config factory + corresponding Joi keys, not ad-hoc `process.env` reads in services. `law-index`'s `drizzle.config.ts` (server root) is the one exception — it's a standalone CLI config for `drizzle-kit` migrations, which run outside Nest's DI and read `POSTGRES_*` via `dotenv` directly instead.

### Planned but not implemented

Don't build against these as if they exist — check `README.md` and `docs/database-design.md` for current status before assuming:

- CDC pipeline (Debezium Server → per-document `content_version` → `document_sync_state` table → reconciliation job)
- OpenSearch/ChromaDB/Neo4j projectors and the actual RAG/agent orchestration layer that would consume the now-implemented `document_node` tree

`docs/vn-legal-document-structure.md` documents the Vietnamese legal-document hierarchy (the 14 tiers, Điều/Khoản/Điểm structure) that both the tier classifier and the future OpenSearch/ChromaDB chunking strategy are built around — read it before changing tier classification or designing chunking logic.

## Running a law-index scrape/backfill pass

When asked to scrape more documents into `law-index` (e.g. "scrape tier N", "backfill the remaining X documents"), this is the workflow that's actually worked in practice — not just the happy-path endpoint list.

**Endpoints that exist on this branch** (`law-index.controller.ts`): `POST /laws/index/crawl/url` (one document — the only per-document sync endpoint here), `POST /laws/index/crawl/all` (crawls the entire Trung ương sitemap, no tier/type filter, one long unbounded request — fine for a smoke test with `limit`, not for a targeted tier pass), `GET /laws/index/crawl/search` (read-only filtered search against live vbpl.vn, does not persist), `GET /laws/index/search` (same filters against already-synced Postgres rows). **There is no `/crawl/batch` endpoint here** — it exists only on other branches (`feat/full-database-crud`, `feat/references-sync`, `test/service-unit-test`); don't assume it's available without checking `git branch`/grepping the controller first.

**1. Discover candidates.** Prefer `GET /laws/index/crawl/search?documentTypes=[...]&issuingBodies=[...]`, paginated with `pageSize=100`. Two known-flaky spots in this endpoint, confirmed live (see `docs/monitoring/law-index-flagged-documents.md` §8): `keyword` search appears to ignore the query and return a fixed/stale result set regardless of input — don't rely on it; and some `documentTypes` values (confirmed on `"Hiến pháp"`) return `total: 0` or time out once `pageSize` is set, even when real matching documents exist. If a type search looks wrong, cross-check by fetching `https://vbpl.vn/sitemap.xml` directly (plain HTTP, no browser needed) — it's a sitemap index; the Trung ương block is `sitemap/1.xml` through `sitemap/12.xml`. Those files contain real, human-readable, diacritic-stripped slugs (e.g. `hien-phap-nam-1959--889`), so grepping for a keyword fragment is a reliable fallback for finding specific documents the search endpoint won't surface.

**2. Diff candidates against Postgres by `sourceUrl`, not citation — and never deduplicate multiple search results against each other by citation either.** The `crawl/search` response has a separate, confirmed mojibake bug (UTF-8 decoded as Windows-1252 somewhere in `VbplClientService.searchDocuments`) that corrupts every Vietnamese-diacritic field in the response — `citation`, `title`, `issuingBody`. `sourceUrl` is unaffected (vbpl.vn's own slugs are ASCII-only placeholders/ids) and is what actually drives the sync request, so match on `document.raw_source->>'sourceUrl'` in Postgres against the search results' `sourceUrl`, never on the corrupted `citation` string — this includes deduplicating a *merged* candidate list from more than one `documentTypes`/`issuingBodies` query, not just the final diff against Postgres. This bit a real backfill (`docs/monitoring/law-index-flagged-documents.md` §9): dozens of genuinely distinct pre-1976 documents share the literal citation `"Không số"`, and deduping a merged list by that corrupted field collapsed them down to one, silently dropping the other ~50 from the candidate list before the backfill ever tried them. If querying more than one type/filter combination for the same pass, keep each query's results (and each diff-against-Postgres) separate per query — don't merge-then-dedupe by anything but `sourceUrl`.

**3. Sync via `POST /laws/index/crawl/url`, in small sequential batches — start with ~20 as a stability check, then continue in chunks of ~50, reporting results after each chunk before starting the next.** This project's own history (`docs/monitoring/law-index-flagged-documents.md` §6) has repeatedly hit reliability collapse on large unattended single-shot batches — page-cache degradation, escalating failure rates, orphaned Chrome processes from restarts without `enableShutdownHooks()`. A `POST /laws/index/crawl/all` sized to hundreds of documents in one request is exactly the failure mode already documented there; don't repeat it. Before starting, verify the dev server is actually up (`curl http://localhost:3000/api`) — if a task resumes after a gap, assume it's died (machine idle, Docker restart) and restart it (`npm run start:dev`) rather than assuming.

**4. Between batches, remove both synced *and* permanently-skipped candidates from whatever pending list you're tracking** — not just the ones that got a new `document` row. `upsertDocument`'s citation-collision guard (`document.repository.ts`, see flagged-documents.md §4) returns `{ documentId: null, skippedReason }` for a document colliding with an already-`không còn hiệu lực` row under the same citation (common on pre-1990s "Không số"-citation documents) — this is a permanent, deterministic outcome, not a transient failure, so retrying it in the next batch just wastes a request. Track remaining candidates in a `docs/monitoring/law-index-pending-<name>-resync.csv` (same self-correcting-on-regeneration pattern as the existing pending-backfill CSVs referenced in the flagged-documents log) and delete it once the pass completes — don't leave a stale/empty tracking file around.

**5. Log any new pipeline bug found along the way in `docs/monitoring/law-index-flagged-documents.md` + its sibling CSV**, following the existing per-section format (root cause, fix, regression test, example) — this file is the project's only record of law-index data-quality issues and is expected to be appended to, not just read.
