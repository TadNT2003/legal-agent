# OpenSearch projector implementation plan

**Status: proposed, not started.** No projector code, index mapping, or `document_sync_state` table exists yet — see [../../README.md](../../README.md)'s Sequencing section. This plan covers the **first** of the three search-engine projectors and implements the design already written in [../database-design.md](../database-design.md) §3, with corrections where that design disagrees with the shipped schema or the live cluster (called out inline).

## Context

`law-index` has been writing to Postgres for a while — 3,338 documents, 507,289 `document_node` rows — but nothing propagates anywhere else. README sequencing puts the three projectors after Postgres, and OpenSearch is the cheapest: no embedding model, no LLM extraction, just a row→JSON mapping.

This plan builds **only** the lexical/BM25 leg. No hybrid, no RRF, no vectors, no graph, no reranking — those are scoped in [../research/legal-ai-retrieval-landscape.md](../research/legal-ai-retrieval-landscape.md) and explicitly out of scope here.

### Measured starting point

|                             |                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `document`                | 3,338 (3,040 have nodes; 298 have no "Nội dung" tab upstream)                                               |
| `document_node`           | 507,289 — 69,773`dieu`, 244,374 `khoan`, 180,130 `diem`, 726 `phu_luc` (724 normative / 2 template) |
| Text volume                 | ~87 MB                                                                                                       |
| **Target index size** | **~70,497 docs** (69,773 Điều + 724 normative Phụ lục)                                             |
| All nodes                   | `valid_to IS NULL` — no amendment history yet, so §3a's version filter is a no-op today                  |
| All documents               | `index_scope = 'full'` — that filter is also a no-op today                                                |

Small enough that a full backfill is minutes, and single-shard is correct.

### Decisions taken

1. **`analysis-icu`**, the official OpenSearch plugin — not the community Vietnamese plugin. `duydo/opensearch-analysis-vietnamese` (cited in §3c) has **zero published releases**; adopting it means building it and the CocCoc C++ tokenizer from source against 2.19.1.
2. **Ship `POST /search`** in v1 as a verification endpoint — not the RAG retrieval API.
3. **Fix the parser first.** The duplicate-node defect blocks projection.

---

## Phase 0 — Fix `document-node.parser.ts` (blocking)

### The defect

**636 of 3,338 documents (19%)** contain `document_node` rows colliding on `(document_id, path)`. Duplicate groups by type: `khoan` 5,630, `diem` 3,564, `dieu` 161, `phu_luc` 46, `chuong` 32, `muc` 8, `phan` 5.

It is a **numbering** bug, not row duplication. Worked example — `22/2026/NQ-CP` has 21 nodes at `path = phu_luc1`, `label = "Phụ lục I"`, with different content:

```text
Cắt giảm thủ tục hành chính thuộc lĩnh vực cấp, quản lý căn cước
Cắt giảm thủ tục hành chính thuộc lĩnh vực định danh và xác thực điện tử
(Kèm theo Nghị quyết số 22/2026/NQ-CP ngày 29 tháng 4 năm 2026 của Chính…)
…
```

Mechanism, in `parseDocumentBody`: once `phuLucNode` is open, **any** line matching `PHU_LUC_PATTERN` opens a new sibling annex. Real appendices repeat their own "Phụ lục I" header once per section, plus a "(Kèm theo …)" sub-header line. Each repetition opens a node — but `openPhuLucFromMatch` computes `ordinal = match[2] ? romanToArabic(match[2]) : String(annexCounter)`, so when the numeral *is* present every repetition yields ordinal `1`. `annexCounter` increments but is only consulted when the numeral is absent.

### Work

- Guard the `if (phuLucNode)` branch: a `PHU_LUC_PATTERN` line whose numeral equals the currently-open annex's is a **repeated header**, not a new annex — append to the current node (or drop the header line) rather than opening a sibling.
- Investigate the `khoan`/`diem` collisions the same way; they are the bulk of the groups and likely share the re-match-inside-content shape. Confirm against a real affected document before changing anything.
- Backstop: if a computed ordinal would collide with an open sibling, fall back to the monotonic counter rather than emitting a duplicate.
- Extend `document-node.parser.spec.ts` with a fixture reproducing the repeated-header case. This is the one place in the feature with real test coverage — the repo keeps parsers DI-free precisely so they can be tested.

### Re-scrape

