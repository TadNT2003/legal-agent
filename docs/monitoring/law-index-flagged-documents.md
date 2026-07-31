# law-index: flagged documents log

**Status: manually maintained.** Nothing in `server/src/law-index/` writes to this file (or the CSV below) automatically — there is no automated flagging/logging mechanism in the codebase yet (see "Not yet automated" below).

This file is the **issue narrative only** — what went wrong, root cause, the fix, and any still-open follow-up. Per-document records (every citation/title/date this investigation touched) live in **[`law-index-flagged-documents.csv`](law-index-flagged-documents.csv)** instead, one row per document, tagged with the section number below it belongs to (`section` column). Append to both (don't overwrite) whenever a future verification pass finds something new: prose + root cause here, the affected documents' rows in the CSV.

**CSV columns:** `section` (matches the `###` section number here) · `section_title` · `status` (`Resolved` / `Unresolved` / `Won't fix` / `Info — no action needed`) · `internal_id` (vbpl.vn's own document id, where relevant — e.g. citation-collision rows) · `citation` (`document.citation_id`) · `title` (`document.title`) · `enacted_date` (`document.enacted_date`) · `validity_status` (`document.status` at time of flagging, or vbpl.vn's own label where the document was never persisted) · `issue` (what's wrong with this specific row) · `resolution` (what fixed it, or why it won't be).

---

## Resolved

### 1. Annex content swallowed — footer-drop logic didn't recognize non-"Phụ lục" annex labels

Found during the first 50-document `document_node` reindex (2026-07-30). An attached annex (a QCVN technical standard, a "Biểu số" report form) placed after the document's signature block was being silently dropped in full, because the footer-stripping logic only knew how to resume structured parsing on the literal word "Phụ lục".

**Fix:** generalized the footer-escape trigger (`ANNEX_RESTART_PATTERN` in `document-node.parser.ts`) to also recognize a re-stated Quốc hiệu header ("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM") or a standalone "Biểu số/Mẫu số/QCVN/TCVN `<code>`" title line. Regression tests added; both documents' `document_node` trees rebuilt from stored `fullText`.

Affected documents: 2 rows, `law-index-flagged-documents.csv` (`section=1`).

### 2. Điều header missing punctuation — period-only regex matched nothing

Found while backfilling `document_node` for all Luật/Bộ luật documents (2026-07-31). Older "Luật sửa đổi, bổ sung" amendment laws (spanning 1962–2019 in this batch) write their Điều header without a period: bare `"Điều 1"` (heading on the next line), `"Điều 1: <heading>"` (colon), or `"Điều 1 <heading>"` (no punctuation at all). The parser's `DIEU_KHOAN_PATTERN` required a literal period, so these 17 documents produced zero `document_node` rows despite having real, parseable structure.

**Fix:** made the separator after the Điều number optional (`[.:]?` instead of a mandatory `.`) in `DIEU_KHOAN_PATTERN`. Regression tests added for all three punctuation variants; all 17 documents' trees rebuilt from stored `fullText`.

Affected documents: 17 rows, `law-index-flagged-documents.csv` (`section=2`). Note: `61/2014/QH13`'s tree has a separate, unresolved shape issue — see §7 below.

### 3. Attributes-tab content leaked into `fullText` instead of real document body

Found during the same Luật/Bộ luật backfill (2026-07-31). These 6 documents' `document.rawSource.fullText` (305–440 characters) is the *attributes* table ("Số hiệu / Loại văn bản / Ngành / Ngày ban hành / ...") rather than the Nội dung tab's real body text — originally assumed to be an upstream scrape-time bug, not a `document_node` parsing gap.

**Recurred in the tier-3 (Pháp lệnh) 100-document batch (2026-07-31):** same signature (short `fullText`, 0 `document_node` rows), confirming this isn't confined to Luật/Bộ luật.

**All 8 re-synced (2026-07-31) via `POST /laws/index/crawl/url` — bug reproduced identically on every single one**, ruling out a transient timing flake.

**Root cause confirmed (2026-07-31), and it changed the diagnosis entirely — this was never a timing bug.** Opened all 8 documents live in a real browser and checked their tab bar directly: **none of the 8 has a "Nội dung" tab on vbpl.vn at all** — only Thuộc tính / Lược đồ / Văn bản gốc / Tải về. vbpl.vn has no digitized body text for these documents; the only thing available is a scanned/original file behind "Văn bản gốc". `VbplClientService`'s `extractScopeTitleAndFullText()` (in-page `page.evaluate` function) read `.ant-tabs-tabpane-active`'s `innerText` unconditionally, assuming the page's default active tab is always Nội dung — but on these documents the default active tab is actually Thuộc tính, so the attributes table got captured as `fullText` instead of failing loudly or coming back empty. Since there is no Nội dung tab to ever successfully load, this was 100% deterministic — matches exactly what the 8/8 identical re-sync reproduction showed.

**Fix (2026-07-31):** `extractScopeTitleAndFullText()` now checks whether a tab with `data-node-key="toan-van"` (Nội dung) exists before trusting the active pane; if it doesn't, `fullText` is returned as `null` instead of whatever pane happens to be active by default. Propagated the `string | null` type through `RawVbplPage`/`ParsedVbplDocument`. `document.repository.ts`'s `computeContentVersion` hashes `fullText ?? ''`; `document-node.repository.ts`'s `syncNodes` treats `fullText === null` as a legitimately empty tree (not a parse failure) rather than calling `parseDocumentBody(null)`. All 8 documents re-synced and verified live: `raw_source.fullText` is now genuine JSON `null` (checked via `jsonb_typeof`), not the leaked attributes text. `document_node` correctly stays empty for all 8 — there is no body text to chunk, which is now represented honestly instead of silently wrong.

**Open follow-up, not addressed here:** whether to also capture the "Văn bản gốc" scanned-original link (for a future OCR/manual-ingestion pass) was explicitly deferred — `fullText: null` was chosen as the fix for now. How many documents beyond these 8 fall into this "scanned original only, no Nội dung tab" category across the rest of the corpus is unknown — not yet surveyed, deferred in favor of landing the detection fix first.

Affected documents: 8 rows, `law-index-flagged-documents.csv` (`section=3`).

### 4. Citation collision — documents can never coexist under a shared/reused vbpl.vn citation

Found while rechecking vbpl.vn for Luật/Bộ luật coverage gaps (2026-08-01). Compared the full Luật (562) + Bộ luật (16) count on vbpl.vn's trung-ương corpus against what's in Postgres and found a 74-document gap (70 Luật + 4 Bộ luật). Diffing by vbpl.vn's internal document id (not by citation string — see the methodology note below) narrowed this to exactly **69 documents that are structurally blocked from ever being stored**, plus 5 that turned out not to be a real gap at all (vbpl.vn serves the same already-indexed law under a second URL — harmless, no action needed).

**Root cause:** `document.citation_id` is `UNIQUE`, and `document.repository.ts`'s `upsertDocument` looks up "is this document already synced?" purely by matching `citation_id`. That's correct when a citation is a real, unique identifier — but vbpl.vn's older corpus (entirely pre-1998 in this batch) has two ways a citation is *not* unique:

- **"Không số" ("no number")** — every pre-Đổi Mới law that predates Vietnam's modern `{số}/{năm}/{loại}-{cơ quan}` citation scheme is recorded on vbpl.vn with the literal citation string "Không số". 67 distinct real laws (1959–1997) share this one string. Only whichever one was synced *last* survives — every earlier sync of a different "Không số" law gets its row silently overwritten (title, dates, `raw_source`, and cascaded `document_node` tree all replaced) by the next one, because `upsertDocument` can't tell them apart. `Luật Cải cách ruộng đất` (1953) occupied the slot at time of discovery.
- **Reused batch instrument numbers** — at least 2 more cases where vbpl.vn assigned the *same* citation to two genuinely different laws passed in the same legislative batch: `270B-NQ/HĐNN8` (held "Luật Thuế Tiêu thụ đặc biệt", 1990; blocked "Luật Thuế Doanh thu") and `3-LCT/HĐNN7` (held "Luật Tổ chức Tòa án nhân dân", 1981; blocked "Luật Tổ chức Viện kiểm sát nhân dân").

**Methodology note:** the crawl-search endpoint's response text is mojibake for any citation/title containing non-ASCII characters (confirmed: real UTF-8 bytes decoded as Windows-1252 somewhere in `VbplClientService.searchDocuments`'s response handling — Playwright's `Response.text()` likely trusted a wrong/missing charset from vbpl.vn's Server Action response). This corrupted an initial citation-string-based diff badly enough to produce ~20 false "missing" entries (documents already correctly stored, just compared against their own mangled citation). Recomputed the diff using the ASCII-only internal id embedded in `sourceUrl` (immune to the encoding bug) instead, which is what the 74/69 figures above are based on. The mojibake itself is a distinct bug worth fixing in `VbplClientService`/`vbpl.parser.ts`'s search-response handling (affects the live `crawl/search` endpoint's output for any caller), but is not itself a reason any document failed to index — flagged here only because it's the reason this investigation needed a second pass.

