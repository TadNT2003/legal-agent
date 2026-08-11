# law-index: flagged documents log

**Status: manually maintained.** Nothing in `server/src/law-index/` writes to this file (or the CSV below) automatically — see [Not yet automated](#not-yet-automated). Every record here was found by ad-hoc SQL spot-checks after a reindex pass, not by an automated check.

**How the two files split:** this file is the issue narrative — what went wrong, root cause, fix, DB impact, open follow-up. **[`law-index-flagged-documents.csv`](law-index-flagged-documents.csv)** holds one row per affected document, tagged with the `section` number it belongs to below. Append to both (never overwrite) when a future pass finds something new.

CSV columns: `section` (matches `###` below) · `section_title` · `status` (`Resolved` / `Unresolved` / `Won't fix` / `Info — no action needed`) · `internal_id` (vbpl.vn's own doc id, where relevant) · `citation` (`document.citation_id`) · `title` · `enacted_date` · `validity_status` (standardized to the DB's `validity_status` enum: `con_hieu_luc` / `het_hieu_luc` / `het_hieu_luc_mot_phan` / `chua_co_hieu_luc` / `ngung_hieu_luc`, blank if unknown) · `validity_verified_date` (date the status was last confirmed live against vbpl.vn, blank if not explicitly re-verified) · `nodes_built` (`document_node` row count after the fix, where applicable) · `issue` · `resolution` · `notes` (asides that don't fit `issue`/`resolution`, e.g. a cross-reference to another section).

**Status legend**, used consistently in every table below:

| Symbol | Meaning |
| --- | --- |
| ✅ Resolved | Fixed and verified; nothing outstanding. |
| ✅ Resolved — note | Fixed for everything actionable; a specific, bounded remainder is deliberately not pursued further (a won't-fix decision, or a permanent limitation of the current approach) — see the note below the table. |
| ⚠️ Partially resolved | Some real fix has landed, but a defined part of the original scope is still open or unaudited. |
| ⚠️ Unresolved | No fix yet. |

**Current corpus-wide state, 2026-08-11:** 125 documents still carry a `dedupeOrdinal` uniqueness-backstop suffix (down from 591 at the start of the 2026-08-08 duplicate-path push, itself down from 636 at [§12](#12-duplicate-document_node-paths--phase-0-of-the-opensearch-projector-plan-three-distinct-causes)'s initial Phase 0 audit). Real `(document_id, path, node_type)` collisions have held at 0 throughout every pass — see [§17](#17-a-root-level-điềuchương-whose-ordinal-duplicates-an-existing-sibling-is-a-duplicatedre-attached-block-not-a-genuine-collision--partial-fix-for-the-nested-list-restart-bucket) for the current breakdown of what's left.

---

## At a glance

| # | Issue | Status | Docs | DB impact |
| --- | --- | --- | --- | --- |
| [1](#1-annex-content-dropped-by-footer-strip-logic) | Annex text after the signature block silently dropped | ✅ Resolved | 2 | `document_node` was missing annex content |
| [2](#2-điều-header-without-a-period--zero-nodes) | Điều header without a period → parser produced no structure | ✅ Resolved | 17 | `document_node` tree was entirely empty |
| [3](#3-attributes-tab-content-leaked-into-fulltext) | Attributes table scraped as document body on docs with no digitized text | ✅ Resolved | 8 (+653 backfilled) | `fullText` was corrupted; `original_document_urls` now populated corpus-wide |
| [4](#4-citation-collision-documents-silently-overwritten-or-permanently-blocked) | Shared/reused vbpl.vn citations overwrote or permanently blocked documents | ✅ Resolved — 70 won't-fix noted | 74 | `document` row silently overwritten, or never created |
| [5](#5-issuing_body-mis-attributed-to-the-drafting-ministry--a-vbplvn-data-quality-issue) | `issuing_body` attributed to the drafting ministry instead of the legally mandated issuer | ⚠️ Partially resolved — 4 tiers unaudited | 5 | `document.issuing_body` legally wrong for the 5 confirmed rows |
| [6](#6-tier-3-100-document-pass--three-pipeline-bugs) | Tier-3 100-doc pass surfaced 4 pipeline bugs (search `pageSize`, page-cache recovery, orphaned browser processes, a broken internal-id regex) | ✅ Resolved | 2 direct + corpus-wide reliability | `document_node` missing on 2 docs; ~7% of corpus silently missing `original_document_urls` |
| [7](#7-quoted-multi-khoản-replacement-text-mis-nested) | Quoted replacement text spanning multiple Khoản mis-nested as top-level siblings | ✅ Resolved — scope decision noted | 1 shape; corpus-wide scope folded into §12c | Collisions gone; full nested reconstruction deliberately not built |
| [8](#8-văn-bản-hợp-nhất-has-no-ngày-ban-hành--upsert-threw-instead-of-falling-back) | `upsertDocument` threw on any "Văn bản hợp nhất" document — no "Ngày ban hành" field | ✅ Resolved | 1 | Blocked ingestion for this document type entirely |
| [9](#9-cross-search-citation-dedup-silently-undercounted-the-tier-3-backfill) | A backfill script deduped search results by corrupted `citation`, silently dropping real documents | ✅ Resolved | 56 | No wrong data written, just missing rows |
| [10](#10-validitystatus-advanced-dropdown-500s-instead-of-400ing) | `crawl/search`'s `validityStatus` filter 500s instead of 400ing/succeeding | ⚠️ Unresolved | N/A (search-only) | None — blocks this one filter, worked around client-side |
| [11](#11-server-crashed-and-self-recovered-repeatedly-during-the-tier-5-pass) | Dev server died mid-batch and self-recovered (new PID) 6 times over ~2,000 docs — cause undiagnosed | ⚠️ Unresolved | 0 (every occurrence recovered cleanly on retry) | None directly; wasted retries, ~30–60s pause each time |
| [12](#12-duplicate-document_node-paths--phase-0-of-the-opensearch-projector-plan-three-distinct-causes) | Duplicate `document_node` paths — Phase 0 audit found 3 causes (repeated Phụ lục header, table data misread as Khoản, quoted-text numbering) | ✅ Resolved — residual noted | 636 originally scoped; see §17 for current total | Path uniqueness restored corpus-wide; tree shape correct for every confirmed cause |
| [13](#13-sanitizeordinalforltree-silently-stripped-the-vietnamese-letter-đ--a-repository-layer-bug-not-a-parser-one) | `sanitizeOrdinalForLtree` stripped `đ` instead of transliterating it | ✅ Resolved | 7 real collisions + 1,436 cosmetic-precision docs | 10 rows shared a path with an unrelated sibling; ~12,400 rows had imprecise (not wrong) paths |
| [14](#14-missing-indexes-on-document_nodedocument_reference-fk-columns-made-every-syncnodes-delete-an-ocorpus-size-operation) | No index on 5 FK columns made every `syncNodes()` delete an O(corpus size) scan | ✅ Resolved | 0 (performance only) | Delete time for a 1,636-node document: 3+ min → <9s |
| [15](#15-vbplvns-điều-khoản-được-sửa-đổi-bổ-sung-amendment-annotation-rendering-duplicates-and-reorders-khoản-content--a-5th-distinct-cause-of-the-12-symptom-found-via-the-opensearch-projector) | vbpl.vn's amendment-annotation rendering duplicates Khoản content in the scrape itself | ✅ Resolved | 221 | Backstop-suffix footprint dropped; scraped text no longer duplicated |
| [16](#16-some-documents-scraped-text-is-unicode-nfd-instead-of-nfc-silently-breaking-every-diacritic-pattern-match) | Some documents' scraped text is Unicode NFD instead of NFC, silently breaking diacritic pattern matches | ✅ Resolved | 171 (5.1% of corpus) | `document_node` tree now structurally correct; backstop count dropped 273→242 |
| [17](#17-a-root-level-điềuchương-whose-ordinal-duplicates-an-existing-sibling-is-a-duplicatedre-attached-block-not-a-genuine-collision--partial-fix-for-the-nested-list-restart-bucket) | Duplicated/re-attached content colliding with real structure — several sub-causes across 6 passes | ✅ Resolved — residual noted | 466 resolved across all passes (591→125) | Tree correct for every confirmed shape; residual is a handful of permanent no-signal duplicates (exact clauses documented below) |

---

## 1. Annex content dropped by footer-strip logic

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-07-30 |
| **Found** | First 50-document `document_node` reindex |
| **Docs affected** | 2 |
| **DB impact** | `document_node` tree was missing the annex text entirely |

**Root cause:** the parser's footer-stripping logic only resumed structured parsing on the literal word "Phụ lục". Annexes placed after the signature block under other labels (a QCVN technical standard, a "Biểu số" report form) were silently dropped in full.

**Fix:** generalized the footer-escape trigger (`ANNEX_RESTART_PATTERN`) to also recognize a re-stated Quốc hiệu header or a standalone "Biểu số/Mẫu số/QCVN/TCVN `<code>`" title line.

**Example:** `46/2026/TT-BXD` — a ~145KB QCVN annex went from 0% captured to 96%.

---

## 2. Điều header without a period → zero nodes

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-07-31 |
| **Found** | `document_node` backfill for all Luật/Bộ luật documents |
| **Docs affected** | 17 |
| **DB impact** | `document_node` tree was entirely empty despite the document having real, parseable structure |

**Root cause:** older "Luật sửa đổi, bổ sung" amendment laws (1962–2019 in this batch) write their Điều header without a period — bare `"Điều 1"`, `"Điều 1:"`, or `"Điều 1 <heading>"`. `DIEU_KHOAN_PATTERN` required a literal period, so none of these matched.

**Fix:** made the separator after the Điều number optional (`[.:]?` instead of mandatory `.`).

**Example:** `04/1998/QH10` — 0 nodes → 37 nodes built.

---

## 3. Attributes-tab content leaked into `fullText`

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-07-31; the related `original_document_urls` backfill also completed (2026-08-03, see §6) |
| **Found** | Luật/Bộ luật backfill; recurred in the tier-3 (Pháp lệnh) 100-doc batch |
| **Docs affected** | 8 direct; 653 corpus-wide for the related `original_document_urls` extension |
| **DB impact** | `document.rawSource.fullText` was corrupted (an attributes table instead of real body); `document_node` built on top of it was meaningless |

**Root cause:** these 8 documents have no "Nội dung" (full-text) tab on vbpl.vn at all — only a scanned "Văn bản gốc" file. `extractScopeTitleAndFullText()` read whichever tab pane was active, assuming Nội dung was always default-active; for these 8, Thuộc tính (attributes) was, so its table got captured as `fullText`.

**Fix:** the extractor now checks for `data-node-key="toan-van"` before trusting the active pane; absent that, `fullText` is stored as real `null` instead of the wrong pane's text. Repository code updated to treat `fullText === null` as a legitimately empty tree, not a parse failure.

**Extended scope:** since these documents have no digitized text, the scanned PDF behind "Văn bản gốc" became the only usable content — its download URL is now captured for every document (not just these 8) into a new `document.original_document_urls` column, built against a public MoJ-operated MinIO gateway. The corpus-wide backfill for this column hit its own reliability issues (see §6) but is now complete: 653/653 documents populated.

**Example:** `35/2002/QH10` — `fullText` was a 305-char attributes table, now `null`, with `original_document_urls` populated instead.

---

## 4. Citation collision: documents silently overwritten or permanently blocked

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-08-01 (tier 2), 2026-08-03 (tier 1); 70 of 74 confirmed documents are a deliberate won't-fix, noted below |
| **Found** | Rechecking vbpl.vn Luật/Bộ luật coverage against Postgres; recurred identically on tier 1 (Hiến pháp) |
| **Docs affected** | 74 — 70 tier 2 (Luật/Bộ luật/Nghị quyết), 4 tier 1 (Hiến pháp) |
| **DB impact** | A later "Không số" document's sync silently overwrote an earlier one's `document` row (title, dates, `raw_source`, cascaded `document_node` tree); 69 documents were structurally unable to ever be stored |

**Root cause:** `document.citation_id` is `UNIQUE`, and `upsertDocument` looked up "already synced?" purely by citation. Pre-Đổi Mới laws (1946–1997) mostly share the literal citation `"Không số"` ("no number") — dozens of distinct laws collide on it, plus 2 confirmed cases of vbpl.vn reusing a real citation across two different laws issued in the same batch.

**Fix — permanent mechanism in `upsertDocument`:** a re-sync of the same document is now recognized by `rawSource.sourceUrl`, not citation. A genuine collision against a document that is **not** `còn hiệu lực` is skipped, not overwritten (`{ documentId: null, skippedReason }`). A collision against a document that **is** `còn hiệu lực` is disambiguated by appending vbpl.vn's internal id (`"<citation> (vbpl-<id>)"`) and inserted as its own row.

**Won't-fix, 70 of 74 — considered resolved as of this scope, not tracked as open work.** All 70 (66 tier-2 + 4 tier-1) are confirmed `Hết hiệu lực toàn bộ` (fully expired), each superseded by a later law under a different citation. Loosening `citation_id UNIQUE` to reach them would need re-validating every citation-keyed lookup in the repository for content with no bearing on current law — not worth it for a fully enumerated, small, historical-only set (precedent: `server/src/law/` made the same call, commit `d441189`). Revisit only if scope ever grows to historical/repealed-law research.

**The other 4 of 74 were pulled out and fixed individually** rather than folded into the won't-fix set, since excluding live law is a correctness bug, not a scope call: 3 confirmed still `Còn hiệu lực` (in force), plus the original `"Không số"` occupant (`Luật Cải cách ruộng đất`) treated the same way for consistency.

**Example:** `Luật Cải cách ruộng đất` (1953) — renamed `Không số` → `Không số (vbpl-1105)`, resolved. `3-LCT/HĐNN7` (1981) — confirmed expired, won't-fix.

---

## 5. `issuing_body` mis-attributed to the drafting ministry — a vbpl.vn data-quality issue

| | |
| --- | --- |
| **Status** | ⚠️ Partially resolved — fixed for the 2 tiers found (2026-07-31); tiers 4–7 share the same risk shape and haven't been audited |
| **Found** | Postgres tier audit (Luật/Bộ luật); recurred in the tier-3 (Pháp lệnh) 100-document pass |
| **Docs affected** | 5 confirmed — 3 tier 2, 2 tier 3 |
| **DB impact** | `document.issuing_body` legally impossible for the 5 confirmed rows; the same corruption could be silently sitting in already-indexed tier 4–7 documents today, undetected |

**Root cause — a vbpl.vn data-quality issue, not a scrape bug.** vbpl.vn's own "Cơ quan ban hành" field sometimes reports the drafting/reviewing ministry instead of the body legally empowered to issue the document. Điều 4 of Luật 64/2025/QH15 restricts several tiers to exactly one issuing body regardless of drafter, so the wrong value is structurally detectable by document type — confirmed wrong on tier 2 (`Luật`/`Bộ luật`/`Nghị quyết` → must be Quốc hội) and tier 3 (`Pháp lệnh`/`Nghị quyết` → must be UBTVQH).

**Fix:** `correctQuocHoiIssuingBody` (`vbpl.parser.ts`), called from `parseAttributes`. `Luật`/`Bộ luật`/`Pháp lệnh` are corrected unconditionally (only one legal issuer exists for those types); ambiguous `Nghị quyết` is corrected only when its citation carries the issuing body's own numbering pattern. `computeContentVersion` now hashes `issuingBody` too, so the correction can't be silently swallowed by an otherwise-unchanged re-sync.

**Not yet audited — same single-mandated-issuer shape, may already be silently wrong in the DB:** tier 4 (Lệnh/Quyết định → Chủ tịch nước), tier 5 (Nghị định/Nghị quyết → Chính phủ), tier 6 (Quyết định → Thủ tướng Chính phủ), tier 7 (Nghị quyết → HĐTP TANDTC). Tiers 8–9 (Thông tư) legitimately vary per issuer, so this guard pattern doesn't directly transfer there.

**Example:** `149/2025/QH15` — corrected "Bộ Tài chính" → "Quốc hội". `11/2016/UBTVQH13` — corrected "Quốc hội" → "Uỷ ban Thường vụ Quốc hội".

---

## 6. Tier-3 100-document pass — three pipeline bugs

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-07-31; follow-up bugs found 2026-08-03 also resolved |
| **Found** | First 100 Pháp lệnh (tier 3) documents end to end; follow-ups surfaced re-attempting the §3 corpus-wide backfill |
| **Docs affected** | 2 direct data-loss cases; the internal-id fix alone protected ~7% of the corpus (48/653 docs) |
| **DB impact** | `document_node` silently missing on 2 docs; search results silently truncated; `original_document_urls` silently staying empty on real slug-URL/UUID-id docs |

Four bugs found in `server/src/law-index/crawl/`:

- **`pageSize` silently ignored** — `selectPageSize()` ran before the filtered search submitted, against the page's unfiltered default list. Fixed by reordering the calls.
- **Stuck/broken Playwright page had no recovery path** — one bad navigation degraded every subsequent request sharing the same cached page, surfacing as an escalating failure rate during the §3 corpus-wide backfill. Fixed with `resetPage()`/`withPageRetry()`: a failed navigation resets the browser/page and retries once before throwing.
- **2 documents lost their `document_node` tree** from the above bug mid-sync (`document`/`document_reference` rows persisted, node-build error swallowed). Re-synced (305/404 nodes respectively); a full corpus sweep found no other real-`fullText`-zero-node documents.
- **Re-attempting the §3 backfill hit an escalating (not stable) failure rate, traced to `main.ts` never calling `app.enableShutdownHooks()`** — every server restart orphaned its Chrome process instead of closing it, accumulating to 3.6GB and starving available memory. Fixed by adding the hook and cleaning up the orphans. Two more bugs found investigating this: `extractVbplInternalId` silently returned `null` for most real vbpl.vn URLs (rewritten to take the text after the URL's last `"--"`); and the "Văn bản gốc" tab renders in more than one DOM shape, which the original filename-scraping approach missed entirely for some documents (redesigned to capture the download URL directly off the network response instead).

**Outcome:** the `original_document_urls` backfill this pipeline blocked is now complete — 653/653 documents populated (see §3). Tier-1 (Hiến pháp, 2 docs) and tier-3 (Pháp lệnh, 415 docs) backfills both completed the same investigation window. Tier-5 (Nghị định + Nghị quyết Chính phủ, `còn hiệu lực` scope) completed 2026-08-05: 2,368/2,368 candidates synced, 0 failures — tier 4 (Lệnh, Quyết định của Chủ tịch nước) remains deliberately out of scope per `CLAUDE.md`.

---

## 7. Quoted multi-Khoản replacement text mis-nested

| | |
| --- | --- |
| **Status** | ✅ Resolved — scope decision noted. Collisions fixed via [§12c](#12-duplicate-document_node-paths--phase-0-of-the-opensearch-projector-plan-three-distinct-causes) (2026-08-08); full nested reconstruction was a deliberate non-goal, not a live gap |
| **Found** | 2026-07-31, investigating [§2](#2-điều-header-without-a-period--zero-nodes) |
| **Docs affected** | 1 originally confirmed (`61/2014/QH13`); corpus-wide scope (597 documents) found and fixed via §12c |
| **DB impact** | None remaining — quoted content is now suppressed to flat text on the citing node instead of spawning colliding top-level siblings |

**Root cause:** when an amending Điều quotes a foreign document's replacement text that itself spans multiple numbered Khoản, only the parser's leading-quote-mark signal distinguished "quoted" from "real structure" — every subsequent quoted line had no such marker, so each quoted Khoản/Điểm got inserted as a real top-level sibling of the amending Điều instead of nested inside the quote.

**Resolution:** §12c's suppression fix (quote-open/close tracking in `document-node.parser.ts`) eliminates the collision — quoted content is folded into flat text on the citing node rather than generating its own nodes. Building a correct nested sub-tree (a real `document_node` per quoted sub-clause) was deliberately not attempted: the quoted target document, once separately scraped, already carries that content as first-class nodes under its own tree, so per-clause reconstruction here was judged low-value for the cost/risk — see §12's "suppress, don't reconstruct" decision.

**Example:** `61/2014/QH13`, Điều 1 (a quoted replacement "Điều 8" containing Khoản 1–9) — clean, no collisions.

---

## 8. "Văn bản hợp nhất" has no "Ngày ban hành" — upsert threw instead of falling back

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-08-03 |
| **Found** | Tier-1 (Hiến pháp) pass, syncing `52/VBHN-VPQH` (the consolidated current Hiến pháp text) |
| **Docs affected** | 1 confirmed live; generalizable to any "Văn bản hợp nhất" document |
| **DB impact** | None — the throw happened before any write, so the failure was clean, just blocking |

**Root cause:** a "Văn bản hợp nhất" (consolidated text compiled by an office, not promulgated by a legislative body) has no "Ngày ban hành" row on its attributes tab — only "Ngày ký xác thực" (certification date). `document.enactedDate` is `NOT NULL`, and the repository's guard for a missing date was a plain uncaught `throw`, surfacing as a 500 with no domain-specific message.

**Fix:** `parseAttributes` now falls back to "Ngày ký xác thực" when "Ngày ban hành" is absent — a no-op for every other document type.

**Related, still unresolved (search-only, not a data-correctness issue):** `documentTypes=["Hiến pháp"]` reliably returns `total: 0` despite 6 real matching documents existing (worked around via direct sitemap URLs); `keyword`-based search returns the same fixed result set regardless of keyword content. Neither has been root-caused.

**Example:** `52/VBHN-VPQH` — synced successfully, `enactedDate` populated from "Ngày ký xác thực" (2025-07-21).

---

## 9. Cross-search citation dedup silently undercounted the tier-3 backfill

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-08-03 |
| **Found** | Investigating an apparent document-count regression after the tier-3 backfill (the regression itself was a red herring — see below) |
| **Docs affected** | 56 (54 Pháp lệnh + 2 Nghị quyết) |
| **DB impact** | None — no wrong data was written; these 56 documents were simply never attempted |

**Root cause:** the tier-3 backfill's candidate-list script merged two separate `documentTypes` search queries and deduplicated the merged list by `citation` — corrupted by the same mojibake bug noted in §4. Many genuinely distinct pre-1976 documents share the literal citation `"Không số"`, and the corrupted string collided across all of them in the dedup step, so only the first-seen survived the merge.

**Fix — methodological, not code:** re-ran candidate search per type (no cross-type merge), diffed each type's results against Postgres independently by `sourceUrl`. Now called out explicitly in `CLAUDE.md`'s law-index scraping runbook: never deduplicate `crawl/search` results by `citation` across multiple queries — dedupe (or diff against Postgres) by `sourceUrl` only.

**Example:** of the 54 recovered Pháp lệnh, 44 were additional `"Không số"` collisions correctly skipped by §4's mechanism; 10 were genuine new rows.

---

## 10. `validityStatus` advanced-dropdown 500s instead of 400ing

| | |
| --- | --- |
| **Status** | ⚠️ Unresolved |
| **Found** | Tier-5 (Nghị định + Nghị quyết Chính phủ) candidate discovery, trying to narrow the search to `còn hiệu lực` documents only |
| **Docs affected** | N/A — a `crawl/search` request bug, not a persistence bug; no `document` row is ever at risk |
| **DB impact** | None |

**Root cause:** `GET /laws/index/crawl/search?...&validityStatus=Còn hiệu lực` reliably returns a bare `{"statusCode":500,"message":"Internal server error"}`. In `VbplClientService.selectAdvancedDropdown` (`vbpl-client.service.ts:460-477`), the dropdown-opening click sits **outside** the function's own `try/catch` — only the subsequent option-click is guarded, converting a not-found *option* into a clean `BadRequestException`. If the click that opens the dropdown itself throws (e.g. a Playwright timeout/interception on the advanced panel not being fully settled), that raw error propagates uncaught all the way to Nest's default exception filter, which returns a generic 500 for any non-`HttpException` — the same class of bug as §8's `enactedDate` guard.

**Fix — not applied, worked around instead.** For the tier-5 pass, `validityStatus` was avoided entirely: fetched the full unfiltered `documentTypes` result set and filtered client-side on each item's `validityStatus` field using its corrupted-but-deterministic mojibake form (`'CÃ²n hiá»‡u lá»±c'` — see §4's mojibake note; the corruption is a consistent 1:1 transform, so exact-matching the corrupted string is reliable). A real fix would wrap `selectAdvancedDropdown`'s opening click the same way §8 wraps its `NOT NULL` guard — a try/catch around the whole function body, not just the second half — but this hasn't been done since the client-side workaround was sufficient for this pass.

---

## 11. Server crashed and self-recovered repeatedly during the tier-5 pass

| | |
| --- | --- |
| **Status** | ⚠️ Unresolved / undiagnosed |
| **Found** | Tier-5 backfill, batches of ~50 documents run back-to-back over roughly 2,000 documents |
| **Docs affected** | 0 — every occurrence was caught by the batch script (all 50 items in the affected chunk failed with `TypeError: fetch failed`) and fully recovered by retrying the same chunk once the server responded again; no partial writes, no data loss |
| **DB impact** | None directly — cost was operational (each occurrence paused the batch chain for roughly 30–60 seconds until the server came back) |

**Symptom:** 6 times across the ~2,000-document tier-5 pass, an entire in-flight batch of 50 `POST /laws/index/crawl/url` calls failed instantly and uniformly with `TypeError: fetch failed` (a client-side connection error, not an HTTP error response) — `curl http://localhost:3000/api` confirmed the port was unreachable (`000`) at the same moment. Within roughly 30 seconds to a couple of minutes, the server was reachable again on its own, under a **new PID** (confirmed via `netstat`), without any restart command issued by this session. Roughly one occurrence per ~300–400 documents processed, though not perfectly regular.

**Investigated and ruled out:** checked for the exact failure mode already documented in §6 (orphaned Playwright/Chromium processes from a missing `enableShutdownHooks()`, causing memory exhaustion) — found none: every `chrome.exe` process running at the time belonged to the machine's own interactive Chrome browser, not a headless Playwright-launched instance, and no non-Chrome-app Chromium process was found at all. `main.ts` already calls `enableShutdownHooks()` (the §6 fix). Free memory was not critically low at the times checked.

**Not diagnosed:** the actual crash cause is unknown. Nothing in this session started or supervised the dev server process directly enough to capture its stdout/stderr at the moment of failure, and the process kept self-recovering before a new capture could be attached. Whatever is restarting it (Nest's own `--watch` file-watcher doesn't restart on an uncaught crash by default, so something else — an external supervisor, a scheduled task, or manual intervention — is more likely) was never identified either.

**Mitigation applied:** none beyond retrying. The batch script already treats a fully-failed chunk as safe to blindly re-run (it only removes rows from its pending-CSV queue after a *successful* `changed`/`skippedReason` response), so no special handling was needed — just checking `curl .../api` before retrying.

**Follow-up, not attempted:** capture `stdout`/`stderr` to a persistent, rotating log file for the dev server (not deleted between passes) so the next occurrence can actually be diagnosed instead of just retried.

**Recurrence, 2026-08-05 (Phase 0 re-scrape, §12).** Happened again during a 20-document `PUT /crawl/batch?force=true` smoke test — new PID confirmed, 6/20 documents had completed before the request died silently. Investigated the same way and got the same answer: 32 `chrome.exe` processes running, but 0 headless — every one is the interactive browser, not an orphaned Playwright instance. Free memory was tight (3.3GB/27.9GB) but not exhausted. Notably this occurrence landed much sooner than the ~300–400-document interval observed during the original tier-5 pass — within the first 6 of a 20-document batch — which doesn't fit a purely load-triggered explanation either. Still unresolved; recovery (retry the un-processed remainder against the new PID) worked cleanly, no data loss.

---

## 12. Duplicate `document_node` paths — Phase 0 of the OpenSearch projector plan, three distinct causes

| | |
| --- | --- |
| **Status** | ✅ Resolved — residual noted. All three original causes (12a/12b/12c) fixed 2026-08-08; a uniqueness backstop covers everything else. Current corpus-wide total: see [§17](#17-a-root-level-điềuchương-whose-ordinal-duplicates-an-existing-sibling-is-a-duplicatedre-attached-block-not-a-genuine-collision--partial-fix-for-the-nested-list-restart-bucket) |
| **Found** | 2026-08-05, auditing `document_node` for `(document_id, path)` uniqueness ahead of the OpenSearch projector — [`../plan/opensearch-projector-plan.md`](../plan/opensearch-projector-plan.md) Phase 0 |
| **Docs affected** | 636 of 3,338 (19%) originally scoped across all three causes |
| **DB impact** | Uniqueness restored corpus-wide; tree shape now correct for every confirmed cause (12a/12b/12c and their broadened variants) |

Three distinct root causes, all now fixed:

- **12a — a repeated "Phụ lục N" running page-header mis-opened as a new sibling annex.** Every restatement of the header (once per subsection, not once per document) opened a fresh annex node at the same ordinal. **Fixed:** a repeated header matching the currently-open annex's ordinal folds into that annex's body text instead. Example: `22/2026/NQ-CP`, 21 duplicate nodes → 1.
- **12b — tabular/statistical data misread as Khoản numbering.** `KHOAN_PATTERN` matches any `<digits>.` line, which also matches thousands-separated table cells and decimal classification codes in land-use/tax-schedule statistics tables. **Fixed:** a recognized table-header line (`Đơn vị tính`, `Thứ tự`/`STT`, `Loại đất`, `Bậc`, and later a broader structural check — see [§17's 2026-08-11 update](#17-a-root-level-điềuchương-whose-ordinal-duplicates-an-existing-sibling-is-a-duplicatedre-attached-block-not-a-genuine-collision--partial-fix-for-the-nested-list-restart-bucket)) suppresses everything until the next real container heading. Example: `25/2007/NQ-CP`, 558 collisions → 0.
- **12c — quoted "sửa đổi ... như sau: `<text>`" replacement text carries its own independent numbering** (extends [§7](#7-quoted-multi-khoản-replacement-text-mis-nested)). Every quoted excerpt restarts its own numbering at 1, colliding with the amending document's real structure or with other quoted excerpts under the same parent. **Fixed:** a citing line ending in `:` followed by an opening quote (straight or curly) suppresses everything until the quote closes. Example: `12/2017/QH14`, 82 duplicate groups (worst: 99 copies) → 0.

**Backstop, still the permanent safety net for anything the above three don't catch:** `dedupeOrdinal` in `document-node.parser.ts` appends a counter suffix (`"1"` → `"1_2"`) to any node type that would collide with an existing sibling — `label` stays exactly as parsed, only the internal ordinal driving the ltree `path` changes. This is what every later section (§13–§17) builds on.

**Verification (2026-08-08):** 30/30 parser tests pass, corpus-wide gate (`(document_id, path, node_type)` duplicates) held at 0. Full backfill of all then-affected documents completed same day, backstop-suffixed document count 591 → 273 (refined further by §13–§17).

**This audit's spinoff findings became their own sections:** a repository-layer `đ`-stripping bug ([§13](#13-sanitizeordinalforltree-silently-stripped-the-vietnamese-letter-đ--a-repository-layer-bug-not-a-parser-one)), a missing-FK-index performance bug ([§14](#14-missing-indexes-on-document_nodedocument_reference-fk-columns-made-every-syncnodes-delete-an-ocorpus-size-operation)), vbpl.vn's own amendment-annotation DOM duplication ([§15](#15-vbplvns-điều-khoản-được-sửa-đổi-bổ-sung-amendment-annotation-rendering-duplicates-and-reorders-khoản-content--a-5th-distinct-cause-of-the-12-symptom-found-via-the-opensearch-projector)), an NFD/NFC Unicode mismatch ([§16](#16-some-documents-scraped-text-is-unicode-nfd-instead-of-nfc-silently-breaking-every-diacritic-pattern-match)), and the "nested-list-restart" bucket ([§17](#17-a-root-level-điềuchương-whose-ordinal-duplicates-an-existing-sibling-is-a-duplicatedre-attached-block-not-a-genuine-collision--partial-fix-for-the-nested-list-restart-bucket)).

**Related, still unresolved: concurrent `syncNodes()` calls for the same document can produce a fully duplicated tree — a database-layer race, not a parser bug.** `syncNodes()` does a plain `delete` followed by a recursive `insert` with no transaction wrapping the two and no lock against a second concurrent call for the same `documentId`. Confirmed live 3 times during this pass's backfill (`104/2026/NĐ-CP`, `31/2008/NQ-CP`, `29/NQ-CP` — each resolved individually by a single non-overlapping re-sync). No server-side fix applied — avoid overlapping `force=true` retries for the same document until this is closed with a lock or `ON CONFLICT`-safe upsert.

---

## 13. `sanitizeOrdinalForLtree` silently stripped the Vietnamese letter `đ` — a repository-layer bug, not a parser one

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-08-07 |
| **Found** | Auditing batch 2 of the §12 backfill — a document still showed duplicate paths after an isolated re-sync, ruling out §12's race-condition explanation |
| **Docs affected** | 7 with real path collisions; 1,436 with a cosmetic precision-only issue (no duplication) |
| **DB impact** | 10 rows across 7 documents shared a path with an unrelated sibling; ~12,400 rows had an imprecise (not wrong) path |

**Root cause:** `sanitizeOrdinalForLtree` stripped every character outside `[A-Za-z0-9_]`, including `đ` — a real, common Vietnamese ordinal letter that `document-node.parser.ts`'s own pattern accepts. This made `"146đ"` sanitize identically to `"146"`, colliding with the real "Điều 146".

**Fix:** transliterate `đ`/`Đ` → `"dd"` before stripping, rather than dropping it (not plain `"d"`, since a real `"d)"` and `"đ)"` are commonly adjacent siblings in the same list). Re-synced the 7 collision documents immediately, then the remaining 1,436 documents via a no-re-scrape-needed script reusing already-stored `fullText` (bare `đ` alone never causes a collision, so this population was never part of §12's original 636).

**Example:** `17/2017/QH14` — 14 duplicate `(path, node_type)` groups → 0.

---

## 14. Missing indexes on `document_node`/`document_reference` FK columns made every `syncNodes()` delete an O(corpus size) operation

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-08-07, migration `0007_add_missing_fk_indexes.sql` |
| **Found** | Running §13's re-sync — a single 1,636-node document's delete step was still running after 3+ minutes |
| **Docs affected** | None directly — performance only |
| **DB impact** | None — additive indexes only |

**Root cause:** 5 FK columns (`document_node.document_id`/`parent_id`/`superseded_by_node_id`, `document_reference.source_node_id`/`target_node_id`) had no supporting index. Every `syncNodes()` delete paid for both an unindexed `WHERE` lookup and Postgres's own per-row referential-integrity check — each a full sequential scan of a 507K-row table.

**Fix:** migration `0007` adds plain B-tree indexes on all five columns. Confirmed live: the same 1,636-node document dropped from 3+ minutes to under 9 seconds.

**Aside, still unresolved:** `drizzle-kit generate` is currently unusable for a clean diff due to pre-existing journal/snapshot drift found while adding this migration (this migration was hand-written and applied via `psql` instead) — worth fixing before the next schema change needs a generated migration.

---

## 15. vbpl.vn's "Điều khoản được sửa đổi, bổ sung" amendment-annotation rendering duplicates and reorders Khoản content — a 5th distinct cause of the §12 symptom, found via the OpenSearch projector

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-08-07 (shadow-DOM duplicate cards) + 2026-08-08 (dual-badge same-label bug) + 2026-08-11 (final residual re-scraped) |
| **Found** | Syncing Postgres → OpenSearch; the projector surfaced a Điều with a duplicated Khoản label, traced back to the raw scrape |
| **Docs affected** | 221 total (216 original + 5 more found via the 2nd bug) |
| **DB impact** | None beyond the existing `dedupeOrdinal` backstop while unfixed; the scraped text itself no longer duplicates post-fix |

**Root cause 1 — shadow-DOM duplicate cards.** vbpl.vn renders each amended-Khoản annotation as a card; some cards are duplicated into a "shadow" copy meant to stay hidden (`display: none` + a `parent-id` marker) but a competing CSS rule made it visible anyway — confirmed live, and confirmed not a scraper artifact (an ordinary browser shows the same duplicate). **Fix:** strip every `[parent-id]` element from the tab pane before reading text, so the duplicate is never captured.

**Root cause 2, found 2026-08-08 — dual-badge same-label collision.** Each card renders one badge per non-empty classification attribute (`type`/`new-types`); legitimate when the two resolve to different labels, but on the rare card where both resolve to the *same* label, it's a visible duplicate with no `parent-id` marker at all. **Fix:** dedupe sibling badge buttons within each card by their own rendered text.

**Re-sync:** all 221 documents re-scraped (this bug lives in what gets captured, not in already-stored text) — 0 errors throughout, including a final residual batch of 8 re-scraped 2026-08-11.

**Example:** `38/2005/QH11`, Điều 41 — Khoản 2 appeared twice and Khoản 1 was out of order; both artifacts gone post-fix.

---

## 16. Some documents' scraped text is Unicode NFD instead of NFC, silently breaking every diacritic pattern match

| | |
| --- | --- |
| **Status** | ✅ Resolved — 2026-08-08, fixed and all 171 affected documents re-synced same day |
| **Found** | Root-causing `368/2025/NĐ-CP` — a document whose collision showed an entire Điều's content absorbed into the previous one despite a perfectly normal-looking heading |
| **Docs affected** | 171 of 3,338 (5.1%) confirmed via `normalize(fullText, NFC) <> fullText`; only 38 had a visible collision — the rest had no detectable symptom at all |
| **DB impact** | Corpus-wide backstop-suffixed document count dropped 273 → 242; the other ~133 documents' fix isn't visible via that metric, only via the tree now being structurally correct |

**Root cause:** the parser's structural patterns are written as NFC (precomposed) Unicode literals. Some documents' scraped `fullText` is instead NFD (canonically-decomposed) — visually identical, but a different codepoint sequence, so an NFC-literal regex silently fails to match an NFD heading, with no error. **More severe than every other cause on this page:** it isn't self-limiting to a detectable collision — a document where the absorbed section's own numbering doesn't happen to overlap with what it merged into shows *zero* symptoms while still having a wrong tree, undetectable by this log's usual duplicate-path check. Skewed toward recent enactment years (~12% NFD for 2022–2026 vs. 5.2% corpus-wide), suggesting a CMS/authoring-pipeline change on vbpl.vn's side rather than legacy OCR.

**Fix:** a single `fullText.normalize('NFC')` call at the top of `parseDocumentBody()` — fixes both already-stored documents (re-parseable with no re-scrape) and any future scrape from one choke point. `document.raw_source.fullText` itself is left untouched (audit copy).

**Example:** `368/2025/NĐ-CP` — now has a correct `chuong1.dieu6` node that didn't exist pre-fix.

---

## 17. A root-level Điều/Chương whose ordinal duplicates an existing sibling is a duplicated/re-attached block, not a genuine collision — partial fix for the "nested-list-restart" bucket

| | |
| --- | --- |
| **Status** | ✅ Resolved for every confirmed shape — residual noted. 6 passes, 2026-08-08 through 2026-08-11 |
| **Found** | 2026-08-08, investigating the "nested-list-restart" bucket §12's 2026-08-07 update flagged as tentative (68 documents, 2 individually verified) |
| **Docs affected** | 466 of 591 backstop-suffixed documents resolved across all passes (591 → 125) |
| **DB impact** | Tree now structurally correct for every fixed shape; the small remainder is genuinely duplicated content with no distinguishing signal at all, or (1 confirmed document) a missing heading in vbpl.vn's own digitized text — see below |

**Root cause, several distinct shapes with the same structural signature.** Điều numbering is continuous and never restarts within one document (unlike Khoản, which restarts every Điều by design), so a root-level or document-wide Điều/Chương whose ordinal duplicates an existing sibling is never a legitimate second occurrence. Confirmed shapes, all fixed:

- **A short "ban hành" decree whose attached "QUY ĐỊNH"/"QUY CHẾ" restarts its own Điều numbering at 1**, or a document whose scraped text contains the entire document twice verbatim. **Fixed:** `wouldRestartAtRoot`/`openGenericAnnex` folds the duplicate into one flat annex node once a root-level ordinal collision is detected. Later broadened from root-only to document-wide after finding a document can duplicate just one inner Điều nested inside an otherwise-real Chương (`wouldRestartDocumentWide`).
- **An outer grouping level the parser had no representation for** — a single uppercase letter, or a roman numeral, period- or hyphen-separated (`"A. ..."`, `"I. ..."`, `"I- ..."`), used as a category heading above the normal Khoản list. **Fixed:** `GROUP_MARKER_PATTERN` recognizes the shape; everything after the first marker's own list is suppressed until the next container boundary.
- **Amendment-annotation-adjacent Khoản/Điểm collisions** — amendment content for a *different* Điều's topic gets linearized right after a real Điều's own Khoản/Điểm list, each correctly preceded by a genuine `"Điều khoản được sửa đổi, bổ sung"` annotation, colliding with the enclosing Điều's real numbering. **Fixed:** a Khoản/Điểm immediately following this annotation is checked against its current siblings and only suppressed if it would actually collide (`wouldCollideWithSibling`, shared across both node types).
- **Table-fragment and multi-target-quote refinements (2026-08-11):** `looksLikeTableFragment()` rejects a `KHOAN_PATTERN` match outright when the captured remainder is pure digits/periods/commas (a thousands-separator tail or decimal code) or the line contains a raw tab character — no header vocabulary needed at all, generalizing past §12b's original table-header-trigger approach. `citingQuoteActive` keeps quote-suppression sticky across an entire multi-target citing sentence ("...thành các điều 45, 45a và 45b như sau:" followed by 3 separate quoted blocks) instead of only the first target.
- **A source-data typo, corrected as text rather than taught to the parser:** one document closed §12c-style quotes with `''` (two apostrophes) instead of a real closing quote — per explicit direction, corrected via `fullText.replace(/''/g, '"')` alongside the existing NFC-normalization step, not a new quote-glyph case in the parser's matching logic.

**Verification:** 46/46 parser tests pass (progressively added across all passes), 529/529 full suite. Corpus-wide gate held at 0 throughout every re-sync; backstop-suffixed document count: 242 → 180 → 170 → 163 → 146 → 125 across the 6 passes.

**What's genuinely still open, confirmed live 2026-08-11 — two distinct remaining mechanisms:**

- **Real content duplicated with no recoverable signal at all** — the same ordinal reused a 2nd time for genuinely different content, with no annotation, heading, quote marker, or even a blank line distinguishing the two occurrences. Permanent backstop-only; not expected to ever be fixable by a line-based parser. Confirmed clauses: `117/2020/NĐ-CP` (Chương III, Điều 107, Khoản 3, Điểm b — two consecutive `"b)"` items with the amendment annotation misplaced after both, annotating the following `"c)"` instead); `168/2024/NĐ-CP` (Chương II, Mục 2, Điều 16, Khoản 2, Điểm đ — skips `"d)"`, reuses `"đ)"`; Mục 5, Điều 40, Khoản 3, Điểm c and Điểm đ — a garbled `a) b) c) đ) đ) c)` sequence); `02/2026/NĐ-CP` (Chương II, Điều 9, Khoản 1, Điểm d — reuses `"d)"` for two consecutive items instead of `"d)"` then `"đ)"`).
- **A more specific, different cause found the same day: vbpl.vn's own digitized text is missing an Điều heading entirely.** `02/2026/NĐ-CP`'s stored `fullText` jumps directly from "Điều 13" to "Điều 15" — Điều 14's real content is present but unlabeled, silently absorbed into Điều 13, and its own Khoản 1/2 collide with Điều 13's real Khoản 1/2 (Chương II, Điều 13, Khoản 1 and Khoản 2). Confirmed against the scanned original document, which does have Điều 14 — this is a vbpl.vn data-quality gap in their own "Nội dung" text, not a DOM-extraction bug, so there's no live-page re-scrape fix available. Architecturally different from every fix above: recovering it would mean synthesizing a node for a heading absent from the source rather than suppressing/reclassifying present content — not attempted, flagged for a scoping decision. Scope beyond this one document not yet surveyed.
- ~40 still-unclassified documents from the original 364-document audit ([§12](#12-duplicate-document_node-paths--phase-0-of-the-opensearch-projector-plan-three-distinct-causes)) and the §16-adjacent unclassified population remain un-investigated.

---

## Not yet automated

Every record above was found by ad-hoc SQL spot-checks (comparing `document.rawSource.fullText` length against total `document_node.text_content` length, then manually inspecting outliers) run by hand after each reindex pass — nothing in `server/src/law-index/` detects or records these automatically. For this log to stay current as new documents get synced, that detection needs to become a real step (a coverage-ratio check the sync flow runs and logs, or a periodic query against the corpus) rather than a habit of remembering to check.