`PUT /laws/index/crawl/batch?force=true` in lots of ~50 over the 636 affected documents (~13 lots), per CLAUDE.md's batch guidance. `force` is required: `content_version` is hashed from the vbpl.vn page, so a parser change alone does not invalidate it.

Source list:

```sql
SELECT DISTINCT d.raw_source->>'sourceUrl'
FROM document d JOIN document_node n ON n.document_id = d.id
WHERE (n.document_id, n.path, n.node_type) IN (
  SELECT document_id, path, node_type FROM document_node
  GROUP BY 1,2,3 HAVING count(*) > 1);
```

**Gate:** that query returns 0 rows before Phase 2 runs.

Log the defect in [../monitoring/law-index-flagged-documents.md](../monitoring/law-index-flagged-documents.md) as a new numbered section (root cause / fix / regression test / example), per CLAUDE.md step 5.

---

## Phase 1 — OpenSearch infrastructure

### `analysis-icu` plugin

Not installed — verified against the running container (`_cat/plugins` lists 24 components; neither `analysis-icu` nor `analysis-vietnamese` is among them). Needs a custom image.

- New `docker/opensearch/Dockerfile`: `FROM opensearchproject/opensearch:2.19.1` + `RUN opensearch-plugin install --batch analysis-icu`.
- `docker-compose.yml`: replace `image:` on the `opensearch` service with `build:`, keeping every existing env var, ulimit, volume, and healthcheck unchanged.
- `docker compose build opensearch && docker compose up -d opensearch`. The `opensearch-data` volume survives.

### Analyzers

Keep §3c's analyzer **names** so a future word-segmenting plugin is a settings-only swap:

```text
vi_analyzer : tokenizer=standard, filter=[lowercase]                   # diacritic-sensitive
vi_folded   : tokenizer=standard, char_filter=[icu_normalizer],
              filter=[lowercase, icu_folding]                          # diacritic-insensitive
```

**Known limitation, to record in the module docblock:** `standard` splits Vietnamese per *syllable*, so "quy phạm pháp luật" is 4 tokens, not 1 term. Recall is unaffected; precision on multi-syllable legal terminology suffers, and IDF is computed over syllables. Positions are preserved, so `match_phrase` stays available as a later knob. Reversible with zero application change via the alias/reindex path in §3e.

---

## Phase 2 — Projector module

New submodule `server/src/law-index/opensearch/`, following the `retrieve/` and `sync/` shape exactly: flat folder + `dto/`, own `*.module.ts`, `imports: [DbModule]`, repositories re-listed in `providers` (there is no shared persistence module — `DbModule` exports only the `DRIZZLE` token).

### Files to create

| Path                             | Contents                                                                                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opensearch-client.module.ts`  | Mirrors`persistence/db.module.ts`: `OPENSEARCH_CLIENT` symbol + `useFactory` injecting `opensearchConfig.KEY`, building `new Client({ node, auth, ssl: { rejectUnauthorized } })`. Exports the token.      |
| `opensearch.config.ts`         | Colocated`registerAs('opensearchProjector', …)` — index base name, version, read/write alias names, bulk caps, shard/replica counts. Follows `law-index.config.ts`.                                            |
| `legal-provisions.mapping.ts`  | Pure constants. §3b's` ```text ` block converted to real JSON, plus settings.                                                                                                                                     |
| `provision.projection.ts`      | **Pure, DI-free core.** `projectDocument(meta, flatNodes) → { provisions, stats }`. No `@nestjs/*`, no repository, no client — the `vbpl.parser.ts` precedent.                                         |
| `provision.projection.spec.ts` | The only test in the feature. Covers: Điểm folding into Khoản, Điều with no Khoản,`template` phụ lục exclusion, container-node exclusion, null `status`/`heading` omission.                            |
| `index-admin.service.ts`       | `ensureIndex()` (create + attach both aliases, idempotent), `promoteAliases()`, `getStatus()`, `dropIndex()` (refuses an aliased index).                                                                     |
| `opensearch.service.ts`        | `backfill()`, `reprojectDocument()`, `search()`. Owns the document loop, bulk buffer, summary.                                                                                                                 |
| `opensearch.controller.ts`     | `@ApiTags('law-index')`, `@Controller('laws/index/opensearch')`.                                                                                                                                                 |
| `opensearch.module.ts`         | Wires the above.                                                                                                                                                                                                     |
| `dto/*.dto.ts`                 | `backfill`, `backfill-response`, `reproject`, `index-status-response`, `promote-aliases`, `search-provisions` + `-response`. `class-validator` + `@ApiProperty` on every field, per existing DTOs. |

