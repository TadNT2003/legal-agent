# Database design

**Status: mixed.** §1's Postgres schema is implemented for `issuing_body`/`document`/`document_node`/`document_reference` — migrations exist under `server/src/law-index/persistence/migrations/`, and [../docs/schema/legal-agent.dbml](schema/legal-agent.dbml) mirrors the actual shipped schema (treat that file, not the narrative code block below, as authoritative on exact current columns/types where they disagree — this section retains some proposal-stage detail, e.g. a separate `ordinal_suffix` column, that the implementation resolved differently). §3's OpenSearch projector is now also implemented (`server/src/law-index/opensearch/`) — see §3b/§3c below for the corrections made against the shipped code, and [../plan/opensearch-projector-plan.md](../plan/opensearch-projector-plan.md) for the build sequencing. `document_sync_state` (§1's last table) and everything in §2 (Neo4j) and §4 (the vector store) remain **proposal, not yet implemented**. This is the design reference for all four data stores — Postgres, OpenSearch, Neo4j, and a vector store (Qdrant/ChromaDB/ClickHouse, under evaluation) — kept in one place since they're meant to stay derivable from each other, not designed independently. See [../README.md](../README.md) for infra setup and the [CDC pipeline proposal](../README.md#cdc-pipeline-proposed) that's meant to keep them in sync.

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
  title, document_type,         -- luat / nghi_dinh / thong_tu / lenh_ctn / quyet_dinh_ctn / ...
  issuing_body_id FK,
  enacted_date, effective_date, expiry_date, gazette_published_date,
  status,                       -- document-level rollup of the 5 validity states
  is_consolidated,              -- true if this is a văn bản hợp nhất
  consolidates_document_id FK NULL,
  index_scope,                  -- 'full' | 'metadata_only' — gates OpenSearch/ChromaDB/Neo4j
                                 -- :Provision projection; defaults by document_type, overridable
                                 -- per-document (see §1a, tier-4 Lệnh/Quyết định CTN note)
  raw_source JSONB,             -- original ingested text/XML, kept for audit/re-parse
  content_version,              -- hash, bumped on any content change — drives CDC
  created_at, updated_at
)

document_node(                  -- ONE ROW PER STRUCTURAL UNIT — see rationale below; absent
                                 -- entirely for a document where index_scope = 'metadata_only'
  id, document_id FK, parent_id FK NULL,       -- self-referencing tree
  node_type,                    -- phan / chuong / muc / tieu_muc / dieu / khoan / diem / phu_luc
  content_class,                 -- normative | template — only meaningful for phu_luc, see §1a
  path ltree,                   -- e.g. 'chuong2.muc1.tieumuc1.dieu5.khoan2'
  ordinal, ordinal_suffix NULL,  -- suffix populated for bổ sung-inserted nodes, e.g. "5a"
  label,                        -- "Điều 5" / "Điều 5a" / "Phụ lục I"
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
  -- status includes 'not_applicable' for a metadata_only document's opensearch/chromadb/neo4j
  -- rows — marks the gap as intentional so reconciliation doesn't flag it as a sync failure
```

**Why `document_node` as one-row-per-unit is the key move:** the same structural row serves as the chunk boundary for ChromaDB, the source of a graph edge for Neo4j (via `document_reference`), and the unit indexed in OpenSearch. Modeling structure once removes the need for each projector to independently reinvent "what's a chunk" or "what's an entity boundary" by re-parsing a text blob.

`document_reference.reference_type` and `change_type` are designed to map directly onto the Neo4j relationship taxonomy in §2 — the CDC Neo4j projector should be close to a 1:1 translation of these rows into typed edges, not a separate interpretation of the text.

### 1a. Legal semantics baked into the Postgres model

A handful of rules from Luật Ban hành văn bản quy phạm pháp luật số 64/2025/QH15 and Nghị định 78/2025/NĐ-CP (see [vn-legal-document-structure.md](vn-legal-document-structure.md)) drive specific field/constraint choices, not just prose color:

- **`status` is a closed 5-state enum, not a boolean flag:** `chua_hieu_luc` (not yet effective), `con_hieu_luc` (in force), `tam_ngung_hieu_luc` (suspended — Điều 56 Luật 64/2025/QH15, either self-imposed by the issuing authority or ordered by a superior pending review), `het_hieu_luc_mot_phan` and `het_hieu_luc_toan_bo` (partially / fully expired — Điều 57). Each is tracked per-`document_node`, not just per-`document`, because expiry and suspension are explicitly allowed to apply to only part of a document (Điều 56 khoản 1, Điều 57 khoản 1).
- **`expiry_date` closes the document-level validity interval, and only full expiry closes it.** `effective_date` alone leaves the interval open-ended, which is what a point-in-time filter (`effective_date <= :as_of AND (expiry_date IS NULL OR expiry_date > :as_of)`) needs the other end for — `status` answers "in force *now*", not "in force *on date X*". Verified against live vbpl.vn: a `het_hieu_luc_mot_phan` document carries **no** "Ngày hết hiệu lực" (the document as a whole is still in force — only some provisions expired, which is `document_node`-level state, not document-level), and neither does a `ngung_hieu_luc` one (suspension is a temporary state, not an endpoint). So NULL means "still running" for every status except `het_hieu_luc`, where NULL instead means the upstream date is missing and should be flagged rather than read as an open interval.
- **`effective_date` has a legally-enforced minimum lead time from `enacted_date`**, checked at ingest rather than assumed: ≥45 days for văn bản issued by central-government bodies, ≥10 days for local-government văn bản, waivable only when the document went through thủ tục rút gọn (expedited procedure) — in which case it may take effect on the signing date itself, but must be published immediately (Điều 53 Luật 64/2025/QH15). A document whose `effective_date` violates this without a rút gọn flag is an ingestion/extraction error, not a valid state.
- **`valid_from` may legitimately precede `enacted_date`** (hiệu lực trở về trước / retroactive effect), but only for văn bản from central agencies or provincial HĐND/UBND — never for cấp huyện — and never to newly impose or increase legal liability for past conduct (Điều 55 Luật 64/2025/QH15). Worth a check constraint or ingest-time validation flag rather than silent trust of the source text.
- **`ordinal`/`label` need an alphabetic-suffix mode, not just integers:** when a văn bản sửa đổi, bổ sung inserts a new Điều/Khoản/Điểm between existing ones, the inserted node keeps the numeric position of its predecessor and appends the next Vietnamese-alphabet letter (e.g. a new Điều between 5 and 6 becomes "Điều 5a") rather than renumbering everything after it (Điều 69 khoản 4, Nghị định 78/2025/NĐ-CP). This is why `ordinal_suffix` is a separate column instead of overloading `ordinal` with non-integer values — it keeps `path`/ltree ordering and the numeric `ordinal` sort stable while still round-tripping the letter suffix for display and citation matching.
- **Đính chính (correction) is not an amendment and must not create a `MODIFIES` edge.** Nghị định 78/2025/NĐ-CP Điều 9 draws a hard line: đính chính fixes only sai sót về căn cứ ban hành, lỗi chính tả, or thể thức/kỹ thuật trình bày (wrong legal-basis citation, typos, formatting/drafting errors) and explicitly "không làm thay đổi nội dung" (does not change the substantive content) — it cannot touch thẩm quyền or nội dung. That's why `change_type = correction` is kept distinct from `replace/add/repeal/suspend`: a correction bumps `document_node.content_hash` (the text literally changed) but should not appear in an amendment-history traversal (§2b) or trigger the same downstream re-embedding priority as a substantive edit.
- **Only `document_node`-worthy content gets a row; the rest lives in `document.raw_source` only.** Grounded directly in primary text (rendered and read from the scanned originals at [vanban.chinhphu.vn/?pageid=27160&docid=213310](https://vanban.chinhphu.vn/?pageid=27160&docid=213310), since neither PDF has a text layer): **Điều 71, Nghị định 78/2025/NĐ-CP** ("Thể thức, kỹ thuật trình bày văn bản quy phạm pháp luật") defines thể thức as **thành phần chính** (khoản 2, 10 mandatory items a→k: Quốc hiệu+Tiêu ngữ, tên cơ quan ban hành, số/ký hiệu, địa danh, thời gian ban hành, tên loại+trích yếu, **nội dung văn bản**, chữ ký, dấu, nơi nhận) plus **thành phần bổ sung** (khoản 3, 4 optional items, of which **Phụ lục is item (a)** — sibling to độ-mật marking, soạn-thảo code, and contact info, not part of the mandatory core). Khoản 4/6 delegate the visual layout of all of this to **Phụ lục I** of the same decree.
  - **Quốc hiệu/Tiêu ngữ/tên cơ quan/số-ký hiệu/địa danh/thời gian** (Điều 71 khoản 2 a-đ) are constant boilerplate or already-captured metadata (`document.title`, `citation_id`, `issuing_body_id`, `enacted_date`) — **no dedicated field, stays in `raw_source` only.**
  - **Căn cứ ban hành** sits at a genuine boundary the primary source itself doesn't fully resolve: Phụ lục I §II.1(a) describes it as part of "Phần mở đầu" conceptually, but Phụ lục I §III item 1 gives its actual formatting rules under "Phần nội dung văn bản." Practically it doesn't matter which side of that line it's on — either way it's the "Căn cứ ..." preamble already named as the deterministic parse source for `IMPLEMENTS` edges in §2b, not a `document_node` row of its own.
  - **Nội dung văn bản** (Điều 71 khoản 2.g) is the `document_node` tree (Phần/Chương/.../Điều/Khoản/Điểm).
  - **Phụ lục** (Điều 71 khoản 3.a — optional) gets its own `document_node` row (`node_type = phu_luc`, parented directly under the document, `label` numbered with Roman numerals per Phụ lục I §III.3.a — "Phụ lục I", "Phụ lục II" — when a document has more than one). It's not decorative: per Điều 67 khoản 4, Nghị định 78/2025/NĐ-CP, a phụ lục can literally *be* the list of repealed/replaced provisions (a `document_reference`/`MODIFIES` source). `content_class` gates what happens downstream: `normative` (repeal/replacement lists, tables, danh mục/tiêu chuẩn content) flows into OpenSearch/Chroma/Neo4j through the same rollup rules as the rest of the tree; `template` (blank biểu mẫu forms) stops at Postgres — stored for completeness/audit, never indexed. That classification is a per-phụ lục ingest-time decision (heading heuristic — "Danh mục"/"Bảng" vs. "Mẫu số" — or an LLM flag), not a blanket rule. Separately, Phụ lục I §III.3(a) requires the *citing* Điều/Khoản to explicitly reference the phụ lục ("phải chỉ dẫn về Phụ lục đó") — that citing sentence (pattern: "... kèm theo Phụ lục [I|II|...]") is itself a deterministically parseable `document_reference` row linking the citing node to the phụ lục node, same extraction method as inline citations.
  - **Chữ ký/dấu/nơi nhận** (Điều 71 khoản 2 h-k) plus the optional độ-mật marking, soạn-thảo ký hiệu, and contact info (khoản 3 b-d) are discarded the same way as the opening boilerplate — provenance/administrative metadata with no retrieval value for a legal Q&A agent, kept only in `raw_source`. (Dấu chỉ độ mật — confidentiality marking — would matter if the corpus ever ingests non-public documents; out of scope while the corpus is public VBQPPL published on công báo.)
- **Not every `document_type` needs full-text projection to OpenSearch/ChromaDB/Neo4j — Lệnh, quyết định của Chủ tịch nước (tier 4, Điều 4 khoản 4, [laws/04-lenh-quyet-dinh-chu-tich-nuoc/](../laws/04-lenh-quyet-dinh-chu-tich-nuoc/README.md)) is the clearest candidate for metadata-only treatment.** Most of what's actually issued under this type — công bố luật/pháp lệnh (Điều 12, Điều 43), bổ nhiệm/miễn nhiệm, đặc xá, quốc tịch, khen thưởng, phong/thăng quân hàm — is individually-scoped văn bản áp dụng pháp luật (targets a specific person/case, not a general rule of conduct), even though Điều 4 keeps it inside the VBQPPL system on account of who issues it, not what it says. It's also a structurally poor fit regardless of that classification question: these are short administrative notices without real Phần/Chương/.../Điều/Khoản subdivision, so the Điều/Khoản-anchored rollup rules in §3a/§4 don't have much to anchor to. Mechanically, this is a single `document.index_scope = 'metadata_only'` flag (defaulted by `document_type`, overridable per-document) rather than a schema change in any of the three downstream stores: it just means no `document_node` rows get parsed for that document, so OpenSearch's Điều-rollup (§3a), the vector store's chunk rule (§4), and Neo4j's `:Provision` materialization (§2b) all naturally produce nothing — none of the three needs a new field or a special case of its own to honor it. What a metadata-only document still gets: a normal `document` row (citation_id, issuing_body_id, enacted_date, effective_date/công bố date — enough to answer "when was luật X promulgated"), a `(:Document)-[:HAS_TYPE]->(:DocumentType)` node in Neo4j (§2a, unaffected by content since it's document-level, not `:Provision`-level), and `document_sync_state` rows marked `not_applicable` for the opensearch/chromadb/neo4j targets so reconciliation doesn't treat the gap as a failure. Left genuinely open: whether a Lệnh công bố luật should still get a Neo4j edge to the law it promulgates — it isn't a content change (`MODIFIES`) or an operationalization (`IMPLEMENTS`), so it would need a new relationship type (e.g. `PROMULGATES`) if this ever gets built, not a reuse of §2b's existing three. The rare substantive exception (tổng động viên, tình trạng khẩn cấp — same Điều 4 khoản 4, genuine normative content) would still need full projection if one is ever issued, so `index_scope` should stay a per-document, content-aware check (similar in spirit to the phụ lục `content_class` gate above), not a blanket type-level filter that could silently drop something that matters. Not a final decision — flagging now so it isn't lost by the time the OpenSearch/ChromaDB/Neo4j projectors actually get built (see [README.md](../README.md) Sequencing); no tier-4 documents are downloaded yet, so there's nothing to retrofit.

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
     -- so it's kept distinct from MODIFIES. Deterministically extractable: "Căn cứ ban
     -- hành" is a formally named component of every VBQPPL's Phần mở đầu (Phụ lục I,
     -- Phần II, Nghị định 78/2025/NĐ-CP — see §1a), not free-form prose, so its legal-
     -- basis document list is parseable at ingest without an LLM, same as citation parsing.

(:Document)-[:CONSOLIDATES]->(:Document)
     -- văn bản hợp nhất → the original document it merges amendments into
```

**Which `document_node` rows become a `:Provision`:** materialization is selective, not 1:1 with Postgres — a node is only worth a graph presence if the graph traversal actually needs to land on it.

- `node_type = dieu` → **always** a `:Provision`. Điều is the default citable unit, so every Điều exists in the graph regardless of whether anything currently references it.
- `node_type = khoan` or `diem` → a `:Provision` **only if** it's the source or target of at least one `document_reference` row (i.e., something specifically cites/amends/repeals that sub-provision rather than its parent Điều). A Khoản that's never individually referenced stays Postgres/OpenSearch/ChromaDB-only — creating a graph node for it would just be a `PART_OF` edge to nothing else, pure bloat.
- `node_type = phu_luc` → same reference-driven rule as Khoản/Điểm, **not** the same rule as Phần/Chương/Mục/Tiểu mục below. A `content_class = normative` phụ lục that's the source of repeal/replacement `document_reference` rows (§1a, Điều 67 khoản 4 Nghị định 78/2025/NĐ-CP) becomes a `:Provision` — it's functionally the source of `MODIFIES` edges, same as an Điều would be. A `content_class = template` phụ lục (blank biểu mẫu) never does — nothing ever cites a form template.
- `node_type = phan / chuong / muc / tieu_muc` → **never** materialized. These are pure hierarchy containers — nothing in the citation/amendment graph ever targets "Chương 2" itself, only the Điều/Khoản inside it.

This is why the CDC Neo4j projector can't be a blind 1:1 row translation the way OpenSearch's is: it has to check `document_reference` before deciding whether a Khoản/Điểm write should upsert a `:Provision` at all, or just update the ancestor Điều's Postgres-side content and stop there.

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

OpenSearch is the BM25/lexical leg of retrieval, paired with the vector store's semantic leg (fused at the app level — see [../README.md](../README.md)). Like the vector store, the real workload is filter-heavy semantic-adjacent search (validity/date/document-type filters combined with full-text relevance), not pure keyword lookup, so the design below optimizes for that rather than for a generic "index everything" mirror of Postgres.

### 3a. Indexing unit: rolled up to Điều, with Khoản/Điểm nested — not one doc per `document_node` row

Resolving the earlier TBD: **one OpenSearch document per `document_node` where `node_type = dieu`**, with that Điều's Khoản (and their folded-in Điểm) embedded as a `nested` array inside the same document, not as separate top-level documents and not as a `join` parent/child relationship.

- **Why roll up to Điều instead of 1:1 per `document_node` row:** matches the rollup already decided in the Design principles above (§ "each downstream store applies its own rollup"). Indexing every Khoản/Điểm as its own tiny document hurts BM25 in a very concrete way — term/document-frequency statistics get computed over fragments a few sentences long, and a search hit surfaces an out-of-context Khoản instead of the Điều a legal reader actually wants to see and cite. Rolling up to Điều gives BM25 a properly-sized unit of text and a hit that's immediately readable/citable.
- **Why `nested`, not `join`, for the Khoản/Điểm sub-structure:** OpenSearch's own guidance is that `join` (parent/child as separate top-level docs) only pays off when children are very numerous per parent or updated far more often than the parent, because `join` carries real query-time cost (in-memory join list, slower joins than nested) precisely to buy cheaper independent child updates ([Join field type](https://docs.opensearch.org/latest/mappings/supported-field-types/join/)). Neither condition holds here: an Điều rarely has more than a handful to a few dozen Khoản, and amendments are infrequent, batch-like events (one CDC `document_changed` event re-renders the whole Điều from Postgres and re-indexes it) rather than a high-frequency independent-child-update workload. `nested` keeps Khoản/Điểm co-located with their Điều — which is what every real query needs anyway, since the citable/readable unit is the Điều — at the cost of reindexing the full Điều document on any child edit, a cost this write pattern can easily absorb.
- **Superseded/historical node versions are not indexed.** `document_node` keeps closed-out rows (`valid_to` set, per §1a's amendment-history model) for point-in-time reconstruction, but OpenSearch only ever holds the *current* row per Điều (`valid_to IS NULL`, or the row currently in effect). "What did Điều 5 say as of date X" is a point lookup against Postgres/Neo4j (§2b), not a relevance-ranked search — there's no BM25 reason to keep superseded text competing for search relevance against current law.

**Which `document_node` rows become what, in an OpenSearch document:** the rollup is a fixed structural role assignment by `node_type`, not conditional on references (Neo4j's rule) or on child presence alone (the vector store's rule) — every current-version node is used, just not all as top-level documents.

- `node_type = dieu` → **always** the top-level OpenSearch document (`_id = document_node.id`), current version only (`valid_to IS NULL`).
- `node_type = khoan` → **always** one entry in that Điều's `khoan` nested array — never its own top-level document, unlike Neo4j where a referenced Khoản gets a standalone `:Provision`.
- `node_type = diem` → **never** its own nested entry either. Điểm text is folded straight into its parent Khoản's `khoan.text` string, mirroring the vector store's rule (§4) — a), b), c) points aren't independently retrievable in search any more than they're independently embeddable.
- `node_type = phu_luc` with `content_class = normative` → indexed as its own **top-level document**, same tier as an Điều (not nested under one — a phụ lục isn't a child of any single Điều, it's a sibling attached to the whole document, per §1a). `content_class = template` → never indexed, matches Neo4j's rule for the same node type. Note: `khoan` stays an empty array on a phụ lục document — the current schema (§1a) doesn't give phụ lục its own internal Mục/Bảng sub-hierarchy the way an Điều has Khoản, so all of a normative phụ lục's text lands in `body` as one block. If a real phụ lục turns out to need finer-grained internal citation (e.g. citing "Phụ lục I, Bảng 2" specifically), that's a `document_node` modeling gap to close later, not something to paper over here.
- `node_type = phan / chuong / muc / tieu_muc` → **never** indexed as a document or nested entry, same as Neo4j and the vector store. Their `heading` is read once at render time (from the Postgres ancestor chain) only to help build the parent Điều's `heading`/breadcrumb display — it isn't a field OpenSearch stores or searches on its own.

