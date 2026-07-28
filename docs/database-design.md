# Database design

**Status: proposal, not yet implemented.** No migrations, index mappings, or collection configs exist in this repo yet. This is the design reference for all four data stores — Postgres, OpenSearch, Neo4j, and a vector store (Qdrant/ChromaDB/ClickHouse, under evaluation) — kept in one place since they're meant to stay derivable from each other, not designed independently. See [../README.md](../README.md) for infra setup and the [CDC pipeline proposal](../README.md#cdc-pipeline-proposed) that's meant to keep them in sync.

## Design principles

- **Postgres is the single structural source of truth.** The other three stores are derived read views, each holding a different *projection* of the same underlying content — not independent copies that happen to agree.
- **`document_node` (Postgres) is the single source of structural truth; each downstream store applies its own rollup over the same rows, rather than all sharing one identical unit.** ChromaDB chunks at the atomic-statement level (Khoản, or bare Điều when there's no Khoản subdivision, with Điểm folded into their parent). OpenSearch rolls up to Điều (better BM25 statistics, more readable hits). Neo4j materializes `:Provision` nodes for Điều always, and for Khoản/Điểm only when they're actually a source or target of a relationship. None of the three re-derive structure by re-parsing text — that's what actually prevents cross-store drift, not a shared node granularity.
- **Modeled for the Vietnamese legal system specifically** — document-type authority hierarchy, Phần/Chương/Mục/Tiểu mục/Điều/Khoản/Điểm structure (only Điều is mandatory; every other level is optional per Điều 63 khoản 1, Nghị định 78/2025/NĐ-CP), `{số}/{năm}/{loại}-{cơ quan}` citation format, per-node granular validity (a single Điều can be "hết hiệu lực một phần" while the rest of the law stands), and amendment-via-separate-document + văn bản hợp nhất consolidation practice. The underlying rules (validity states, effective-date lead times, retroactivity limits, same-authority amendment requirement, alpha-suffixed inserted-provision numbering, đính chính-vs-amendment distinction) are sourced from [vn-legal-document-structure.md](vn-legal-document-structure.md) — see §1a and §2b below for where each rule lands in the schema.

---

## 1. Postgres (relational — source of truth)

Legal documents split into a small, fixed **metadata envelope** (title, citation number, issuing body, dates, status) — a textbook relational fit — and a **hierarchical body** (Phần → Chương → Mục → Tiểu mục → Điều → Khoản → Điểm, per Điều 63 khoản 1, Nghị định 78/2025/NĐ-CP — every level except Điều is optional). Postgres handles that hierarchy natively via the `ltree` extension (label-path hierarchies, GiST-indexed ancestor/descendant queries) or a plain adjacency list + `WITH RECURSIVE`, so there's no need to reach for a document/graph DB just to hold the tree.

```text
issuing_body(
  id, name, name_en,
  authority_rank,               -- lower = higher authority, for precedence resolution
  scope,                        -- national | local
  parent_body_id FK NULL        -- e.g. a department under a ministry
)

document(
  id, citation_id UNIQUE,       -- e.g. "45/2019/QH14"
  title, document_type,         -- luat / nghi_dinh / thong_tu / ...
  issuing_body_id FK,
  enacted_date, effective_date, gazette_published_date,
  status,                       -- document-level rollup of the 5 validity states
  is_consolidated,              -- true if this is a văn bản hợp nhất
  consolidates_document_id FK NULL,
  raw_source JSONB,             -- original ingested text/XML, kept for audit/re-parse
  content_version,              -- hash, bumped on any content change — drives CDC
  created_at, updated_at
)

document_node(                  -- ONE ROW PER STRUCTURAL UNIT — see rationale below
  id, document_id FK, parent_id FK NULL,       -- self-referencing tree
  node_type,                    -- phan / chuong / muc / tieu_muc / dieu / khoan / diem
  path ltree,                   -- e.g. 'chuong2.muc1.tieumuc1.dieu5.khoan2'
  ordinal, ordinal_suffix NULL,  -- suffix populated for bổ sung-inserted nodes, e.g. "5a"
  label,                        -- "Điều 5" / "Điều 5a"
  heading, text_content, content_hash,
  status,                       -- per-node validity, one of the 5 states below — can
                                 -- differ from sibling nodes
  valid_from, valid_to,         -- amendment history: old row closed, new row opened
  superseded_by_node_id FK NULL
)

document_reference(             -- explicit citations, parsed deterministically at ingest
  id, source_node_id FK NULL, source_document_id FK NULL,
  target_document_id FK NULL, target_node_id FK NULL,
  reference_type,               -- cites / amends / repeals / supersedes_partially /
                                 -- consolidated_by / implements / defines_term / corrects
  change_type,                  -- NULL, or replace / add / repeal / suspend / correction
                                 -- — see §2 for replace/add/repeal/suspend, and §1a for
                                 -- why `correction` is its own value, not an amendment
  raw_citation_text,
  extraction_method,            -- deterministic (regex/parser) vs. llm (NER enrichment)
  confidence                    -- NULL for deterministic, set for llm-extracted
)

document_sync_state(document_id, target, synced_version, status, last_error, updated_at)
  -- target ∈ {opensearch, chromadb, neo4j}
```

**Why `document_node` as one-row-per-unit is the key move:** the same structural row serves as the chunk boundary for ChromaDB, the source of a graph edge for Neo4j (via `document_reference`), and the unit indexed in OpenSearch. Modeling structure once removes the need for each projector to independently reinvent "what's a chunk" or "what's an entity boundary" by re-parsing a text blob.

`document_reference.reference_type` and `change_type` are designed to map directly onto the Neo4j relationship taxonomy in §2 — the CDC Neo4j projector should be close to a 1:1 translation of these rows into typed edges, not a separate interpretation of the text.

### 1a. Legal semantics baked into the Postgres model

A handful of rules from Luật Ban hành văn bản quy phạm pháp luật số 64/2025/QH15 and Nghị định 78/2025/NĐ-CP (see [vn-legal-document-structure.md](vn-legal-document-structure.md)) drive specific field/constraint choices, not just prose color:

- **`status` is a closed 5-state enum, not a boolean flag:** `chua_hieu_luc` (not yet effective), `con_hieu_luc` (in force), `tam_ngung_hieu_luc` (suspended — Điều 56 Luật 64/2025/QH15, either self-imposed by the issuing authority or ordered by a superior pending review), `het_hieu_luc_mot_phan` and `het_hieu_luc_toan_bo` (partially / fully expired — Điều 57). Each is tracked per-`document_node`, not just per-`document`, because expiry and suspension are explicitly allowed to apply to only part of a document (Điều 56 khoản 1, Điều 57 khoản 1).
- **`effective_date` has a legally-enforced minimum lead time from `enacted_date`**, checked at ingest rather than assumed: ≥45 days for văn bản issued by central-government bodies, ≥10 days for local-government văn bản, waivable only when the document went through thủ tục rút gọn (expedited procedure) — in which case it may take effect on the signing date itself, but must be published immediately (Điều 53 Luật 64/2025/QH15). A document whose `effective_date` violates this without a rút gọn flag is an ingestion/extraction error, not a valid state.
- **`valid_from` may legitimately precede `enacted_date`** (hiệu lực trở về trước / retroactive effect), but only for văn bản from central agencies or provincial HĐND/UBND — never for cấp huyện — and never to newly impose or increase legal liability for past conduct (Điều 55 Luật 64/2025/QH15). Worth a check constraint or ingest-time validation flag rather than silent trust of the source text.
- **`ordinal`/`label` need an alphabetic-suffix mode, not just integers:** when a văn bản sửa đổi, bổ sung inserts a new Điều/Khoản/Điểm between existing ones, the inserted node keeps the numeric position of its predecessor and appends the next Vietnamese-alphabet letter (e.g. a new Điều between 5 and 6 becomes "Điều 5a") rather than renumbering everything after it (Điều 69 khoản 4, Nghị định 78/2025/NĐ-CP). This is why `ordinal_suffix` is a separate column instead of overloading `ordinal` with non-integer values — it keeps `path`/ltree ordering and the numeric `ordinal` sort stable while still round-tripping the letter suffix for display and citation matching.
- **Đính chính (correction) is not an amendment and must not create a `MODIFIES` edge.** Nghị định 78/2025/NĐ-CP Điều 9 draws a hard line: đính chính fixes only sai sót về căn cứ ban hành, lỗi chính tả, or thể thức/kỹ thuật trình bày (wrong legal-basis citation, typos, formatting/drafting errors) and explicitly "không làm thay đổi nội dung" (does not change the substantive content) — it cannot touch thẩm quyền or nội dung. That's why `change_type = correction` is kept distinct from `replace/add/repeal/suspend`: a correction bumps `document_node.content_hash` (the text literally changed) but should not appear in an amendment-history traversal (§2b) or trigger the same downstream re-embedding priority as a substantive edit.

---

## 2. Neo4j (graph — hierarchy & relationships between legislation)

Two genuinely different kinds of "hierarchy" get asked about here, and they need different modeling:

### 2a. Authority hierarchy (categorical, not per-document)

"Nghị định must rank below Luật" is a rule about *document types*, established once by Luật Ban hành văn bản quy phạm pháp luật — not a fact you learn by linking specific documents to each other. Modeling it as pairwise edges between every document instance would mean an edge explosion (O(n²)) for a fact that's actually just a fixed total order over ~14 categories, per Điều 4 Luật số 64/2025/QH15:

```
1.  Hiến pháp
2.  Bộ luật, luật, nghị quyết của Quốc hội
3.  Pháp lệnh, nghị quyết của UBTVQH; nghị quyết liên tịch UBTVQH–Đoàn Chủ tịch UBTƯMTTQVN;
    nghị quyết liên tịch UBTVQH, Chính phủ–Đoàn Chủ tịch UBTƯMTTQVN
4.  Lệnh, quyết định của Chủ tịch nước
5.  Nghị định, nghị quyết của Chính phủ; nghị quyết liên tịch Chính phủ–Đoàn Chủ tịch UBTƯMTTQVN
6.  Quyết định của Thủ tướng Chính phủ
7.  Nghị quyết của Hội đồng Thẩm phán TANDTC
8.  Thông tư của Chánh án TANDTC / Viện trưởng VKSNDTC / Bộ trưởng, Thủ trưởng cơ quan ngang Bộ /
    Tổng Kiểm toán nhà nước
9.  Thông tư liên tịch giữa Chánh án TANDTC, Viện trưởng VKSNDTC, Tổng Kiểm toán nhà nước,
    Bộ trưởng, Thủ trưởng cơ quan ngang Bộ
10. Nghị quyết của HĐND cấp tỉnh
11. Quyết định của UBND cấp tỉnh
12. Văn bản QPPL của chính quyền địa phương ở đơn vị hành chính – kinh tế đặc biệt
13. Nghị quyết của HĐND cấp huyện
14. Quyết định của UBND cấp huyện
```

So: a small **reference dataset**, not per-instance edges. `authority_rank` is this list's 1–14 position, and ties within a rank (e.g. luật vs. nghị quyết of Quốc hội, both rank 2) are same-authority, not orderable against each other by rank alone — see the `MODIFIES` validation rule below, which needs same-issuing-body, not just same-or-better rank, to actually hold.

```
(:DocumentType {code, name, authority_rank})   -- ~10 fixed nodes, rarely changes
(:Document)-[:HAS_TYPE]->(:DocumentType)
```

Precedence between any two documents is then a property comparison in a Cypher query (`WHERE a.authority_rank < b.authority_rank`), not a graph traversal — cheap, and it can't drift out of sync the way a hand-maintained edge per document pair could.

### 2b. Instance-to-instance relationships (the "extend or invalidate" part)

These are real edges, because they're facts about *specific* documents/provisions, usually targeting a specific Điều/Khoản rather than a whole document:

```
(:Document {citation_id, title, status, authority_rank})
(:Provision {node_key, path, label, status, valid_from, valid_to})
     -- node_key = e.g. "45/2019/QH14#dieu5.khoan2" — mirrors Postgres document_node.path

(:Provision)-[:PART_OF]->(:Document)
(:Provision)-[:PART_OF]->(:Provision)        -- parent provision, mirrors the ltree path

(:Document|:Provision)-[:MODIFIES {change_type, effective_date}]->(:Document|:Provision)
     -- change_type: replace | add | repeal | suspend
     -- covers sửa đổi (replace/add), bổ sung (add), bãi bỏ (repeal), ngưng hiệu lực (suspend)
     -- ONE relationship type + a property, instead of 4 separate relationship types —
     -- keeps traversal queries ("show me everything that ever modified Điều 5") simple

(:Provision)-[:CITES]->(:Document|:Provision)
     -- informational reference only — does NOT change the target's validity

(:Document)-[:IMPLEMENTS]->(:Document)
     -- Nghị định/Thông tư operationalizing a Luật — does not change the target's text,
     -- so it's kept distinct from MODIFIES. Deterministically extractable: Vietnamese
     -- legal documents open with a "Căn cứ ..." preamble literally listing their legal
     -- basis documents — parseable at ingest without an LLM, same as citation parsing.

(:Document)-[:CONSOLIDATES]->(:Document)
     -- văn bản hợp nhất → the original document it merges amendments into
```

**Why `MODIFIES` is one relationship type with a `change_type` property, not four separate types:** the common query pattern is "what's the full amendment history of this provision" — one relationship type keeps that a single-hop traversal (`MATCH (p:Provision)<-[m:MODIFIES]-(source) RETURN source, m.change_type, m.effective_date ORDER BY m.effective_date`) instead of a UNION across four relationship types.

**Validation rule tying 2a and 2b together:** the actual legal rule is stricter than "equal-or-higher rank" — a `MODIFIES` (or a repeal) edge should only exist where the source document was issued by the **same issuing body/person with authority** (chính cơ quan, người có thẩm quyền) as the target document, per the "Sửa đổi, bổ sung, thay thế, bãi bỏ..." rule in Luật số 64/2025/QH15 (see [vn-legal-document-structure.md](vn-legal-document-structure.md)) — narrow statutory exceptions aside, a document cannot amend another merely because it outranks it; only the body that issued the original (or a luật/nghị quyết of Quốc hội overriding that default) can amend or repeal it. This is a useful ingestion-time sanity check: if extraction produces a `MODIFIES`/repeal edge where `source.issuing_body_id != target.issuing_body_id` (outside the statutory exceptions), it's either a data error or was actually an `IMPLEMENTS` relationship misclassified (guidance documents often use amendment-sounding language without legally amending the text). `authority_rank` comparison is still the right check for a *separate* question — flagging potential conflicts between independently-issued documents (see the third example query below) — just not for validating `MODIFIES` itself.

**Temporal queries** combine `MODIFIES.effective_date` with `Provision.valid_from/valid_to` (mirrored from Postgres) to answer "what did Điều 5 say, and what amendments existed, as of date X" — the graph doesn't need to duplicate full text history since Postgres already owns that; it just needs the edges and dates to reconstruct the timeline.

**Example traversals this shape enables:**

```cypher
// Full amendment chain of a specific provision
MATCH (p:Provision {node_key: '45/2019/QH14#dieu5'})<-[m:MODIFIES]-(source)
RETURN source.citation_id, m.change_type, m.effective_date
ORDER BY m.effective_date

// Implementing guidance chain for a Luật (Luật → Nghị định → Thông tư)
MATCH (l:Document {citation_id: '45/2019/QH14'})<-[:IMPLEMENTS*1..3]-(guidance)
RETURN guidance.citation_id, guidance.title

// Lower-authority documents that might conflict with a given Luật
MATCH (l:Document {citation_id: '45/2019/QH14'})-[:HAS_TYPE]->(lt:DocumentType)
MATCH (other:Document)-[:HAS_TYPE]->(ot:DocumentType)
WHERE ot.authority_rank > lt.authority_rank
  AND (other)-[:CITES|MODIFIES]->(l)
RETURN other.citation_id, ot.authority_rank
```

---

## 3. OpenSearch (search index)

**Status: not yet designed in detail.** One document per `document_node` (or possibly per `document` with nested `document_node` fields — TBD), indexed with a Vietnamese-aware analyzer (ICU tokenizer or a dedicated Vietnamese analysis plugin — the default English analyzer is wrong for this content). Content should mirror Postgres exactly; no transformation logic beyond field mapping.

## 4. Vector store: Qdrant (recommended) vs. ChromaDB vs. ClickHouse

**Chunk granularity (applies to any backend):** one chunk per atomic legal statement — Khoản, or a bare Điều when it has no Khoản subdivision, with Điểm folded into their parent's chunk text rather than each being its own embedding (a), b), c) points are sub-conditions of one statement, not independent ones). Embedded text is prefixed with ancestor headings (Điều label/heading, Chương heading) so the vector carries structural context even though the citable unit stays at Khoản/Điều level. Metadata carries at minimum `document_id`, `citation_id`, `path`, `node_type`, `status`, `valid_from`/`valid_to` — enough to filter by validity/date before similarity search, and to cite back to the exact Điều/Khoản a chunk came from. Deterministic chunk IDs (`document_id:path`) so re-embedding on edit is idempotent. Embedding model must have genuine Vietnamese-language support, not just multilingual tokenization.

### 4a. Qdrant (recommended default among dedicated vector services)

Purpose-built vector DB (Rust, Apache 2.0), point-based storage (vector + payload) with native instant per-point `upsert`/`delete` by ID — matches the chunk-diffing sync design directly, same as Chroma, with none of ClickHouse's `ReplacingMergeTree` rework.

**Why it's the better fit than Chroma specifically for this schema:** almost every real query here is semantic search filtered by structured metadata (`status`, `valid_from`/`valid_to`, `document_type`, `authority_rank`) — this workload is filter-heavy, not pure top-k similarity. Qdrant applies payload filters *during* HNSW graph traversal rather than as a post-filter step, which avoids the classic ANN+filter tradeoff (over-fetch-then-discard, or degraded recall) that a post-filtering approach hits under strict filters. Chroma's metadata filtering works but is a narrower expression language without filter-aware traversal.

Other advantages over Chroma: built-in quantization (scalar/product/binary) for memory efficiency as the corpus grows; a more mature clustering/sharding story if this needs to scale past one node; native sparse-vector + hybrid dense/sparse search with fusion in one query — architecturally relevant given RRF fusion is already part of this design (currently planned as app-level fusion across OpenSearch + the vector store), though not a reason to lean on it over OpenSearch's more mature BM25 engine at this stage. Ecosystem support (LangChain/LlamaIndex) is comparable to Chroma's, not a downgrade.

### 4b. ChromaDB (simpler alternative)

Purpose-built vector DB, native per-vector CRUD (`upsert`/`delete` by ID are instant, not async), first-class LangChain/LlamaIndex integration, HNSW ANN under the hood. Matches the sync design directly: diff `content_hash` per chunk, upsert what changed, delete what's gone — no extra modeling needed. Marginally simpler to configure than Qdrant for a pure prototyping stage, but weaker at combining vector search with rich structured filtering and less mature at large-scale distributed operation than either Qdrant or ClickHouse.

### 4c. ClickHouse (alternative — worth piloting given the team already operates it)

Vectors as an `Array(Float32)` column on a normal table, ANN via ClickHouse's `vector_similarity` index (HNSW-based, comparatively new — validate recall/latency against real data before committing), combined with arbitrary SQL `WHERE` filters and joins against other ClickHouse-resident data in one query. Strong case for consolidation: zero new service, reuses existing ops/monitoring, and the metadata-heavy filtering this schema needs (`status`, `effective_date`, `authority_rank`) is exactly ClickHouse's strength.

**The friction point:** `MergeTree` tables are append-optimized; there's no native instant per-row upsert/delete the way Chroma has. The chunk-diffing sync design (upsert changed chunks, delete removed ones) has to be remodeled around `ReplacingMergeTree` — insert a new version row per change, let background merges collapse by key, query with `FINAL` or an explicit "latest version" pattern to avoid seeing stale duplicates between merges:

```sql
CREATE TABLE document_chunk_embeddings
(
    chunk_id      String,             -- deterministic: document_id:path
    document_id   String,
    citation_id   String,
    path          String,
    node_type     String,
    status        String,
    valid_from    Date,
    valid_to      Nullable(Date),
    content_hash  String,             -- drives re-embed diffing, same role as in Chroma's design
    embedding     Array(Float32),
    version       UInt64,             -- bumped on every write; ReplacingMergeTree keeps the latest
    is_deleted    UInt8 DEFAULT 0     -- soft-delete: ClickHouse deletes aren't instant either
)
ENGINE = ReplacingMergeTree(version)
ORDER BY chunk_id;

-- ANN index (syntax evolves fast across ClickHouse versions — verify against the version deployed)
ALTER TABLE document_chunk_embeddings
    ADD INDEX embedding_idx embedding TYPE vector_similarity('hnsw', 'cosineDistance') GRANULARITY 1;
```

Retrieval combines the ANN search with the same structured filters `document_node.status`/`valid_from`/`valid_to` already carry, in one query:

```sql
SELECT chunk_id, document_id, path, cosineDistance(embedding, {query_vec}) AS score
FROM document_chunk_embeddings FINAL
WHERE is_deleted = 0
  AND status = 'con_hieu_luc'
  AND valid_from <= today()
  AND (valid_to IS NULL OR valid_to > today())
ORDER BY score ASC
LIMIT 10;
```

Physical deletes are handled as a periodic batched cleanup (`DELETE FROM ... WHERE is_deleted = 1 AND updated_at < now() - INTERVAL ...`, a ClickHouse "lightweight delete" mutation) rather than Chroma's immediate per-ID delete.

### Overall recommendation

Pilot before deciding, but the framing is: **Qdrant vs. Chroma** is a "which dedicated vector service" question (Qdrant wins on filter-heavy queries and CRUD-friendly sync, at no real cost vs. Chroma), while **ClickHouse** is a separate "consolidate onto existing infra" question with a real operational upside (zero new service, reuses the team's existing ClickHouse footprint) traded against genuine update-model friction (`ReplacingMergeTree` + `FINAL` instead of native upsert/delete). Benchmark ANN recall/latency for whichever candidates are in play on a representative slice of real chunks, and if ClickHouse is one of them, specifically prove out the update pattern against the actual amendment-driven sync frequency before committing — that's the part that doesn't just work out of the box the way it does on Qdrant or Chroma. If ClickHouse also ends up covering OpenSearch's role (it has an experimental full-text/BM25 index too), that's a separate, larger evaluation — its full-text engine is far less mature than OpenSearch's Lucene-based one, so don't bundle that decision with this one.