**Validity status verified for all 69 (2026-08-01)** via vbpl.vn's own `Tình trạng hiệu lực` field, against the assumption that all colliding documents are dead law with no bearing on current legal Q&A — **66 confirmed "Hết hiệu lực toàn bộ" (fully expired)**, including both reused-citation cases, but **3 of the "Không số" group are still "Còn hiệu lực" (currently in force)**: `Luật Bảo vệ sức khỏe nhân dân` (1989, id 25506), `Luật Thuế sử dụng đất nông nghiệp` (1993, id 10803), `Luật Bầu cử Đại biểu Quốc hội` (1997, id 8611). Those 3 were pulled out and fixed individually (below), since permanently excluding *live* law is a correctness problem, not a scope decision, even though the 66 genuinely-expired ones are.

**Decision (2026-08-01): the 66 confirmed-expired documents are out of scope for this corpus — won't fix.** Rationale: (1) direct precedent — `server/src/law/` already made this exact call for the same "Không số" pattern, for the same reason (see the `d441189` commit message: "ignore those laws completely because they're now irrelevant to the current legal system"); (2) the real fix (loosening/replacing the `citation_id UNIQUE` constraint) has to be re-validated against every citation-keyed lookup in `document.repository.ts` — reference resolution, forward-reference healing, consolidation matching — a disproportionate cost for content with no bearing on "what does current law say," this system's stated purpose; (3) it's a small, now fully-enumerated, and *documented* boundary rather than a silent gap — revisit if the corpus's scope ever grows to include historical/repealed-law research.