The net effect: every Khoản is represented in both OpenSearch and the vector store unconditionally (per §4, chunking is always at Khoản granularity) — they just disagree on the *shape* of that representation. The vector store gives each Khoản a standalone embedding/point, because similarity search needs an independently-rankable unit. OpenSearch gives each Khoản a nested entry inside its parent Điều's document, because BM25 needs a properly-sized, directly-readable unit of text. Neo4j is the outlier: a Khoản only gets *any* graph representation at all when something actually references it — everywhere else, "does this Khoản exist as a queryable unit" doesn't depend on whether it's ever been cited.

### 3b. Field mapping

```text
PUT /legal-provisions-v1  (referenced only via the `legal-provisions-read`/`-write` aliases — see §3f)
{
  "mappings": {
    "properties": {
      "document_id":     { "type": "keyword" },
      "citation_id":     { "type": "keyword" },        -- e.g. "45/2019/QH14" — exact filter/lookup
      "document_type":   { "type": "keyword" },        -- raw Vietnamese as vbpl.vn reports it
                                                          -- (e.g. "Nghị định", "Thông tư"), not a
                                                          -- slug — mirrors document.document_type
      "issuing_body_id": { "type": "keyword" },
      "authority_rank":  { "type": "short" },           -- filter/sort, see §2a's 14-tier order

      "node_type":       { "type": "keyword" },         -- "dieu" | "phu_luc" — this index only ever
                                                          -- holds these two top-level node_types (§3a)
      "path":            { "type": "keyword" },         -- ltree path, mirrors document_node.path
      "label":           { "type": "keyword" },         -- "Điều 5" / "Điều 5a" / "Phụ lục I" — exact match
      "heading": {
        "type": "text", "analyzer": "vi_analyzer",
        "fields": { "folded": { "type": "text", "analyzer": "vi_folded" } }
      },
      "body": {                                         -- Điều's own text + all Khoản/Điểm concatenated
        "type": "text", "analyzer": "vi_analyzer", "term_vector": "with_positions_offsets",
        "fields": { "folded": { "type": "text", "analyzer": "vi_folded" } }
      },

      "khoan": {
        "type": "nested",
        "properties": {
          "khoan_id":  { "type": "keyword" },           -- document_node.id, for citing back precisely
          "label":     { "type": "keyword" },           -- "Khoản 2" / "Khoản 2a"
          "text": {
            "type": "text", "analyzer": "vi_analyzer", "term_vector": "with_positions_offsets",
            "fields": { "folded": { "type": "text", "analyzer": "vi_folded" } }
          },
          "status":     { "type": "keyword" },          -- per-Khoản validity, can differ from the Điều
          "valid_from": { "type": "date" },
          "valid_to":   { "type": "date" }
        }
      },

      "status":         { "type": "keyword" },          -- Điều-level rollup of the §1a 5-state enum
      "valid_from":     { "type": "date" },
      "valid_to":       { "type": "date" },
      "enacted_date":   { "type": "date" },
      "effective_date": { "type": "date" },

      "content_hash":    { "type": "keyword", "index": false },  -- sync-state bookkeeping only
      "content_version": { "type": "keyword", "index": false }  -- document.content_version is a
                                                                  -- SHA-256 hex string, not a long
    }
  }
}
```

