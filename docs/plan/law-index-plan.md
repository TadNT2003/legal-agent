# law-index implementation plan

**Status: implemented.** This is the planning document that guided `server/src/law-index/` (see that module's files, and `server/README.md`'s "Law index" section for the current, user-facing description). Preserved here for the design rationale — the vbpl.vn-vs-DBML gap analysis in particular is not duplicated anywhere else in the repo.

> **Vietnamese version:** [law-index-plan.vi.md](law-index-plan.vi.md). This English version is canonical — prefer it where the two diverge.

A handful of things changed between this plan and the shipped code, found while building and end-to-end verifying against the live site and a real Postgres instance — not visible from reading the plan alone:

- **Relation-target resolution has no hrefs to use.** The plan (Scraping section) suggested checking whether relation list items carry a link to the target document. Confirmed live they don't — vbpl.vn's relation entries are plain React click handlers, not anchor tags with `href`. Citation-text extraction (`extractCitationFromTitle` in `vbpl.parser.ts`) is the only resolution path, not a fallback.
- **The two partial unique indexes for `document_reference` dedup don't work.** Standard Postgres unique indexes never treat two NULLs as equal, and `change_type` is null for most reference types — so duplicate rows passed straight through `ON CONFLICT DO NOTHING` on every re-sync. Fixed by moving dedup to the application layer (`document.repository.ts`'s `insertReferenceIfNotExists`) instead of a DB constraint. See that file and `document-reference.schema.ts`'s comments.
- **Sitemap "Trung ương" slicing was wrong.** The plan says "everything before the Địa phương marker" — but there's also a "Trang tĩnh" (static pages) block *before* Trung ương (homepage, `/gioi-thieu`, etc.), which is not called out in the plan and was only caught by an actual crawl attempting to scrape the homepage as if it were a legal document. Fixed to slice between the Trung ương and Địa phương markers.
- **`waitUntil: 'networkidle'` (implied by "3 throttled page loads," not specified further) turned out flaky** — a documented Playwright pitfall, confirmed live on a repeat navigation. Switched to `domcontentloaded` + waiting for the actual content selector.
- **`drizzle-kit migrate` (the CLI) silently fails in this environment** with no usable error output (Windows + git-bash specific, root cause not identified). `npm run db:migrate` runs `server/scripts/migrate.ts` instead, calling `drizzle-orm`'s migrator directly — see that script's comment.

Everything else below matches what was built.

---

## Context

The project is splitting into two independent workflows: the existing `server/src/law/` module (raw-file corpus builder, source = vanban.chinhphu.vn, output = flat files + `laws/manifest.json`, no DB) stays as-is for offline dataset building. This plan covers the **second, new workflow** — the ingestion path that will actually back the RAG/chatbot system, scoped to **Trung Ương only (tiers 1–9)**, since central-issued documents have nationwide effect (Điều 54.1, Luật 64/2025/QH15) while local (tiers 10–14) documents don't, and the system is meant to be applicable across all of Vietnam.