### Files to modify

| Path                                               | Change                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/package.json`                            | Add`@opensearch-project/opensearch` (verify its compat matrix covers 2.19.1). No HTTP client exists today; the client earns its place via `_bulk` NDJSON handling, typed per-item errors, and first-class `ssl.rejectUnauthorized` — Node's global `fetch` would need a custom undici `Dispatcher` for the self-signed cert. |
| `server/src/config/configuration.ts`             | Extend`opensearchConfig` with `rejectUnauthorized`, `requestTimeoutMs`.                                                                                                                                                                                                                                                           |
| `server/src/config/env.validation.ts`            | Joi keys for the above + projector keys,**all with defaults, none `required()`**. Default `rejectUnauthorized` to `true` in code; set `false` explicitly in `.env.example` — secure by default, insecure by opt-in.                                                                                                    |
| `server/.env.example`                            | New`# --- OpenSearch projector ---` block, with a comment on the compose self-signed cert.                                                                                                                                                                                                                                            |
| `server/src/app.module.ts`                       | Add the projector config to`ConfigModule.forRoot({ load })`.                                                                                                                                                                                                                                                                          |
| `server/src/law-index/law-index.module.ts`       | Add`OpenSearchModule` to `imports`.                                                                                                                                                                                                                                                                                                 |
| [../database-design.md](../database-design.md) §3b | Correct`content_version` to `keyword`; note `document_type` holds raw Vietnamese (`"Nghị định"`), not slugs; record the icu-based v1 analyzers.                                                                                                                                                                              |

### Index definition

Per §3b, with three corrections verified against the live cluster and shipped schema:

- **`content_version` → `{"type":"keyword","index":false}`** — §3b says `long`, but the column stores a SHA-256 hex **string** (`document.schema.ts`).
- **`number_of_replicas: 0`** — single-node cluster; 1 replica leaves the index permanently `yellow`.
- **`index.highlight.max_analyzed_offset` raised** — the largest phụ lục is **993,902 chars**, just under Lucene's 1,000,000 default.

Aliases attached in the same `ensureIndex()` call: `legal-provisions-read` and `legal-provisions-write` (`is_write_index: true`) → `legal_provisions_v1`. **The app never references the concrete index name.**

### Projection rules (§3a)

1. `dieu` → one top-level doc, `_id = document_node.id`.
   - `khoan[]` nested array in `path` order; each entry's `text` = the Khoản's own text plus its Điểm's text joined.
   - `body` = the Điều's own text + every `khoan[].text`. **`heading` is deliberately excluded from `body`** — it is separately boosted (`heading^2, body^2`) in §3d, so folding it in would double-count it in BM25.
2. `phu_luc` + `content_class='normative'` → top-level doc, `khoan: []`, whole text as one `body` block.
3. `phu_luc` + `template` → skipped, counted (2 rows).
4. `phan`/`chuong`/`muc`/`tieu_muc` → never emitted.
5. Omit `heading`/`status`/`valid_to`/`effective_date` when null rather than sending `null`.

**Reuse, don't reinvent:** `DocumentNodeRepository.findAllNodes(documentId)` already returns `FlatNodeRow[]` ordered by ltree `path` — the projector's only node-read path. `DocumentRepository.getDb()` is the documented escape hatch for the one `document ⋈ issuing_body` metadata query.

**Do not reuse** `retrieve.service.ts`'s `enrichNodeWithFullText` — it prefixes `label + heading` onto every node's text, which is exactly what rule 1 must not do. The hierarchy is provably two levels (Khoản→Điều 100%, Điểm→Khoản 100%), so a `Map<parentId, rows[]>` grouping suffices; no recursion, and no need to extract `buildTreeFromFlatNodes`.

### Streaming and batching

Iterate **per document**, never loading 507K rows. Peak memory is one document's nodes (max 4,801 nodes / ~1 MB text).

- Document cursor: keyset-paginated on `document.id`, page size 200 — keyset is what makes `afterDocumentId` resumability work.
- Flush the bulk buffer at **500 docs or 5 MB, whichever first**. The byte cap exists solely for the ~1 MB phụ lục. Expect ~141 flushes.
- Write through the `legal-provisions-write` alias.
- One explicit `_refresh` at the end. Do **not** set `refresh_interval: -1` during backfill — a crash would leave the index permanently un-refreshing.