Document `_id` is set to the Điều `document_node.id` directly — CDC upserts and status-flip updates are then idempotent by construction (write with the same `_id` twice is a no-op replace, no separate "does this doc already exist" lookup needed), matching the `document_sync_state` reconciliation design in [../README.md](../README.md#cdc-pipeline-proposed).

### 3c. Vietnamese analysis

**Status: implemented, but as `analysis-icu` v1, not the CocCoc-plugin design this section originally proposed** — see [../plan/opensearch-projector-plan.md](../plan/opensearch-projector-plan.md) §"Decisions taken" for why, and [../infrastructure/opensearch-vietnamese-analysis.md](../infrastructure/opensearch-vietnamese-analysis.md) for the full analysis of the tradeoff and a synonym-filter follow-up sketch.

Vietnamese is written space-delimited *between syllables*, not words — a standard/ICU tokenizer alone over-splits multi-syllable legal terms (e.g. "quy phạm pháp luật" is one compound term, not four independent tokens), which is a precision problem for legal search specifically (mis-segmented terms inflate false-positive matches). This section originally proposed a dedicated Vietnamese word-segmentation plugin ([opensearch-analysis-vietnamese](https://github.com/duydo/opensearch-analysis-vietnamese), CocCoc's C++ segmenter) to fix that — rejected for v1 because it has zero published releases against current OpenSearch and would need to be built from source, an ongoing maintenance burden not justified before there's a measured precision problem to fix. Shipped instead:

- **Primary analyzer (`vi_analyzer`):** `standard` tokenizer + `lowercase` — diacritic-sensitive, syllable-level (not word-level) tokenization. **Known limitation:** "quy phạm pháp luật" is 4 tokens, not 1 term — recall is unaffected, precision on multi-syllable legal terminology suffers, and IDF is computed over syllables. Positions are preserved, so `match_phrase` stays available as a later knob.
- **Fallback analyzer (`vi_folded`):** `standard` tokenizer + `icu_normalizer` char filter + `lowercase`/`icu_folding` filters (strips diacritics/tone marks after Unicode normalization) as a second analyzed subfield (`.folded`) on every text field. Vietnamese users frequently type without diacritics (mobile keyboards, quick queries); the primary field stays diacritic-sensitive for precision (legal terminology can hinge on exact diacritics), while `.folded` is queried as a lower-boosted fallback clause so diacritic-exact hits always outrank diacritic-stripped ones rather than the two being conflated into one scoring bucket.
- **Everything citation-shaped stays `keyword`, never analyzed:** `citation_id`, `label`, `path`, `document_type`, `issuing_body_id`. Citation matching in this domain is exact by nature (Điều 63 khoản 1, Nghị định 78/2025/NĐ-CP is either the provision cited or it isn't) — running these through a text analyzer would just introduce spurious fuzzy matches for values that are already unambiguous identifiers.

Both analyzer names are kept stable from the original proposal so a future word-segmenting plugin is a settings-only swap (reindex via the §3e blue/green path), not an application change.

### 3d. Query shape: filter-heavy, same pattern as the vector store

```json
GET /legal-provisions-read/_search
{
  "query": {
    "bool": {
      "must": [
        { "multi_match": {
            "query": "điều kiện hiệu lực trở về trước",
            "fields": ["heading^2", "body^2", "heading.folded", "body.folded"],
            "type": "most_fields"
        }},
        { "nested": {
            "path": "khoan",
            "query": { "multi_match": {
              "query": "điều kiện hiệu lực trở về trước",
              "fields": ["khoan.text", "khoan.text.folded"]
            }},
            "inner_hits": {}   -- returns which specific Khoản matched, for precise citation/highlighting
        }}
      ],
      "filter": [
        { "term":  { "status": "con_hieu_luc" } },
        { "range": { "valid_from": { "lte": "now" } } },
        { "bool": { "should": [
            { "bool": { "must_not": { "exists": { "field": "valid_to" } } } },
            { "range": { "valid_to": { "gt": "now" } } }
        ]}}
      ]
    }
  },
  "highlight": { "fields": { "body": {}, "heading": {} } }
}
```

Status/date/type/authority filters go in `filter`, not `must` — no score contribution needed for a hard validity constraint, and `filter` context is cacheable, same reasoning as the vector store's payload-filter design in §4. The `nested` clause with `inner_hits` is what lets a hit say "matched in Khoản 2", not just "matched somewhere in Điều 5" — important because the citation a user needs back is often the Khoản, not just the Điều.

### 3e. Index, shard, and alias strategy

- **Single index, few shards.** This is a bounded legal corpus (thousands to low tens-of-thousands of Điều-level documents), not log/time-series data — no rollover/ILM policy is needed, and over-sharding a corpus this size is a well-known OpenSearch anti-pattern (each shard has fixed overhead; more shards than the data and query concurrency justify just adds coordination cost). Start at 1 primary shard with replicas sized for read HA/throughput, and only split further if benchmarking on real query concurrency shows a need.
- **Applications read/write through aliases, never the concrete index name** (`legal-provisions-read` / `legal-provisions-write` pointing at, e.g., `legal-provisions-v1`). Mapping changes (a new field, an analyzer fix, a Vietnamese-plugin version bump) can't be applied in place to existing fields in OpenSearch, so the update path is: create `legal-provisions-v2` with the new mapping, reindex from Postgres (not from `-v1`, since Postgres is the source of truth), verify, then atomically repoint the aliases — a blue/green swap with zero read downtime ([Index aliases](https://docs.opensearch.org/latest/im-plugin/index-alias/)).

### 3f. Note: OpenSearch's native hybrid/RRF search pipeline doesn't apply here as-is

Worth flagging so it isn't mistaken for something already wired up: OpenSearch has a native hybrid-search path — a `hybrid` compound query plus a `normalization-processor` (min-max/L2 normalization + weighted combination) or, more recent, RRF via a `score-ranker-processor` ([Hybrid search](https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/index/), [Normalization](https://docs.opensearch.org/latest/search-plugins/search-pipelines/normalization-processor/)). But that machinery fuses multiple **query clauses against the same OpenSearch index** — in practice, a BM25 clause plus a clause against OpenSearch's own `knn_vector` field type. It does not fuse scores from an external service. Since this design's chosen vector store is a separate system (Qdrant, §4) rather than OpenSearch's `knn_vector` field, the README's app-level RRF fusion across OpenSearch + the vector store remains the right approach, not OpenSearch's native pipeline. If the vector-store decision in §4 were ever revisited toward storing embeddings in OpenSearch itself, native hybrid/RRF would become directly relevant — but that's a different, larger decision than this section's scope, not something to fold in here.

## 4. Vector store: Qdrant (recommended) vs. ChromaDB vs. ClickHouse

**Chunk granularity (applies to any backend):** one chunk per atomic legal statement — Khoản, or a bare Điều when it has no Khoản subdivision, with Điểm folded into their parent's chunk text rather than each being its own embedding (a), b), c) points are sub-conditions of one statement, not independent ones). Embedded text is prefixed with ancestor headings (Điều label/heading, Chương heading) so the vector carries structural context even though the citable unit stays at Khoản/Điều level. Metadata carries at minimum `document_id`, `citation_id`, `path`, `node_type`, `status`, `valid_from`/`valid_to` — enough to filter by validity/date before similarity search, and to cite back to the exact Điều/Khoản a chunk came from. Deterministic chunk IDs (`document_id:path`) so re-embedding on edit is idempotent. Embedding model must have genuine Vietnamese-language support, not just multilingual tokenization.

**Which `document_node` rows become a chunk:** unlike Neo4j's rule (which depends on whether a node is referenced by a relationship), vector-store inclusion is a **fixed structural rollup** — it depends only on `node_type` and whether the node has Khoản children, never on downstream references.

- `node_type = khoan` → **always** exactly one chunk.
- `node_type = dieu` **with no Khoản children** → the Điều itself becomes one chunk (there's no subdivision to chunk at instead).
- `node_type = dieu` **with Khoản children** → the Điều row itself is not separately embedded; its children are.
- `node_type = diem` → **never** its own chunk. Its text is folded into its parent Khoản's chunk text.
- `node_type = phu_luc` with `content_class = normative` → chunked the same way an Điều would be (one chunk if short/undivided, or split by its own internal Mục/Bảng structure if long — see §1a for why phụ lục carries real normative content). `content_class = template` → never chunked, same exclusion as Neo4j and OpenSearch.
- `node_type = phan / chuong / muc / tieu_muc` → **never** chunked directly — same as Neo4j — but unlike Neo4j, their `heading` isn't dropped: it's read back off the `document_node` ancestor chain at embed time and prefixed onto descendant chunks' embedded text, purely for retrieval context.

So the same Postgres `document_node` table drives three different rollup rules from three different criteria: OpenSearch rolls up to Điều/phụ lục with Khoản/Điểm nested inside (§3a), Neo4j depends on `document_reference` membership, and the vector store depends on `node_type` + child presence — each projector re-derives its own view from the same rows rather than one shared "chunk" concept being reused across stores.

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
