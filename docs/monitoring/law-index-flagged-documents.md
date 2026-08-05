# law-index: flagged documents log

**Status: manually maintained.** Nothing in `server/src/law-index/` writes to this file (or the CSV below) automatically — see [Not yet automated](#not-yet-automated). Every record here was found by ad-hoc SQL spot-checks after a reindex pass, not by an automated check.

**How the two files split:** this file is the issue narrative — what went wrong, root cause, fix, DB impact, open follow-up. **[`law-index-flagged-documents.csv`](law-index-flagged-documents.csv)** holds one row per affected document, tagged with the `section` number it belongs to below. Append to both (never overwrite) when a future pass finds something new.

CSV columns: `section` (matches `###` below) · `section_title` · `status` (`Resolved` / `Unresolved` / `Won't fix` / `Info — no action needed`) · `internal_id` (vbpl.vn's own doc id, where relevant) · `citation` (`document.citation_id`) · `title` · `enacted_date` · `validity_status` (standardized to the DB's `validity_status` enum: `con_hieu_luc` / `het_hieu_luc` / `het_hieu_luc_mot_phan` / `chua_co_hieu_luc` / `ngung_hieu_luc`, blank if unknown) · `validity_verified_date` (date the status was last confirmed live against vbpl.vn, blank if not explicitly re-verified) · `nodes_built` (`document_node` row count after the fix, where applicable) · `issue` · `resolution` · `notes` (asides that don't fit `issue`/`resolution`, e.g. a cross-reference to another section).

---

## At a glance

| #                                                                                        | Issue                                                                                                                                                                                                                                                                               | Status                                              | Docs                                                                            | DB impact                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [1](#1-annex-content-dropped-by-footer-strip-logic)                                       | Annex text after the signature block silently dropped                                                                                                                                                                                                                               | ✅ Resolved                                         | 2                                                                               | `document_node` missing annex content                                                                                       |
| [2](#2-điều-header-without-a-period--zero-nodes)                                        | Điều header without a period → parser produced no structure                                                                                                                                                                                                                      | ✅ Resolved                                         | 17                                                                              | `document_node` tree entirely empty                                                                                         |
| [3](#3-attributes-tab-content-leaked-into-fulltext)                                       | Attributes table scraped as document body on docs with no digitized text                                                                                                                                                                                                            | ✅ Resolved                                         | 8 (+653 backfilled)                                                             | `document.rawSource.fullText` corrupted; `document.original_document_urls`                                                |
| [4](#4-citation-collision-documents-silently-overwritten-or-permanently-blocked)          | Shared/reused vbpl.vn citations overwrite or permanently block documents                                                                                                                                                                                                            | 🟡 Mixed — 4 Resolved, 66 Won't fix                | 70                                                                              | `document` row silently overwritten, or row never created                                                                   |
| [5](#5-issuing_body-mis-attributed-to-the-drafting-ministry--a-vbplvn-data-quality-issue) | `issuing_body` attributed to the drafting ministry instead of the one legally mandated issuer — a vbpl.vn data-quality issue, confirmed on 2 tiers, same shape likely affects more                                                                                               | ✅ Resolved (2 tiers) — ⚠️ other tiers unaudited | 5 confirmed                                                                     | `document.issuing_body` legally wrong; same defect shape may exist undetected on other tiers                                |
| [6](#6-tier-3-100-document-pass--three-pipeline-bugs)                                     | Tier-3 100-doc pass:`pageSize` ignored, page cache had no recovery, 2 docs lost their node tree — plus a 2026-08-03 follow-up (orphaned browser processes from a missing shutdown hook, a broken internal-id regex, an unhandled DOM shape) found re-attempting the §3 backfill | ✅ Resolved                                         | 2 direct + corpus-wide reliability; internal-id bug alone affected ~48/653 docs | `document_node` missing on 2 docs; search truncated; `original_document_urls` silently staying empty on ~7% of the corpus |
| [7](#7-quoted-multi-khoản-replacement-text-mis-nested)                                   | Quoted replacement text spanning multiple Khoản gets mis-nested as top-level siblings                                                                                                                                                                                              | ⚠️ Unresolved                                     | 1 confirmed                                                                     | `document_node` tree shape wrong (extra/misplaced nodes, no data loss)                                                      |
| [8](#8-văn-bản-hợp-nhất-has-no-ngày-ban-hành--upsert-threw-instead-of-falling-back) | `upsertDocument` threw on any "Văn bản hợp nhất" (consolidated-text) document — no "Ngày ban hành" field on vbpl.vn's own attributes tab                                                                                                                                   | ✅ Resolved                                         | 1 confirmed (tier-1 pass)                                                       | Blocked ingestion entirely for this document type until fixed — no partial/corrupt data written                              |
| [9](#9-cross-search-citation-dedup-silently-undercounted-the-tier-3-backfill) | An ad-hoc backfill script deduplicated live search results across two `documentTypes` queries by `citation` — corrupted text per §4's mojibake bug — silently dropping real distinct documents that happened to share a colliding corrupted citation | ✅ Resolved | 56 (54 Pháp lệnh + 2 Nghị quyết) | The tier-3 backfill this log called "complete" in §8 was actually short 56 rows; no wrong data written, just missing rows |
| [10](#10-validitystatus-advanced-dropdown-500s-instead-of-400ing) | `crawl/search`'s `validityStatus` filter 500s instead of a clean 400/success — a real Playwright click sits outside `selectAdvancedDropdown`'s try/catch | ⚠️ Unresolved | N/A (search-only, no doc data affected) | None — blocks the `validityStatus` filter only, worked around client-side |
| [11](#11-server-crashed-and-self-recovered-repeatedly-during-the-tier-5-pass) | The dev server died mid-batch and came back on its own (new PID) 6 times across a ~2,000-document tier-5 pass — cause undiagnosed, no accessible crash log | ⚠️ Unresolved / undiagnosed | 0 — every occurrence recovered cleanly on retry, no data loss | None directly; wasted retries and paused the batch chain each time (~30–60s) |

---

## 1. Annex content dropped by footer-strip logic

|                         |                                                        |
| ----------------------- | ------------------------------------------------------ |
| **Status**        | ✅ Resolved — 2026-07-30                              |
| **Found**         | First 50-document`document_node` reindex             |
| **Docs affected** | 2 (`section=1` in CSV)                               |
| **DB impact**     | `document_node` tree missing the annex text entirely |

**Root cause:** the parser's footer-stripping logic only resumed structured parsing on the literal word "Phụ lục". Annexes placed after the signature block with other labels (a QCVN technical standard, a "Biểu số" report form) were silently dropped in full.

**Fix:** generalized the footer-escape trigger (`ANNEX_RESTART_PATTERN` in `document-node.parser.ts`) to also recognize a re-stated Quốc hiệu header or a standalone "Biểu số/Mẫu số/QCVN/TCVN `<code>`" title line. Regression tests added; both documents' trees rebuilt from stored `fullText`.

**Example:** `46/2026/TT-BXD` — QCVN annex (~145KB) went from 0% captured to 96%.

---

## 2. Điều header without a period → zero nodes

|                         |                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Resolved — 2026-07-31                                                                   |
| **Found**         | `document_node` backfill for all Luật/Bộ luật documents                                |
| **Docs affected** | 17 (`section=2` in CSV)                                                                   |
| **DB impact**     | `document_node` tree entirely empty despite the document having real, parseable structure |

**Root cause:** older "Luật sửa đổi, bổ sung" amendment laws (1962–2019 in this batch) write their Điều header without a period — bare `"Điều 1"`, `"Điều 1:"`, or `"Điều 1 <heading>"`. `DIEU_KHOAN_PATTERN` required a literal period, so none of these matched.

**Fix:** made the separator after the Điều number optional (`[.:]?` instead of mandatory `.`). Regression tests added for all three punctuation variants; all 17 documents' trees rebuilt.

**Example:** `04/1998/QH10` — 0 nodes → 37 nodes built.

**Known follow-up:** `61/2014/QH13`'s tree now builds (177 nodes) but has a separate, unresolved shape defect — see [§7](#7-quoted-multi-khoản-replacement-text-mis-nested).

---

## 3. Attributes-tab content leaked into `fullText`

|                         |                                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Resolved — 2026-07-31 (a related backfill is still pending, see below)                                                                                     |
| **Found**         | Same Luật/Bộ luật backfill; recurred identically in the tier-3 (Pháp lệnh) 100-doc batch                                                                  |
| **Docs affected** | 8 (`section=3` in CSV) + 498 pending a related backfill (see below)                                                                                          |
| **DB impact**     | `document.rawSource.fullText` corrupted (305–440 chars of attributes-table text instead of real body); `document_node` build was meaningless on top of it |

**Root cause:** none of these 8 documents has a "Nội dung" (full-text) tab on vbpl.vn at all — confirmed live — only Thuộc tính / Lược đồ / Văn bản gốc / Tải về. vbpl.vn has no digitized body for them; the only source is a scanned file behind "Văn bản gốc". `extractScopeTitleAndFullText()` read whichever tab pane was `.ant-tabs-tabpane-active` unconditionally, assuming Nội dung was always the default-active tab — but for these 8, Thuộc tính was, so its table got captured as `fullText`. 100% deterministic (all 8 re-synced independently and reproduced identically), not a timing flake.

**Fix:** `extractScopeTitleAndFullText()` now checks for a tab with `data-node-key="toan-van"` before trusting the active pane; if absent, `fullText` is stored as real `null` instead of the wrong pane's text. `document.repository.ts` (`computeContentVersion`) and `document-node.repository.ts` (`syncNodes`) updated to treat `fullText === null` as a legitimately empty tree, not a parse failure. All 8 re-synced and verified (`fullText` is genuine JSON `null` via `jsonb_typeof`).

**Extended scope — original scanned document link now captured:** since these documents have no digitized text, the scanned PDF behind "Văn bản gốc" is the only usable content. That link exists for *every* document (not just these 8) and is now captured: `VbplClientService.fetchDocument()` loads a 4th tab (`?tabs=hien-thi-pdf`) and extracts filenames from the DOM; `buildOriginalDocumentUrl()` (`vbpl.parser.ts`) constructs the download URL against a public, unauthenticated MoJ-operated MinIO gateway (`.../api/qtdc/public/doc/minio/buckets/vbpl/{internalId}/{filename}/download`) — verified live across 3 filename styles. New `document.original_document_urls` column (`text[]`, migration `0004_cloudy_warhawk.sql`), folded into `computeContentVersion`'s hash so it also triggers a re-write on re-sync.

**⚠️ Pending backfill (not a new bug — scope, not correctness):** a corpus-wide re-sync of all 653 already-indexed documents to populate `original_document_urls` was started and manually stopped at 207/653 (18.7% and climbing failure rate) — the new 4th tab load was markedly less reliable than the original 3 (this is the same page-cache resilience gap fixed in [§6](#6-tier-3-100-document-pass--three-pipeline-bugs)). The **498 still-pending documents are tracked in [`law-index-pending-original-doc-resync.csv`](law-index-pending-original-doc-resync.csv)**, self-correcting on re-generation (`WHERE original_document_urls = '{}'`). The resilience fix in §6 should let a re-attempt complete, but it has not been re-run as of this writing.

**Example:** `35/2002/QH10` — `fullText` was a 305-char attributes table, now `null`. `106/2016/QH13` — confirmed `fullText: null` with `original_document_urls` correctly populated alongside it.

---

## 4. Citation collision: documents silently overwritten or permanently blocked

|                         |                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | 🟡 Mixed — 2026-08-01: 4 Resolved, 66 Won't fix (tier 2); 2026-08-03: 4 more Won't fix (tier 1)                                                                                                                                |
| **Found**         | Rechecking vbpl.vn Luật/Bộ luật coverage against Postgres — a 74-document gap (70 Luật + 4 Bộ luật); recurred identically in the tier-1 (Hiến pháp) pass                                                               |
| **Docs affected** | 74 (`section=4` in CSV) — 70 tier 2 (Luật/Bộ luật) + 4 tier 1 (historical Hiến pháp)                                                                                                                                    |
| **DB impact**     | A later "Không số" document's sync silently overwrote an earlier one's`document` row (title, dates, `raw_source`, cascaded `document_node` tree, all replaced); 69 documents were structurally unable to ever be stored |

**Root cause:** `document.citation_id` is `UNIQUE`, and `upsertDocument` looked up "already synced?" purely by matching `citation_id`. Two ways vbpl.vn's older (pre-1998) corpus breaks that assumption:

- **"Không số" ("no number")** — every pre-Đổi Mới law is recorded under the literal citation string "Không số". 67 distinct real laws (1959–1997) share it; only whichever synced *last* survives.
- **Reused batch instrument numbers** — at least 2 cases where vbpl.vn assigned the same citation to two different laws passed in the same batch (`270B-NQ/HĐNN8`, `3-LCT/HĐNN7`).

**Decision — 66 confirmed "Hết hiệu lực toàn bộ" (fully expired): Won't fix, out of scope.** Rationale: (1) direct precedent — `server/src/law/` made the same call for the same pattern (commit `d441189`); (2) the real fix (loosening `citation_id UNIQUE`) would need re-validating every citation-keyed lookup in `document.repository.ts` for content with no bearing on current law; (3) it's a small, fully enumerated, documented boundary — revisit only if scope ever grows to historical/repealed-law research.

**3 documents turned out to still be "Còn hiệu lực" (in force)** — pulled out and fixed individually rather than accepted into the won't-fix decision, since excluding live law is a correctness bug, not a scope call. The original "Không số" occupant (`Luật Cải cách ruộng đất`) got the same treatment for consistency.

**Fix — now a permanent mechanism in `upsertDocument`, not a one-off:**

- A document is recognized as a re-sync of *itself* by matching `rawSource.sourceUrl`, not citation (citation alone can't disambiguate two "Không số" documents).
- A genuine collision against a document that is **not** "còn hiệu lực": skipped, not overwritten (`{ documentId: null, skippedReason }`).
- A genuine collision against a document that **is** "còn hiệu lực": disambiguated by appending vbpl.vn's internal id — `"<citation> (vbpl-<id>)"` — and inserted as its own row.

**Methodology note:** an unrelated mojibake bug in the crawl-search response (UTF-8 decoded as Windows-1252 somewhere in `VbplClientService.searchDocuments`) produced ~20 false "missing" entries in the first diff pass. Re-diffed using the ASCII-only internal id instead. Worth fixing separately in `vbpl.parser.ts`'s search-response handling — flagged here only because it caused a second investigation pass, not because it caused any actual indexing failure.

**Example:** `Luật Cải cách ruộng đất` (1953, id 1105) — renamed `Không số` → `Không số (vbpl-1105)`, resolved. `3-LCT/HĐNN7` (1981) — blocked by `Luật Tổ chức Tòa án nhân dân`'s identical citation, confirmed expired, won't fix.

**2026-08-03 — same mechanism hit tier 1 (Hiến pháp), 4 more Won't fix.** All 6 of vbpl.vn's Hiến pháp-typed documents (1946/1959/1980/1992/1992-sửa-đổi-2001, plus the current consolidated `52/VBHN-VPQH`, which has its own citation and isn't affected) share the literal "Không số" citation — same pre-numbering-era pattern as tier 2. `Hiến pháp năm 1946` happened to sync first and holds the slot; the other 4 are all confirmed `Hết hiệu lực toàn bộ` (each superseded by the next), so the same won't-fix rationale applies without a separate decision. Unlike tier 2's 66, this set is small enough (4 documents, the entire population) that it's worth naming explicitly rather than leaving implicit: `Hiến pháp năm 1959` (id 889, hết hiệu lực 1980-12-19), `Hiến pháp năm 1980` (id 1534, hết hiệu lực 1992-04-15), `Hiến pháp năm 1992` (id 11234, hết hiệu lực 2014-01-01), `Hiến pháp năm 1992 (sửa đổi, bổ sung năm 2001)` (id 22313, hết hiệu lực 2014-01-01) — none currently retrievable from Postgres by this pass; only reachable today via vbpl.vn directly.

---

## 5. `issuing_body` mis-attributed to the drafting ministry — a vbpl.vn data-quality issue

|                         |                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Resolved for the 2 tiers found — 2026-07-31. ⚠️ Same-shape risk on other tiers not yet audited (see below)                                                              |
| **Found**         | Postgres tier audit (tier 2: Luật/Bộ luật); extended after the same pattern turned up in the tier-3 (Pháp lệnh) 100-document pass                                        |
| **Docs affected** | 5 confirmed (`section=5` in CSV) — 3 tier 2 (Luật/Bộ luật), 2 tier 3 (Pháp lệnh)                                                                                      |
| **DB impact**     | `document.issuing_body` legally impossible for the 5 confirmed rows; the same corruption could be silently sitting in already-indexed tier 4–7 documents today, undetected |

**Root cause — this is a vbpl.vn data-quality issue, not a law-index scrape bug.** vbpl.vn's own "Cơ quan ban hành" field sometimes reports the drafting/reviewing ministry instead of the body legally empowered to issue the document (confirmed live in every case found so far). Điều 4 of Luật 64/2025/QH15 restricts several document tiers to exactly *one* issuing body regardless of which ministry drafted the text — so the wrong value is always structurally detectable for those tiers by checking document type against Điều 4, independent of content. Confirmed wrong so far on tier 2 (`Luật`/`Bộ luật`/`Nghị quyết` → must be Quốc hội) and tier 3 (`Pháp lệnh`/`Nghị quyết` → must be UBTVQH).

**Same-shape risk, not yet audited.** Điều 4 restricts these trung-ương tiers to a single mandated issuer the same way tiers 2–3 are restricted — nothing has specifically checked them for this defect yet, so it may already be silently present in the DB:

- **Tier 4** — `Lệnh`, `Quyết định` → must be Chủ tịch nước
- **Tier 5** — `Nghị định`, `Nghị quyết` → must be Chính phủ
- **Tier 6** — `Quyết định` → must be Thủ tướng Chính phủ
- **Tier 7** — `Nghị quyết` → must be Hội đồng Thẩm phán Tòa án nhân dân tối cao

Tiers 8–9 (`Thông tư`/`Thông tư liên tịch`) are structurally different — the issuing body legitimately varies per document (which ministry/agency issued *this* Thông tư) — so this single-mandated-issuer guard pattern doesn't directly transfer, though scrape correctness for those tiers hasn't been separately verified either.

**Fix (currently scoped to the 2 confirmed tiers):** `correctQuocHoiIssuingBody` (`vbpl.parser.ts`), called from `parseAttributes` — a permanent guard, not a one-off patch. `Luật`/`Bộ luật` are corrected to "Quốc hội" unconditionally and `Pháp lệnh` to "Uỷ ban Thường vụ Quốc hội" unconditionally, since no other body can legally issue those types. `Nghị quyết` is ambiguous by itself (Chính phủ/UBTVQH/HĐTP/HĐND also issue nghị quyết), so it's only corrected when the citation carries the issuing body's own numbering (`QUOC_HOI_CITATION_PATTERN` / `UBTVQH_CITATION_PATTERN`). Built for Luật/Bộ luật first, then extended to Pháp lệnh once the tier-3 pass found the same pattern there. Extending the same guard to tiers 4–6 (each single-issuer, same shape) is the natural next step but hasn't been done — tier 7 would need its own audit first since no document in this pass has touched Nghị quyết của Hội đồng Thẩm phán TANDTC yet.

**Three gotchas caught during rollout:**

- **Re-sync had no effect at first.** `computeContentVersion` hashed `fullText`/`citation`/`title`/validity/dates but not `issuingBody`, so an otherwise-unchanged document short-circuited the upsert before the correction was ever written (confirmed live: a re-sync returned `changed: false`, DB row untouched). Added `issuingBody` to the hash so an attribute-only correction can't be silently swallowed on re-sync.
- **A latent regex bug, fixed proactively before it hit a live document.** `QUOC_HOI_CITATION_PATTERN` (`/QHK?\d+$/i`) also matched UBTVQH citations, since both end in `QH<khóa>` (`"11/2016/UBTVQH13"`) — a UBTVQH-issued Nghị quyết would have been misclassified as Quốc hội's. Added a negative lookbehind excluding any citation where a letter immediately precedes "QH", and check the UBTVQH-specific pattern first.
- **Spelling gotcha:** vbpl.vn (and existing DB rows) spell it `"Uỷ ban Thường vụ Quốc hội"` — the guard's canonical string must match byte-for-byte or `resolveOrCreateIssuingBody` creates a duplicate `issuing_body` row instead of resolving to the existing one.

Regression tests added in `vbpl.parser.spec.ts` for both bodies and the citation-pattern fix.

**Example:** `149/2025/QH15` — corrected from "Bộ Tài chính" to "Quốc hội". `11/2016/UBTVQH13` — corrected from "Quốc hội" to "Uỷ ban Thường vụ Quốc hội".

---

## 6. Tier-3 100-document pass — three pipeline bugs

|                         |                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Resolved — 2026-07-31; follow-up bugs found 2026-08-03 also resolved                                                                                                                                                                                  |
| **Found**         | Running the first 100 Pháp lệnh (tier 3) documents end to end; the 3 follow-up bugs (6d) surfaced re-attempting §3's corpus-wide backfill                                                                                                              |
| **Docs affected** | 2 direct data-loss cases (`section=6` in CSV); the page-cache fix (6b) and the two 6d fixes each protect/affect every future crawl — the internal-id bug alone silently affected ~7% of the corpus (48/653 documents) for `original_document_urls`   |
| **DB impact**     | `document_node` silently missing on 2 documents; search results silently truncated below the requested `pageSize`; `original_document_urls` silently staying empty on real slug-URL/UUID-id documents even after an apparently-successful sync (6d) |

Four distinct findings surfaced in `server/src/law-index/crawl/`, listed in the order found:

**6a. `pageSize` filter silently ignored.** `VbplClientService.searchDocuments`'s `selectPageSize()` ran *before* the filtered search was submitted, against the page's initial unfiltered list — so vbpl.vn reset back to its default (10/page) the moment the real search ran. A `pageSize=100` request silently came back as 10 items, no error. **Fix:** moved `selectPageSize()` to after the search submits and re-waits, before the page-jump step. Verified live.

**6b. Stuck/broken Playwright page had no recovery path.** `getPage()` cached its browser page indefinitely with no health check. Recurred and got properly diagnosed during the §3 corpus-wide backfill: a 653-document re-sync batch stopped manually after 207 at an 18.7%-and-climbing failure rate — `502` timeouts and client-side timeouts clustering in runs, one bad navigation degrading every subsequent request sharing the same cached page. **Fix:** new `resetPage()` tears down and relaunches the browser/context/page; new `withPageRetry()` wraps every navigation — on failure it resets and retries once before throwing `BadGatewayException`, instead of letting one bad page degrade the whole service instance. `fetchDocument`/`throttledGoto` restructured so each step uses the page returned by the previous step. 123/123 tests pass; verified live on both a long-lived and a freshly restarted server. **Known separate gap, not fixed by this:** `searchDocuments`' `waitForSettledResponse` still independently times out waiting for a matching response in some cases — different code path, reproduced even on a fresh page, flagged as a possible follow-up if it recurs.

**6c. Downstream damage from 6b: 2 documents lost their `document_node` tree.** A routine audit found `07/2012/QH13` and `13/2022/QH15` with real, substantial `fullText` (45KB/56KB) but zero nodes. `parseDocumentBody()` succeeded cleanly against their stored `fullText` (5–6 top-level Chương), ruling out a parser bug. Both matched `status: 0` failures at specific items in the interrupted 653-document backfill from 6b. Most likely: the old client got stuck mid-sync far enough to persist `document`/`document_reference` rows but not finish `document_node` construction, and `syncDocument()`'s try/catch around `syncNodes` swallowed the resulting error. **Fix:** re-synced both through the fixed client → 305 and 404 nodes respectively. Swept the full corpus afterward — no other real-`fullText`-zero-node documents found.

**Batch outcome (informational, not a bug):** 100/100 requests succeeded at the HTTP level — 97 changed, 1 already current, 2 skipped as citation collisions (the §4 skip-don't-overwrite guard working as designed). Of 98 persisted documents, 96 built `document_node` successfully; the other 2 hit the §3 attributes-leak bug (since resolved). Both citation-collision skips were checked individually and confirmed to be vbpl.vn serving the same law under two internal ids — harmless, no action needed (CSV rows kept so the skip isn't silently unaccounted for). One document (`01/2018/UBNVQH14`) has what looks like a citation typo on vbpl.vn's own side (`UBNVQH` vs `UBTVQH`) — left as-is (citations are stored verbatim; unlike `issuing_body` there's no Điều-4 ground truth to correct a citation string against), noted as FYI only.

**Example:** `07/2012/QH13` — 0 nodes → 305 nodes after re-sync.

**6d. Re-attempting the §3 backfill (2026-08-03) hit an *escalating*, not stable, failure rate — traced to local memory exhaustion, not vbpl.vn, plus two more real bugs found along the way.** Resumed the 498-document `original_document_urls` backfill after 6b's fix landed. Failure rate climbed steadily instead of stabilizing (9.6% → 19.7% → 15.2%, with runs of up to 12 consecutive failures) even with 6b's retry-with-fresh-page in place. Stopped by explicit direction once 297 of the 497 pending documents had been attempted (200 remained pending, tracked in [`law-index-pending-original-doc-resync.csv`](law-index-pending-original-doc-resync.csv), self-correcting on re-generation).

- **Ruled out vbpl.vn-side rate-limiting first:** plain HTTP requests to vbpl.vn stayed fast and clean (sub-second, HTTP 200) throughout the degradation — an upstream block/throttle would show up there too, and didn't.
- **Actual cause: `main.ts` never calls `app.enableShutdownHooks()`.** Without it, Nest never invokes `OnModuleDestroy` on process termination, so `VbplClientService`'s browser cleanup never ran on *any* server restart, graceful or not — every restart across this whole day's work orphaned its Chrome process instead of closing it. Confirmed live: 50+ orphaned `chrome.exe` processes accumulated, consuming 3.6GB and leaving only 4.8GB free out of 27.9GB system RAM — real, escalating resource pressure that fully explains an escalating (not stable) failure rate in a way upstream throttling wouldn't. **Fix:** added `app.enableShutdownHooks()` to `main.ts`. Cleaned up the existing orphans (freed ~5GB). A 30-document verification batch immediately after cleanup ran at 0% errors.
- **A second, independent bug surfaced during verification: `extractVbplInternalId` silently returned `null` for most real vbpl.vn URLs.** Its regex required a literal `"van-ban--"` prefix, which only ever matched `buildSearchResultUrl`'s own synthetic placeholder slug — not vbpl.vn's real human-readable slugs from sitemap-discovered URLs (e.g. `"thong-tu-so-05-2026-tt-bgddt-...--31de7cc0-..."`), regardless of whether the trailing id was numeric or vbpl.vn's newer UUID-style scheme. Affected ~7% of the corpus (48/653 documents) for the `original_document_urls` feature specifically, and would also have broken §4's citation-collision disambiguation for the same URL shape had it ever been exercised there. **Fix:** rewritten to take the text after the *last* `"--"` in the URL's final path segment, regardless of what precedes it. Regression tests added covering both URL shapes and both id styles.
- **A third bug, found investigating the second: the "Văn bản gốc" tab renders in more than one DOM shape**, and the original filename-scraping approach (`extractOriginalDocumentFilenames`, reading `.ant-list-item` text after expanding a collapse panel) silently returned `[]` for documents where vbpl.vn skips that collapse+list wrapper entirely and embeds the PDF viewer directly (confirmed live on a real document with a genuine file — no list, no collapse header, nothing for the old extractor to find). **Fix — redesigned rather than patched:** `fetchOriginalDocumentUrls` now captures the download URL directly off the network response (matching `.../api/qtdc/public/doc/minio/buckets/vbpl/...`) instead of reconstructing it from a scraped filename + internal id. This is both more robust (works identically regardless of DOM shape) and simpler (no longer depends on `extractVbplInternalId` at all for this feature) — `buildOriginalDocumentUrl` removed as dead code.

**Verification:** 124/124 tests pass, type-check clean. Live: both previously-broken cases (a UUID-id document with no collapse list, a numeric-id document behind a real vbpl.vn slug URL) now populate `original_document_urls` correctly, and the URLs resolve (200, real PDF bytes). A 40-document batch against the fixed code and a clean process ran 0 errors, 40/40 `changed: true` — a sharp contrast with the same kind of sample before the fix, which mostly came back `changed: false` (silently not updated) due to the internal-id bug. Corpus count: 496/653 documents now have `original_document_urls` populated (up from 156 before this pass), 157 remaining — tracked in the same pending-resync CSV.

**Example:** `01/2026/UBTVQH16` (id `4978cbd0-6aee-11f1-980c-d3fdbd60ea75`, no collapse-list DOM) — `original_document_urls` was `{}` after two prior "successful" syncs, now correctly populated. `06/2020/QĐ-TTg` (real slug URL, numeric id `140940`) — same fix, same result.

**Backfill resumed and completed (2026-08-03, same day).** Ran the remaining 157 documents in one sequential pass. The client-side batch script (fixed `curl --max-time 90`) again showed a rising error rate over the run (11.1% → 17.7%, including a run of 10 consecutive client-side failures around index 102–111) — superficially resembling 6d's original symptom. **This time it wasn't a server bug:** spot-checking the DB for documents the client reported as timed-out showed every one of them had actually synced successfully server-side (`original_document_urls` populated, fresh `updated_at`) — the server kept working past the client's 90s cutoff and finished correctly every time. Root cause was the batch script's fixed client timeout being shorter than the legitimate processing time for documents with a large "Văn bản gốc" file list (each file requires a click-and-wait during capture); the client abandoning the connection while the server was still mid-request also risked a second request landing on the same shared Playwright page before the first released it, which is the more likely explanation for the consecutive-failure clustering, rather than any regression in 6d's fixes. **Fix (batch script only, no server change):** raised the client timeout to 240s and re-ran against a freshly-regenerated pending list. Final result: 653/653 documents now have `original_document_urls` populated — the backfill is complete. The 3 client-side timeouts that occurred even at 240s were confirmed, same as before, to have succeeded server-side.

---

## 7. Quoted multi-Khoản replacement text mis-nested

|                         |                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ⚠️ Unresolved                                                                                                                                                                                                              |
| **Found**         | 2026-07-31, while investigating[§2](#2-điều-header-without-a-period--zero-nodes)                                                                                                                                           |
| **Docs affected** | 1 confirmed (`61/2014/QH13`, also listed under `section=2` in CSV — see its note)                                                                                                                                       |
| **DB impact**     | `document_node` tree shape is wrong for affected documents: extra nodes appear as top-level siblings of the amending Điều instead of nested inside the quoted block. No data loss, but structure/hierarchy is incorrect. |

**Root cause:** this is a parser shape issue, not a per-document data problem — it isn't a bounded checklist the way §1–3 are. When an amending Điều quotes a foreign document's replacement text that itself spans multiple numbered Khoản, only the *first* line of the quoted block carries a leading quote-mark character. That's the only signal `document-node.parser.ts` currently uses to treat content as quoted (opaque) rather than real structure — every subsequent quoted line has no such marker, so `KHOAN_PATTERN` picks up a quoted khoản and inserts it as a new top-level sibling of the amending Điều, rather than nesting it inside the quote.

**Confirmed example:** `61/2014/QH13`, Điều 1 — quotes a full replacement "Điều 8" from Luật Hàng không dân dụng, itself containing Khoản 1–9.

**Needed:** track quote-open/quote-close state across lines (open on a leading `"`/`"`, close on a trailing `"`/`"`) so everything inside a quoted span is treated as opaque text of the node that opened the quote, regardless of what it looks like structurally. Not attempted yet. Likely affects other "Luật sửa đổi, bổ sung" documents beyond the one confirmed case — actual scope not surveyed.

---

## 8. "Văn bản hợp nhất" has no "Ngày ban hành" — upsert threw instead of falling back

|                         |                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Status**        | ✅ Resolved — 2026-08-03                                                                                              |
| **Found**         | Tier-1 (Hiến pháp) pass — syncing`52/VBHN-VPQH`, the consolidated current Hiến pháp text                        |
| **Docs affected** | 1 confirmed live; generalizable to any "Văn bản hợp nhất" document, none of which had been synced before this pass |
| **DB impact**     | None —`upsertDocument` threw before any write, so the failure was clean (500, no partial row), just blocking        |

**Root cause:** `document.repository.ts`'s `upsertDocument` throws if `parsed.attributes.issuedDateRaw` (vbpl.vn's "Ngày ban hành") doesn't parse, since `document.schema.ts`'s `enactedDate` is `NOT NULL`. A "Văn bản hợp nhất" document — a consolidated text compiled by an office (e.g. Văn phòng Quốc hội) rather than promulgated by a legislative body — has no "Ngày ban hành" row on its attributes tab at all (confirmed live on `52/VBHN-VPQH`: the tab has "Ngày ký xác thực" — certification date — in that slot instead). `parseAttributes` returned `issuedDateRaw: null`, and the repo's own `NOT NULL` guard (`document.repository.ts:236`, a plain `throw new Error`, not a Nest `HttpException`) surfaced as an uncaught 500 with no domain-specific error message, since `main.ts` registers no global exception filter.

**Fix:** `parseAttributes` (`vbpl.parser.ts`) now falls back to "Ngày ký xác thực" when "Ngày ban hành" is absent: `get('Ngày ban hành') ?? get('Ngày ký xác thực')`. Regression test added in `vbpl.parser.spec.ts`. No document type besides "Văn bản hợp nhất" has been observed missing "Ngày ban hành" — the fallback is a no-op for every other type since `get('Ngày ban hành')` is non-null for them.

**Example:** `52/VBHN-VPQH` — synced successfully after the fix, `enactedDate` populated from "Ngày ký xác thực" (2025-07-21).

**Related, not diagnosed:** two unexplained oddities surfaced in the same session while searching for tier-1/tier-3 documents via `GET /laws/index/crawl/search`, noted here rather than silently worked around:

- `documentTypes=["Hiến pháp"]` reliably returned `total: 0` even though 6 real "Hiến pháp"-typed documents exist on vbpl.vn (confirmed by reading `sitemap.xml` directly and syncing them by URL instead) — the checkbox click didn't throw `BadRequestException` (which would mean the label wasn't found), so either the checkbox exists but doesn't actually filter to this type, or vbpl.vn's own "Hình thức văn bản" category for these documents doesn't line up with their "Loại văn bản" attribute value the way it does for other types. With `pageSize` set, the same query instead reliably timed out (502) rather than returning 0 — a second inconsistency on top of the first.
- `keyword`-based search (e.g. `keyword=Hiến pháp&searchScope=tieu-de`) returned the same `total: 467` result set regardless of keyword content, and the returned titles didn't match the keyword at all — looked like a stale/cached unfiltered response being returned rather than the actual filtered query result.

Neither blocked this pass (worked around via direct sitemap URLs and `documentTypes` filtering, which worked correctly for `"Pháp lệnh"`), but both are worth root-causing before relying on `crawl/search`'s `documentTypes`+`pageSize` combination or its `keyword` filter for future tier passes.

**Tier-5 backfill status — completed (`còn hiệu lực` scope) 2026-08-05.** Tier 4 (Lệnh, Quyết định của Chủ tịch nước) is deliberately out of scope — see `CLAUDE.md`'s `law-index` description (mostly procedural documents: công bố luật, bổ nhiệm, khen thưởng). Tier 5 (Nghị định + Nghị quyết của Chính phủ) is large — 4,836 Nghị định + 386 Nghị quyết total on vbpl.vn, vs. 21 + 1 in Postgres beforehand — so the pass was scoped to `còn hiệu lực` (still in force) only, narrowing the candidate set to 2,002 Nghị định + 366 Nghị quyết = 2,368. Synced in ~50-document batches (one 20-document stability check first), paused once mid-pass by request and resumed the next day: **all 2,368 `còn hiệu lực` candidates are now synced** — 0 skipped as citation collisions, 0 hard failures across the whole pass. `document_type` counts: 2,023 Nghị định + 367 Nghị quyết (Chính phủ) — up from the 21 + 1 baseline. The pending-tracking CSV is removed now that this scope is complete, matching the pattern used for previous completed passes. The still-`het_hieu_luc`/other-status Nghị định/Nghị quyết (2,834 + 20 respectively, per the original discovery numbers) were never in scope for this pass and aren't tracked anywhere — a future full backfill would need to re-run discovery without the `còn hiệu lực` filter. See §10 and §11 for two issues found during this pass — §11's crash pattern did not recur during the resumed second half (47 batches total, only the first half's ~2,000 documents saw the 6 occurrences), so it remains unresolved but may have been transient/environmental rather than load-triggered.

**Tier-1/tier-3 backfill status — 2026-08-03.** Tier 1 (Hiến pháp) is fully synced — 2 documents: `Không số` (the "Hiến pháp năm 1946" survivor of the §4 citation-collision mechanism — see [§4's 2026-08-03 update](#4-citation-collision-documents-silently-overwritten-or-permanently-blocked) for the other 4 historical versions that were skipped by the same mechanism) and `52/VBHN-VPQH` (the current consolidated text, unblocked by this section's fix). Tier 3 (Pháp lệnh + Nghị quyết issued by Ủy ban Thường vụ Quốc hội) found 310 not-yet-synced candidates via `documentTypes` search, synced in six ~50-document passes (interrupted once mid-pass by request, resumed later) — 264 synced, 3 skipped as citation collisions, 0 hard failures. **This was declared "complete" prematurely — see [§9](#9-cross-search-citation-dedup-silently-undercounted-the-tier-3-backfill): the candidate-discovery step itself had a dedup bug that silently dropped 56 more real documents, found and fixed in a follow-up pass the same day.** Final `document_type` counts after both passes: 145 Pháp lệnh + 270 Nghị quyết, both under Ủy ban Thường vụ Quốc hội (plus 1 Nghị quyết under Chính phủ, tier 5, unrelated).

---

## 9. Cross-search citation dedup silently undercounted the tier-3 backfill

| | |
|---|---|
| **Status** | ✅ Resolved — 2026-08-03 |
| **Found** | Investigating an unrelated apparent "document count regression" after the tier-3 backfill above — the regression itself turned out to be a red herring (see below), but investigating it surfaced this real bug |
| **Docs affected** | 56 (54 Pháp lệnh + 2 Nghị quyết) |
| **DB impact** | None — no wrong data was ever written. The backfill pass above just silently never attempted these 56 documents, so they were simply absent, not corrupted. |

**Root cause:** the ad-hoc script that built the tier-3 backfill's candidate list searched `documentTypes=["Pháp lệnh"]` and `documentTypes=["Nghị quyết"], issuingBodies=["Uỷ ban Thường vụ Quốc hội"]` separately, then merged the two result sets and deduplicated by each item's `citation` field before diffing against Postgres. `citation` in a `crawl/search` response is corrupted by the same mojibake bug noted in §4's methodology note (UTF-8 decoded as Windows-1252 somewhere in `VbplClientService.searchDocuments`) — and critically, this corruption is *lossy*, not just cosmetic: many genuinely distinct pre-1976 documents share the literal citation `"Không số"`, and the corrupted rendering of that string collided across all of them in the dedup `Map`, so only the first-seen one survived the merge. The other 53 silently vanished from the candidate list before the backfill ever got a chance to attempt them (2 more were lost the same way from the Nghị quyết side, on a smaller "Không số" cluster there).

**How it was found:** a routine re-check of document counts after the backfill appeared to show 2 rows had vanished from the DB (136 Pháp lệnh right after the backfill → 135 later) with no corresponding write activity — first suspected as a possible external/manual deletion (Postgres logs do show an unrelated, unsuccessful manual `DELETE FROM document` attempt from 2026-07-31, proving direct DB access happens in this environment, but no evidence tied it to this specific delta). That theory turned out to be a wrong track: a clean, single-type re-diff (`documentTypes=["Pháp lệnh"]` alone, matched against Postgres by `sourceUrl` rather than any merged/deduplicated candidate list) immediately revealed the real gap was 54, not 1 — proving the "1-2 row disappearance" observation was just noise on top of a much larger, pre-existing undercount, not a real deletion event.

**Fix — methodological, not code:** re-ran the candidate search per-type (no cross-type merge), diffed each type's results against Postgres independently by `sourceUrl`, and synced the union of gaps directly. No production code changed — `crawl/search`'s underlying mojibake bug (§4) is still unfixed and still corrupts response text; the fix here is procedural: **never deduplicate `crawl/search` results by `citation` across multiple queries — dedupe (or diff against Postgres) by `sourceUrl` only.** This is now called out explicitly in the root `CLAUDE.md`'s law-index scraping runbook.

**Example:** of the 54 recovered Pháp lệnh documents, 44 turned out to be additional `"Không số"`-citation collisions against already-expired documents (correctly skipped, not overwritten — the §4 mechanism working as designed on a larger cluster than previously seen) and 10 were genuine new rows, including several pre-1976 `"Không số"`-citation Pháp lệnh that vbpl.vn marks `còn hiệu lực` (still in force) and which the disambiguation path (§4) correctly inserted as `"Không số (vbpl-<id>)"`.

---

## 10. `validityStatus` advanced-dropdown 500s instead of 400ing

| | |
|---|---|
| **Status** | ⚠️ Unresolved |
| **Found** | Tier-5 (Nghị định + Nghị quyết Chính phủ) candidate discovery, trying to narrow the search to `còn hiệu lực` documents only |
| **Docs affected** | N/A — a `crawl/search` request bug, not a persistence bug; no `document` row is ever at risk |
| **DB impact** | None |

**Root cause:** `GET /laws/index/crawl/search?...&validityStatus=Còn hiệu lực` reliably returns a bare `{"statusCode":500,"message":"Internal server error"}`. In `VbplClientService.selectAdvancedDropdown` (`vbpl-client.service.ts:460-477`), the dropdown-opening click (`label.locator('xpath=following-sibling::*[1]').click()`, line 466) sits **outside** the function's own `try/catch` — only the subsequent option-click is guarded, converting a not-found *option* into a clean `BadRequestException`. If the click that opens the dropdown itself throws (e.g. a Playwright timeout/interception on the advanced panel not being fully settled), that raw error propagates uncaught all the way to Nest's default exception filter, which returns a generic 500 for any non-`HttpException` — the same class of bug as §8's `enactedDate` guard.

**Fix — not applied, worked around instead.** For the tier-5 pass, `validityStatus` was avoided entirely: fetched the full unfiltered `documentTypes` result set and filtered client-side on each item's `validityStatus` field using its corrupted-but-deterministic mojibake form (`'CÃ²n hiá»‡u lá»±c'` — see §4's mojibake note; the corruption is a consistent 1:1 transform, so exact-matching the corrupted string is reliable). A real fix would wrap `selectAdvancedDropdown`'s opening click the same way §8 wraps its `NOT NULL` guard — a try/catch around the whole function body, not just the second half — but this hasn't been done since the client-side workaround was sufficient for this pass.

---

## 11. Server crashed and self-recovered repeatedly during the tier-5 pass

| | |
|---|---|
| **Status** | ⚠️ Unresolved / undiagnosed |
| **Found** | Tier-5 backfill, batches of ~50 documents run back-to-back over roughly 2,000 documents |
| **Docs affected** | 0 — every occurrence was caught by the batch script (all 50 items in the affected chunk failed with `TypeError: fetch failed`) and fully recovered by retrying the same chunk once the server responded again; no partial writes, no data loss |
| **DB impact** | None directly — cost was operational (each occurrence paused the batch chain for roughly 30–60 seconds until the server came back) |

**Symptom:** 6 times across the ~2,000-document tier-5 pass, an entire in-flight batch of 50 `POST /laws/index/crawl/url` calls failed instantly and uniformly with `TypeError: fetch failed` (a client-side connection error, not an HTTP error response) — `curl http://localhost:3000/api` confirmed the port was unreachable (`000`) at the same moment. Within roughly 30 seconds to a couple of minutes, the server was reachable again on its own, under a **new PID** (confirmed via `netstat`), without any restart command issued by this session. Roughly one occurrence per ~300–400 documents processed, though not perfectly regular.

**Investigated and ruled out:** checked for the exact failure mode already documented in §6d (orphaned Playwright/Chromium processes from a missing `enableShutdownHooks()`, causing memory exhaustion) — found none: every `chrome.exe` process running at the time belonged to the machine's own interactive Chrome browser (real user profile under `Program Files\Google\Chrome`), not a headless Playwright-launched instance, and no non-Chrome-app Chromium process was found at all while investigating. `main.ts` already calls `enableShutdownHooks()` (the §6d fix). Free memory was not critically low at the times checked.

**Not diagnosed:** the actual crash cause is unknown. Nothing in this session started or supervised the dev server process directly enough to capture its stdout/stderr at the moment of failure — a log file set up earlier in the session (`server/_scratch_devserver.log`) had already been deleted during a prior cleanup pass by the time this pattern was noticed, and the process kept self-recovering before a new capture could be attached. Whatever is restarting it (Nest's own `--watch` file-watcher doesn't restart on an uncaught crash by default, so something else — an external supervisor, a scheduled task, or manual intervention — is more likely) was never identified either.

**Mitigation applied:** none beyond retrying. The batch script already treats a fully-failed chunk as safe to blindly re-run (it only removes rows from its pending-CSV queue after a *successful* `changed`/`skippedReason` response), so no special handling was needed — just checking `curl .../api` before retrying.

**Follow-up, not attempted:** capture `stdout`/`stderr` to a persistent, rotating log file for the dev server (not deleted between passes) so the next occurrence can actually be diagnosed instead of just retried.

---

## Not yet automated

Every record above was found by ad-hoc SQL spot-checks (comparing `document.rawSource.fullText` length against total `document_node.text_content` length, then manually inspecting outliers) run by hand after each reindex pass — nothing in `server/src/law-index/` detects or records these automatically. For this log to stay current as new documents get synced, that detection needs to become a real step (a coverage-ratio check the sync flow runs and logs, or a periodic query against the corpus) rather than a habit of remembering to check.