`vbpl.vn` ("Cơ sở dữ liệu quốc gia về pháp luật", built/operated by Bộ Tư pháp) was chosen as the source because it has what vanban.chinhphu.vn structurally lacks: a `Tình trạng hiệu lực` (validity status) field, clean full text per document (vs. vanban.chinhphu.vn's mixed PDF/DOCX/RTF), and a government-curated relationship diagram (`Lược đồ`) per document that maps almost 1:1 onto the Neo4j relationship taxonomy already designed in `docs/database-design.md` §2b.

Direct investigation (Playwright + curl against the live site) confirmed the technical shape this plan is built around:
- `vbpl.vn` is a Next.js App Router SPA. A document's full text and structured attributes are **not** in the raw server-rendered HTML — only SEO metadata (citation, title, org, a possibly-unreliable simplified `legislationLegalForce` flag) is present via a `schema.org/Legislation` JSON-LD block. The real per-field attributes, full text, and relations are rendered client-side via Next.js Server Actions (a `next-action` POST returning an RSC "Flight" payload) — an internal framework protocol, not a stable API, and not worth reverse-engineering. **A headless browser (Playwright) is required.**
- `robots.txt` disallows `/api/` and `/Pages/` only — page routes (`/van-ban/chi-tiet/*`) and `sitemap.xml` are explicitly allowed. This ingestion module must only ever navigate real pages, never call the disallowed paths directly.
- Each document detail page has 3 relevant tabs, each reachable by a **plain URL query param on a fresh page load** (no click-through needed): default = `Nội dung` (full text), `?tabs=thuoc-tinh` (structured metadata: citation, doc type, ngành, ngày ban hành, lĩnh vực, ngày có hiệu lực, tình trạng hiệu lực, ngày hết hiệu lực, cơ quan ban hành, chức danh, người ký), `?tabs=luoc-do` (relations: hướng dẫn áp dụng / quy định chi tiết / hợp nhất / sửa đổi bổ sung / đính chính / thay thế / bãi bỏ / dẫn chiếu / căn cứ ban hành / giải thích / đình chỉ thi hành / tạm ngưng hiệu lực / công bố, each with its linked documents).
- Document discovery doesn't need the search/filter UI at all — `sitemap.xml` lists 36 sub-sitemaps split into a "Trung ương" block (confirmed: sitemaps 1–12, ~5,000 URLs each) and a "Địa phương" block after it. This gives a stable, plain-HTTP-crawlable list of every central-government document URL.

**Two decisions already made** (confirmed with the user): Postgres access layer = **Drizzle ORM** (best fit for this schema's `ltree`/enum-heavy design and the codebase's existing lean style); scope = **document-level only for this pass** — the `document_node` Điều/Khoản/Điểm hierarchy tree (needed for OpenSearch/ChromaDB/Neo4j chunking) is deferred to a follow-up plan once this ingestion path is proven.

`docs/database-design.md` + `docs/schema/legal-agent.dbml` are proposal-only (no migrations exist), and the two documents disagree in a few places — this plan treats the **DBML as canonical** (it's the more precise, more recently revised of the two), but with more than cosmetic fixes: the DBML's `document` columns and `reference_type` enum were cross-checked directly against vbpl.vn's real UI (its full i18n label dictionary, which enumerates every field and relation category the site actually renders) and the DBML **does not fully cover what vbpl.vn exposes**. Concrete gaps found:

**`document` table — 4 real fields with no column:**
`Ngành` (industry/sector), `Lĩnh vực` (topic/field), `Chức danh` (signer's title, e.g. "Bộ trưởng"), `Người ký` (signer's name) all appear on every document's attributes tab and have no corresponding column in the DBML `document` table today.

**`reference_type` enum — vbpl.vn's `Lược đồ` tab models 13 distinct relationship categories** (confirmed via its i18n dictionary, both inbound/passive and outbound/active label pairs — `guided`/`guides`, `detailAndGuided`/`detailAndGuides`, `consolidated`/`consolidates`, `amended`/`amends`, `corrected`/`corrects`, `replaced`/`replaces`, `abrogated`/`abrogates`, `referenced`/`referencedText`, `basis`/`basedText`, `explained`/`explanatoryText`, `suspendedFromExecution`/`suspendExecution`, `suspended`/`temporarilySuspended`, `published`/`publish`, plus a 14th non-legal `relatedContent` "similar topic" bucket). Against the DBML's 8-value `reference_type` enum:
- `Văn bản hướng dẫn áp dụng` (guided/guides — "how to apply this doc") has no matching value at all.
- `Căn cứ ban hành` (basis) and `Quy định chi tiết, hướng dẫn thi hành` (detailAndGuided) are **two distinct categories on vbpl.vn** but both would collapse into the single DBML value `implements`, losing the distinction between "this document cites X as its legal authority" and "this document operationalizes/details X."
- `Văn bản được giải thích` (explained — an official interpretation issued per Điều 60, Luật 64/2025/QH15) has no matching value.
- `Đình chỉ thi hành` (suspend execution) and `Tạm ngưng hiệu lực` (suspend effect) are legally distinct (Điều 3.1 vs. Điều 56) but both would collapse into the same `amends` + `change_type=suspend`.
- `Văn bản công bố` (published/promulgated) has no matching value — and this is exactly the `PROMULGATES` relationship database-design.md §1a already flagged as "an open question... not a final decision." vbpl.vn's own data confirms it's a real, government-curated relationship, not a hypothetical.
- Two internal redundancies: `consolidated_by` (reference_type) duplicates what `document.is_consolidated`/`consolidates_document_id` already capture as document-level columns; `repeals` (standalone reference_type) duplicates `amends`+`change_type=repeal` as two ways to encode the same "bãi bỏ" fact.
- `defines_term` exists in the DBML but has no corresponding vbpl.vn relation category — not sourced by this scrape, left unused for now (still valid for the LLM-extraction use case database-design.md designed it for).
- `relatedContent` is a "similar topic" recommendation, not a legal-authority relationship — doesn't belong in `document_reference` at all.

The Drizzle schema (see Persistence, below) applies concrete fixes for all of the above rather than copying the DBML verbatim — detailed there.

## Approach

### New module: `server/src/law-index/`

A new top-level module, sibling to `server/src/law/`, mirroring its established layering (client / parser / service / module split, confirmed from `vanban-chinh-phu-client.service.ts`, `vanban-chinh-phu.parser.ts`, `law-download.service.ts`, `law-download.module.ts`):

```
server/src/law-index/
  law-index.module.ts
  law-index.config.ts              -- registerAs('lawIndex', ...): crawl delay, headless flag, sitemap base URL, LAW_INDEX_MAX_TIER (default 9 — encodes the trung-ương-only decision as an overridable setting, not a hardcoded constant, matching lawDownloadConfig's pattern)
  crawl/
    vbpl-client.service.ts         -- owns a single shared Playwright browser instance (launched once, closed via OnModuleDestroy); throttled page.goto() calls, same shared-lastRequestAt pattern as VanBanChinhPhuClientService; never touches /api/ or /Pages/
    vbpl-sitemap.service.ts        -- plain fetch (no browser needed) of sitemap.xml + the trung-ương sub-sitemaps; yields document detail URLs
    vbpl.parser.ts                 -- pure functions (no DI, no I/O): parseContentTab, parseAttributesTab, parseRelationsTab — take rendered DOM/text, return typed interfaces. Mirrors vanban-chinh-phu.parser.ts's pure-function style, but operates on Playwright-extracted DOM data instead of a cheerio-loaded HTML string
    vbpl-document.interface.ts     -- ParsedVbplDocument, VbplRelation, VbplAttributes
  persistence/
    schema/                        -- Drizzle schema: issuing-body.schema.ts, document.schema.ts, document-reference.schema.ts (DBML-derived, with the two noted fixes)
    migrations/                    -- drizzle-kit generated SQL
    db.module.ts                   -- Drizzle client provider, wired from the existing postgresConfig (src/config/configuration.ts) via the same ConfigType<typeof postgresConfig> injection LawManifestService already uses — no new config duplication
    document.repository.ts         -- upsert logic: resolve-or-create issuing_body by name; upsert document (compute content_version as a hash of full text + key metadata, skip rewrite if unchanged); upsert document_reference rows
  law-index.service.ts             -- orchestrator: sitemap crawl -> per URL, 3 scoped page loads -> parse -> persist
  law-index.controller.ts          -- HTTP endpoints, matching the existing controller shape (law-download.controller.ts): POST /law-index/sync (full trung-ương crawl, resumable/idempotent), POST /law-index/sync/document (single URL, for retries/spot-checks)
```

New dependencies: `playwright` (+ a documented one-time `npx playwright install chromium` setup step in `server/README.md` — no Dockerfile exists for the server yet, so containerizing this is explicitly out of scope here), `drizzle-orm` + `drizzle-kit` (dev) + `pg` (Drizzle's Postgres driver).

### Discovery: sitemap-driven, Trung Ương only

Primary filter: only follow sub-sitemaps in the "Trung ương" block of `sitemap.xml` (positionally before the `<!-- Địa phương -->` comment — parse the raw XML text for that comment marker rather than hardcoding "sitemaps 1–12", since the index could be regenerated with different numbering). Safety net: since each scraped page's own breadcrumb tells us its actual category, skip-and-don't-persist any document whose breadcrumb says "Địa phương" even if it came from a nominally-trung-ương sitemap bucket.

### Scraping one document (3 throttled page loads)

1. `goto(url)` → extract full text from the `Nội dung` tab (used as a content_version input and stored on `document.raw_source` for now — see below)
2. `goto(url + '?tabs=thuoc-tinh')` → extract the attributes table
3. `goto(url + '?tabs=luoc-do')` → extract each relation category + its linked documents (check whether list items carry hrefs to the target's own detail URL — if so, use that directly to resolve `document_reference.target_document_id`/citation instead of fuzzy title matching)

Implementation-time tasks flagged explicitly (not yet nailed down by this plan, need doing before/while writing `vbpl.parser.ts`):
- Inspect real DOM structure (not just `innerText`) for the attributes table and relations list on a handful of sample documents (different tiers, different eras — old scanned-era docs may render differently) to write robust selectors.
- Enumerate every real `Tình trạng hiệu lực` string vbpl.vn uses (only "Chưa có hiệu lực" observed so far) and build the mapping to the 5-value `validity_status` enum.

### Persistence (document-level only this pass)

Tables implemented: `issuing_body`, `document`, `document_reference` — DBML-derived, with concrete fixes applied per the gap analysis above rather than a verbatim copy:

- `document`: add `industry` (Ngành), `field` (Lĩnh vực), `signer_name` (Người ký), `signer_title` (Chức danh) columns; reinstate `index_scope` (dropped from DBML but load-bearing per §1a); use the DBML's `validity_status` enum spelling.
- `reference_type` enum: extend beyond the DBML's 8 values to preserve vbpl.vn's real distinctions — add `guides` (hướng dẫn áp dụng), `has_basis` (Căn cứ ban hành, kept separate from `implements`), `explains` (giải thích), and `promulgates` (công bố — this plan just implements the relationship database-design.md §1a left as an open question, since vbpl.vn's data confirms it's real and government-curated, not hypothetical). Drop `consolidated_by` (redundant with `document.is_consolidated`/`consolidates_document_id`, which already cover it). Keep `repeals` as the sole representation of bãi bỏ (drop the redundant `amends`+`change_type=repeal` path for this case). Keep `defines_term` unused for now (no vbpl.vn source yet, still valid for future LLM extraction). `suspendedFromExecution`/`suspendExecution` map to `change_type=suspend_execution` and `suspended`/`temporarilySuspended` map to `change_type=suspend_effect` (two `change_type` values instead of one shared `suspend`, so the two legally-distinct concepts don't collide).
- `relatedContent` ("similar topic") is explicitly **not** persisted into `document_reference` — it's a content-similarity recommendation, not a legal-authority relationship, and doesn't fit this table's purpose.

**Not implemented yet**: `document_node` (deferred), `document_sync_state`/CDC (no downstream projector exists to sync to yet — premature).

- No dedicated full-text column exists at the `document` level in the schema (text belongs on `document_node.text_content`, which we're deferring) — store the scraped full text as a stopgap in `document.raw_source` (jsonb, already nullable/designed for this): `{ fullText, scrapedAt, sourceUrl }`. Called out explicitly as a temporary measure, replaced once `document_node` parsing lands.
- `document.content_version` = hash (SHA-256) of full text + key metadata fields — gives cheap re-scrape idempotency (skip the write if unchanged) now, and becomes the CDC trigger later.
- `document_reference` resolution tolerates forward references: if a related document hasn't been scraped yet, insert the row with `target_document_id = NULL` and `raw_citation_text` populated; after each crawl batch, re-resolve any NULL `target_document_id` rows against `document.citation_id` (self-healing, same spirit as the existing `resolveLuatSupersession` fix-up pattern in `law-download.service.ts`).

### Config

`lawIndexConfig` (colocated in the module, same pattern as `lawDownloadConfig` in `src/law/utils/law-download.config.ts`) — not folded into the shared `src/config/configuration.ts`, since it's module-scoped, not an external-service connection. Postgres connection reuses the existing `postgresConfig`/`POSTGRES_*` Joi keys already in `env.validation.ts` — no new env vars needed there.

### Explicitly out of scope (future plans)

- `document_node` Điều/Khoản/Điểm chunking (deferred per the scoping decision)
- `document_sync_state`, CDC pipeline, OpenSearch/ChromaDB/Neo4j projectors — already tracked in `README.md`'s Sequencing section as later phases
- Containerizing the server / Playwright (no Dockerfile exists for `server/` at all today)
- Resolving every database-design.md-vs-DBML discrepancy that isn't blocking this scope — `document_node`'s missing `phu_luc`/`content_class` (irrelevant while document_node itself is deferred) and `document_sync_state`'s missing `not_applicable` status (irrelevant with no CDC yet) are left alone. The `document`/`reference_type` fixes in Persistence above *are* applied now because they're not deferrable — they'd otherwise silently drop real data on every single document scraped.
- Updating `docs/database-design.md`/`docs/schema/legal-agent.dbml` themselves to reflect these fixes — should happen once this plan is implemented and the schema is proven, so the docs describe what's actually built rather than a third, briefly-correct snapshot

## Verification

- Unit tests for `vbpl.parser.ts`'s pure functions using saved fixture HTML/DOM snapshots, following the existing no-Nest-testing-module, literal-fixture style of `vanban-chinh-phu.parser.spec.ts`.
- Manual end-to-end: `docker compose up -d postgres` (already provisioned in `docker-compose.yml`), run drizzle migrations, then run `law-index.service`'s single-document sync against the real URLs already explored during planning (the Thông tư 05/2026/TT-BNG example plus 2–3 others spanning different tiers/eras) and inspect the resulting rows via `psql`.
- Full crawl smoke test: point the sitemap crawler at just the first sub-sitemap with a small limit (e.g. first 20 URLs) before ever running an unbounded trung-ương-wide crawl.