**The remaining 3 were fixed individually (2026-08-01)** with a one-off script, rather than accepted into the won't-fix decision above. `Luật Cải cách ruộng đất` (id 1105) — the original occupant of bare "Không số", also confirmed "Còn hiệu lực" live on a follow-up check — got the same treatment for consistency, renamed from bare `Không số` to `Không số (vbpl-1105)`.

**This is no longer a one-off fix — it's now a permanent mechanism in `document.repository.ts`'s `upsertDocument`** (2026-08-01), so future crawls handle this automatically instead of needing another manual intervention:

- A document is recognized as a re-sync of itself by matching `rawSource.sourceUrl`, not citation — citation alone can't tell two "Không số" documents apart, and vbpl.vn always reports the bare citation on every scrape regardless of what disambiguated form a document was previously stored under.
- If a different document already occupies the citation (a real collision): documents that are **not** "còn hiệu lực" are skipped entirely (`upsertDocument` returns `{ documentId: null, skippedReason }`, surfaced through `syncDocument`/`syncAll` the same way the existing scope-mismatch skip already is) rather than silently overwriting whatever's there. Documents that **are** "còn hiệu lực" get disambiguated by appending vbpl.vn's own internal document id (`extractVbplInternalId`, `vbpl.parser.ts`) to the citation — `"<citation> (vbpl-<id>)"` — and inserted as their own row.
- Verified live end-to-end (2026-08-01): re-sync-recognizes-itself (both a normally-synced and a manually-SQL-renamed document), the skip path (`3-LCT/HĐNN7`'s expired collision, id 4090 vs the existing id 4091 occupant), and the disambiguate path (a synthetic collision against a real never-before-seen document, cleaned up after). Unit tests added for `extractVbplInternalId`; no repository-level test added, matching this module's existing no-DB-mocking precedent (§ "Not yet automated" below) — verified against live Postgres instead.

**Marked Resolved** in the sense that every one of the 69 documents this investigation found now has a settled, deliberate outcome and the underlying mechanism is permanent code, not a one-off script — not in the sense that all 69 were fixed: 3 (+ the renamed original occupant = 4) were fixed, 66 were explicitly decided out of scope. Both outcomes are tracked per-document in the CSV (`status` = `Resolved` or `Won't fix`).

Affected documents: 70 rows, `law-index-flagged-documents.csv` (`section=4`) — 4 `Resolved`, 66 `Won't fix`.

### 5. "Luật"/"Bộ luật" mis-attributed to the drafting ministry instead of Quốc hội

Found via a Postgres tier audit (2026-07-31): 3 documents with `document_type = 'Luật'` had `issuing_body` set to a ministry instead of Quốc hội, even though Điều 4 khoản 2 restricts "Luật"/"Bộ luật" to Quốc hội exclusively and each citation's own `QH<khóa>` numbering confirms it. Confirmed against the live vbpl.vn attributes tab — the drafting ministry is what vbpl.vn itself reports in "Cơ quan ban hành" for these, not a scrape-time misread.

**Fix:** `correctQuocHoiIssuingBody` (`vbpl.parser.ts`), called from `parseAttributes` — a permanent guard, not a one-off patch. "Luật"/"Bộ luật" are corrected to "Quốc hội" unconditionally (no other body can legally issue that document type); "Nghị quyết" is ambiguous by itself (Chính phủ/UBTVQH/HĐTP/HĐND all issue nghị quyết too), so it's only corrected when the citation also carries Quốc hội's own `QH<khóa>` numbering (`QUOC_HOI_CITATION_PATTERN`). Unit tests added in `vbpl.parser.spec.ts`.

Re-syncing the 3 already-stored documents (`POST /laws/index/crawl/url`) initially had no effect: `document.repository.ts`'s `computeContentVersion` hashed `fullText`/`citation`/`title`/`validityStatusRaw`/`effectiveDateRaw`/`expiryDateRaw` but not `issuingBody`, so an otherwise-unchanged document short-circuited the upsert (`changed: false`) before the corrected `issuing_body` was ever written — confirmed live (re-sync of `149/2025/QH15` returned `changed: false` and the DB row was untouched). Added `issuingBody` to the hash so this class of correction (an attribute-only change with no `fullText`/date/status delta) is no longer silently swallowed on re-sync; all 3 documents re-synced successfully afterward.

Affected documents: 3 rows, `law-index-flagged-documents.csv` (`section=5`).

### 6. Same mis-attribution bug also hits "Pháp lệnh" (tier 3) — guard extended, latent regex bug fixed proactively

Found during a first-100-documents tier-3 (Pháp lệnh) indexing pass (2026-07-31): §5's `correctQuocHoiIssuingBody` only covered Luật/Bộ luật/Nghị quyết-of-Quốc-hội, not Pháp lệnh — but Điều 4 khoản 3 restricts "Pháp lệnh" to Ủy ban Thường vụ Quốc hội (UBTVQH) just as exclusively as khoản 2 restricts Luật/Bộ luật to Quốc hội. Of the 100 Pháp lệnh documents synced, 2 had the same class of mismatch: `11/2016/UBTVQH13` reported "Quốc hội" and `15/2004/PL-UBTVQH11` reported "Bộ Nông nghiệp và Môi trường" (the drafting ministry) — both confirmed live on vbpl.vn itself, not a scrape misread.

**Fix:** extended `correctQuocHoiIssuingBody` (`vbpl.parser.ts`) — "Pháp lệnh" is now corrected to UBTVQH unconditionally, same treatment as Luật/Bộ luật; "Nghị quyết" now also checks for UBTVQH's own citation numbering (`UBTVQH_CITATION_PATTERN`), not just Quốc hội's.

**Also fixed proactively (no live document affected yet, but would have miscorrected the first one encountered):** the existing `QUOC_HOI_CITATION_PATTERN` (`/QHK?\d+$/i`) matched any citation ending in `QH<khóa>` — but UBTVQH citations (`"11/2016/UBTVQH13"`, `"...PL-UBTVQH11"`) *also* end in `QH<khóa>`, so a UBTVQH-issued "Nghị quyết" would have been misclassified as Quốc hội's. Added a negative lookbehind (`(?<![A-ZĐ])QHK?\d+$`) excluding any citation where a letter immediately precedes "QH", and check the UBTVQH-specific pattern first. Regression test added (`vbpl.parser.spec.ts`) asserting a UBTVQH-numbered Nghị quyết stays UBTVQH-attributed.

Exact spelling matters here: vbpl.vn (and the existing DB rows) consistently use `"Uỷ ban Thường vụ Quốc hội"` — the guard's canonical string must match that byte-for-byte, or `resolveOrCreateIssuingBody`'s exact-string lookup creates a second, duplicate `issuing_body` row instead of resolving to the existing one.

Both documents re-synced via `POST /laws/index/crawl/url` (already covered by §5's `computeContentVersion` fix, so the correction actually landed on re-sync).

Affected documents: 2 rows, `law-index-flagged-documents.csv` (`section=6`).

---

## Unresolved

### 7. Quoted multi-item replacement text mis-nested as top-level siblings

Found while investigating item #2 above (2026-07-31) — a parser shape issue, not a per-document data problem, so it isn't a bounded checklist the way #1–3 are. When an amending Điều quotes a foreign document's replacement text that itself spans *multiple* numbered Khoản (e.g. a quoted `"Điều 8. ... 1. ... 2. ... 9. ..."` block), only the quoted block's *first* line carries a leading quote-mark character. That's the only signal the parser currently uses to keep quoted content from being read as real structure (see `document-node.parser.ts`'s handling of lines starting with `“`/`"`) — every subsequent quoted line has no such marker, so a quoted khoản-numbered item can be picked up by `KHOAN_PATTERN` and inserted as a new top-level sibling Khoản of the *amending* Điều, rather than staying nested inside the quoted block it actually belongs to.

**Confirmed example:** `61/2014/QH13`, Điều 1 (quotes a full replacement "Điều 8" from Luật Hàng không dân dụng, itself containing Khoản 1–9).

**Needed:** track quote-open/quote-close state across lines (open on a leading `“`/`"`, close on a trailing `”`/`"`) so everything inside a quoted span is treated as opaque text of the node that opened the quote, regardless of what it looks like structurally. Not attempted yet — likely affects other "Luật sửa đổi, bổ sung" documents beyond the one confirmed case, but the actual scope (how many) hasn't been surveyed.

### 8. Tier-3 100-document indexing pass — process findings

Run 2026-07-31 to index the first 100 Pháp lệnh (tier 3) documents and evaluate the pipeline end to end. Two tooling bugs surfaced before any document sync happened, both in `server/src/law-index/crawl/`:

- **`GET /laws/index/crawl/search`'s `pageSize` filter was silently ignored.** `VbplClientService.searchDocuments`'s `selectPageSize()` ran *before* the actual filtered search was submitted — against the page's initial, unfiltered result list — so vbpl.vn reset the page size back to its default (10/page) the moment the real search executed. A request for `pageSize=100` came back as a 10-item page with `pageSize: 10` in the response, with no error. **Fixed:** moved the `selectPageSize()` call to after the search submits (and re-waits for the resulting response), before the page-jump step. Verified live: `pageSize=100` now correctly returns 100 items.
- **A stuck/broken Playwright page required a full server restart to recover from.** The port-3000 dev server was returning bare `500`s for `crawl/search` before any of today's code changes — root cause not fully diagnosed (`VbplClientService` caches its browser `page` indefinitely via `getPage()`, with no health check or recovery path if that page ends up in a bad state after some earlier failure). A process restart cleared it. **Not fixed** — `getPage()` should detect a dead/broken page (e.g. `page.isClosed()`, or a wrapping try/recreate around the navigation calls) and recreate it rather than requiring an operator to notice and restart the whole process. This is the reason this section stays under "Unresolved" despite most of its findings being closed.

Batch outcome once both were resolved: 100/100 requests succeeded at the HTTP level (0 errors) — 97 changed, 1 already up to date, 2 skipped as citation collisions with an existing, confirmed-not-`còn hiệu lực` document (the established §4 skip-don't-overwrite guard working as designed, not a new issue). Of the 98 persisted documents, `document_node` build succeeded for 96; the other 2 (`11/2003/PL-UBTVQH11`, `15/2004/PL-UBTVQH11`) hit the §3 attributes-leak bug — since resolved, see §3 (now correctly `fullText: null`, no more `document_node` rows, since these 2 genuinely have no digitized body on vbpl.vn) — no other `document_node`-parsing failure modes found in this batch. One document (`01/2018/UBNVQH14`) has what looks like a citation typo on vbpl.vn's own side (`UBNVQH` instead of `UBTVQH`) — left as-is (citations are stored verbatim per this module's existing convention; unlike issuing_body there's no Điều-4-derived ground truth to correct a citation string against), noted here only as an FYI.

**Both citation-collision skips, tracked individually** (per this doc's own convention — see §4 — every document the collision guard filters out gets a row in the CSV, not just a summary): checked each skipped candidate's title/enacted date (from the crawl-search result, since a skipped document is never persisted) against whatever already occupies that citation. Both turned out to be §4's already-documented "harmless duplicate" case — vbpl.vn serving the exact same law (identical title, identical enacted date) under two different internal ids/URLs — not a genuine two-different-laws-share-one-citation collision like the historical `Không số`/reused-batch-number cases. No action needed, but recorded so the skip isn't silently unaccounted for.

Affected documents: 2 rows, `law-index-flagged-documents.csv` (`section=8`).

---

## Not yet automated

Every record in the CSV was found by ad-hoc SQL spot-checks (comparing `document.rawSource.fullText` length against total `document_node.text_content` length, then manually inspecting outliers) run manually after each reindex pass — there is no code in `server/src/law-index/` that detects or records these automatically. If this log is expected to stay current as new documents get synced, that detection needs to become a real step (e.g. a coverage-ratio check the sync flow runs and logs, or a periodic query against the corpus), not a habit of remembering to check by hand.
