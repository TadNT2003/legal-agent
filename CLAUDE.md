# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`legal-agent` is a Vietnamese-legal-domain RAG chatbot. Long-term architecture is hybrid retrieval — OpenSearch (BM25) + ChromaDB (semantic) + Neo4j (knowledge graph), fused via RRF, orchestrated by a tool-calling LLM agent, with Postgres as the source of truth. **Almost none of that is built yet.** What actually exists today is a NestJS server (`server/`) that scrapes/downloads Vietnamese legal documents from vanban.chinhphu.vn into a flat dataset (`laws/`). Read `README.md` before assuming any retrieval/agent component exists — it documents the target architecture and explicitly marks what's proposal-only vs. done.

Current build sequence (see README "Sequencing"): 3 search engines provisioned (done) → Postgres as source of truth (done, no CDC yet) → CDC + sync-state + reconciliation (not started) → agent/orchestration layer (not started). The `server/src/law/` download-and-catalog module is a separate, already-working piece that populates the raw dataset these future stores will ingest from.

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

Key behavior to know before touching this code: **automatic supersession detection**. When a standalone law (not an amendment, not a Quốc hội resolution) lands in `luat/`, the module checks for an existing document with the same normalized title; the later-dated one keeps `luat/`, the older one is (re)routed to `luat-het-hieu-luc/`. This is a title-text heuristic — the source site exposes no authoritative "this replaces that" relationship — and it's what keeps `laws/` self-correcting regardless of download order. See `server/README.md` for the full endpoint list and this logic's caveats.

### `laws/` — the dataset itself

Not source code — a data directory with 14 top-level tier folders (`01-hien-phap/` … `14-quyet-dinh-ubnd-cap-huyen/`) mirroring Điều 4 of Luật 64/2025/QH15, described in `laws/README.md`. `manifest.json` is the single tracking list for every downloaded file; `download-log.csv` is an append-only per-attempt HTTP log. Only `server/src/law/` writes here — treat manual edits to `manifest.json` as something that will drift from disk state.

### Config pattern

`@nestjs/config` with `registerAs` namespaces (`app`, `postgres`, `opensearch`, `neo4j`, `chromadb`, `lawDownload` — all defined in `server/src/config/configuration.ts` plus `law/utils/law-download.config.ts`), loaded globally in `AppModule` and validated by a single Joi schema (`env.validation.ts`). When adding a new external dependency, follow this pattern: a `registerAs` config factory + corresponding Joi keys, not ad-hoc `process.env` reads in services.

### Planned but not implemented

Don't build against these as if they exist — check `README.md` and `docs/database-design.md` for current status before assuming:

- CDC pipeline (Debezium Server → per-document `content_version` → `document_sync_state` table → reconciliation job)
- OpenSearch/ChromaDB/Neo4j projectors and the actual RAG/agent orchestration layer
- Postgres schema is designed (`docs/database-design.md`, `docs/schema/legal-agent.dbml`) but has no application code writing to it yet

`docs/vn-legal-document-structure.md` documents the Vietnamese legal-document hierarchy (the 14 tiers, Điều/Khoản/Điểm structure) that both the tier classifier and the future OpenSearch/ChromaDB chunking strategy are built around — read it before changing tier classification or designing chunking logic.