**Summary shape** follows `BatchUpdateSummary` (`law-index.service.ts`) and the `err instanceof Error ? err.message : String(err)` idiom, with two scale-forced departures: cap `errors` at 100 entries plus `errorsTruncated: boolean` (a cluster-wide failure would otherwise return a 70K-element body), and walk `response.body.items[]` for per-item bulk errors. A connection-level failure should throw rather than retry 3,040 documents against a dead cluster.

### Endpoints

| Method     | Path                | Purpose                                                                                                             |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PUT`    | `/index`          | Create index + attach aliases. Idempotent.                                                                          |
| `GET`    | `/status`         | Alias→index resolution, health,`docs.count` vs expected count from Postgres, drift. The reconciliation stand-in. |
| `POST`   | `/backfill`       | `{limit?, afterDocumentId?, documentIds?[]}`                                                                      |
| `POST`   | `/reproject`      | One document by`documentId` or `citation`                                                                       |
| `PATCH`  | `/aliases`        | Atomic blue/green swap (§3e)                                                                                       |
| `DELETE` | `/index/:version` | Drop a retired index; refuses if aliased                                                                            |
| `POST`   | `/search`         | §3d's query — multi_match + nested khoan with`inner_hits` + validity filters                                    |

**Orphan guard — a gap §3b does not cover.** `document_node.id` is `defaultRandom()` and `syncNodes()` does delete-and-reinsert, so node ids are regenerated on every content change. `reproject` must `_delete_by_query` on `document_id` **before** indexing, mirroring `syncNodes`'s own semantics. Without this, re-scraping a changed document orphans all its previously-indexed provisions. §3b's "idempotent by construction" claim holds for the retry case only, not the update case.

---

## Verification

```bash
# Phase 0 gate — must return 0
docker exec legal-agent-postgres psql -U legal_agent -d legal_agent -c \
  "SELECT count(*) FROM (SELECT document_id, path, node_type FROM document_node
   GROUP BY 1,2,3 HAVING count(*)>1) t;"

npm test -- document-node.parser        # parser regression
npm test -- provision.projection        # projection rules

# Plugin present after rebuild
docker exec legal-agent-opensearch bash -c \
  'curl -sku admin:$OPENSEARCH_INITIAL_ADMIN_PASSWORD https://localhost:9200/_cat/plugins?h=component' | grep icu

cd server && npm run build && npm run start:dev   # build FIRST — a failing build makes
                                                  # nest --watch serve the last good compile
curl -s -X PUT  http://localhost:3000/laws/index/opensearch/index
curl -s -X POST http://localhost:3000/laws/index/opensearch/backfill -H 'Content-Type: application/json' -d '{"limit":5}'
curl -s -X POST http://localhost:3000/laws/index/opensearch/backfill -H 'Content-Type: application/json' -d '{}'
# expect provisionsIndexed = 70497, warnings.templatePhuLucSkipped = 2, duplicatePaths = 0
curl -s http://localhost:3000/laws/index/opensearch/status     # drift = 0
```

Index health must be **green**, `pri=1 rep=0`.

Idempotency: `reproject` the same citation twice; `_count` must not move.

**Vietnamese query bodies must not go through git-bash `curl -d`** — it corrupts UTF-8 and OpenSearch returns `Invalid UTF-8 middle byte`. Use `POST /search` (part of why it is in v1) or PowerShell with an explicit UTF-8 byte body.

Blue/green rehearsal before it is ever needed: create `v2`, backfill with `limit`, `PATCH /aliases` to it, confirm `_alias/legal-provisions-read` moved, swap back, `DELETE` v2.

---

## Deferred (state in the module docblock)

- CDC / Debezium, `document_sync_state`, the reconciliation job. `GET /status` is the manual stand-in.
- Auto-reprojection inside `LawIndexService.syncDocument()` — a crawl must not fail because OpenSearch is down. ~6 lines later, matching the per-step `try/catch` already in that method.
- Vietnamese **word segmentation** — icu gives normalization/folding, not tokenization. Revisit if precision measurably hurts.
- Superseded-version handling — write the `valid_to IS NULL` predicate anyway so it is correct when history arrives.
- Everything from [../research/legal-ai-retrieval-landscape.md](../research/legal-ai-retrieval-landscape.md): hybrid retrieval, RRF, vectors, graph, reranking, citation verification.
