# Fixing §12b/§12c: table-data and quoted-amendment misparse in `document-node.parser.ts`

## Context

`docs/monitoring/law-index-flagged-documents.md` §12 documents three causes of duplicate `document_node` paths; a `dedupeOrdinal` backstop (already shipped) keeps every path unique corpus-wide, but two of the three causes were left with their *underlying* mis-parse unfixed — the backstop hides the symptom (path collision) without fixing the actual tree shape (wrong/extra nodes, content in the wrong place). A third cause (§15, vbpl.vn's own amendment-annotation DOM duplication) was found and fixed separately this session; §12b and §12c are the two still open.

This plan fixes both, using fresh, concrete evidence gathered live against the real corpus (not just the two examples already in the log) to ground the actual regex/heuristic design — the log's own posture on both ("needs real sample calibration") is the reason neither was attempted before now.

### §12b — tabular/statistical data misread as Khoản numbering

**Root cause, now fully explained.** `KHOAN_PATTERN` (`^(\d+)([a-zđ]?)\s*\.\s*(.*)$`) matches any line starting with `<digits>.`. Vietnamese legal documents format large numbers with `.` as the **thousands separator** (e.g. `104.042` = 104,042). Land-use-planning Nghị quyết embed data tables (loại đất/diện tích) that get flattened to plain text by the scrape, and a table cell like `104.042` matches `KHOAN_PATTERN` as ordinal `104`, content `042` — a false positive on every single numeric table cell. Confirmed live on `19/2007/NQ-CP` (Điều 2, "Phân bổ diện tích các loại đất..."): the real Khoản 1 node's own text contains the table's header row verbatim — `Đơn vị tính: ha` / `Thứ tự` — immediately followed by dozens of fake "Khoản" nodes whose content is bare number fragments (`690`, `985`, `042`...) or, in the harder cases, a short table-row label (`Đất lâm nghiệp`, `Đất chuyên dùng`) that looks superficially like a real short Khoản.

**Scope.** 81 documents corpus-wide contain the `Đơn vị tính:` trigger phrase (a proxy for "has this kind of table", not an exact fragment count — one flagged instance per table, not per fragment). The 15 worst-affected single documents each have 330-482 fake Khoản-type children under one Điều — `12/2017/QH14` at 482 is actually §12c (see below), but `25/2007/NQ-CP` (470, already logged), `19/2007/NQ-CP` (427), `46/2007/NQ-CP` (397), and a further ~12 documents in the same "quy hoạch sử dụng đất" (land-use planning) Nghị quyết series from 2006-2008 all show the identical shape.

### §12c — quoted amending text carries its own independent numbering

**Root cause, now fully explained with a larger real example.** An amending Điều/Khoản frequently reads "`Điều N được sửa đổi, bổ sung như sau:`" followed by a **quoted** block (opening `"`) containing the target document's full replacement text — which is itself numbered, restarting at 1, entirely independent of the citing document's own structure. Confirmed live on `01/2007/UBTVQH12` (Pháp lệnh sửa đổi Pháp lệnh thi hành án phạt tù): its real Điều 1 has exactly 14 real Khoản (each one `"Điều X được sửa đổi/bổ sung/bãi bỏ... như sau: "<quoted target Điều>""`), but the quoted target Điều's *own* numbered sub-clauses (e.g. target Điều 1's 10 sub-clauses, target "Điều 1a"'s 10 sub-clauses) get flattened as siblings of the real Khoản list — landing at colliding ordinals `1_2`...`1_10`, `2_2`...`2_10`, etc. Quotes use plain straight double-quotes (`"`, U+0022) opening right after "như sau:" and closing at the end of the quoted passage — confirmed on real examples that this pairing is consistent (not curly/typographic quotes, not asymmetric).

**Scope.** 113 documents corpus-wide contain the "được sửa đổi, bổ sung như sau"/"được bổ sung như sau" trigger phrase (again a proxy for "at risk", not a confirmed-affected count). `12/2017/QH14` (Luật sửa đổi Bộ luật Hình sự) is the largest known instance — 482 Khoản-type children under one Điều, previously logged at "82 duplicate groups, worst single group 99 copies."

## Decision: suppress, don't reconstruct

Both fixes follow the same shape, and it's deliberately the *cheaper* of two possible strategies:

- **Not attempted:** building a correct nested sub-tree (a real `document_node` per quoted target sub-clause, or a dedicated table representation). This is what a "full fix" would look like, but it multiplies the risk and the surface area for a v1 — and per-clause retrieval of *quoted* text is not obviously valuable anyway (the target document's own Điều, once separately scraped, already carries that content as first-class nodes under its own tree).
- **Chosen:** suppress structural parsing entirely within a detected table/quote span — the table rows or quoted text become inert body text appended to the *enclosing* real node (the table-intro Khoản, or the citing Khoản), never generating their own `document_node` rows at all. This eliminates the ordinal collision at the source (nothing new is opened, so `dedupeOrdinal` never needs to fire for these cases going forward) rather than continuing to paper over it.

Both suppression mechanisms are a **boolean state flag checked before attempting `KHOAN_PATTERN`/`DIEM_PATTERN` match**, exiting automatically once a higher-level structural marker (`Điều`/`Chương`/`Mục`/`Phần`/`Phụ lục`) is encountered and takes over via the existing `stack`-popping logic in `openNode`. This is the same architectural pattern `document-node.parser.ts` already uses for `inFooter` (see `FOOTER_START_PATTERN`) — no new state-machine style introduced, just two more instances of one already-established in this file.

---

## Phase 1 — §12b: table-content suppression

**File:** `server/src/law-index/crawl/document-node.parser.ts`

1. Add a `TABLE_HEADER_PATTERN` trigger — calibrate against real matches beyond the one confirmed phrase (`Đơn vị tính:`); check a handful of the ~15 worst-affected documents (the 2006-2008 "quy hoạch sử dụng đất" Nghị quyết series) for the actual header vocabulary/shape before finalizing the pattern (e.g. does `Thứ tự` alone as a bare line reliably co-occur, is there a second common header shape from a different table genre elsewhere in the 81-document set).
2. Add an `inTable` boolean, following `inFooter`'s exact placement/shape: set `true` when the trigger fires (checked wherever the current node's text is being appended, since the trigger can appear mid-Khoản, not just at a container-opening line); checked immediately before the `KHOAN_PATTERN`/`DIEM_PATTERN` match attempts (skip straight to `appendText(current, line)` when `inTable`); cleared implicitly the same way `inFooter` conceptually resets — a new `Điều`/`Chương`/`Mục`/`Phần`/`Phụ lục` match already resets `stack` state via `openNode`, so `inTable` just needs to be explicitly cleared at the top of each of those branches (`dieuMatch`, `phanChuongMatch`, `mucMatch`, `tieuMucMatch`, and the `phuLucMatch` branches) — mirroring how `inFooter = false` is already reset in the `phuLucMatch` branch today.
3. **Accept the known miss:** a table row shaped like `"2. Đất lâm nghiệp"` (short real-looking words, not bare digits) would *also* be suppressed correctly once `inTable` is active (since suppression doesn't depend on the row's own shape, only on the trigger having fired) — the harder edge case this note originally flagged turns out to be a non-issue given trigger-based suppression rather than per-row shape detection. The real remaining risk is the opposite: a document whose table uses **different header vocabulary** than the calibrated trigger, which would not enter `inTable` at all and keep producing fake Khoản nodes — expected to still be caught by the existing `dedupeOrdinal` backstop as a safety net, just not actually fixed.

## Phase 2 — §12c: quoted-amendment suppression

**File:** `server/src/law-index/crawl/document-node.parser.ts`

1. Add a trigger pattern recognizing the citing sentence — e.g. `/(được\s+sửa\s+đổi|được\s+bổ\s+sung|bị\s+bãi\s+bỏ).*như\s+sau\s*:\s*"?\s*$/iu` (calibrate the exact shape against a broader sample of the 113-document candidate set — confirm "như sau:" always immediately precedes the opening quote, and whether "Bãi bỏ Điều N" without "như sau:" ever also opens a quote, per the `01/2007/UBTVQH12` sample which included a bare `"Bãi bỏ Điều 12 và Điều 13."` with **no** quote/replacement text at all — that shape must NOT trigger suppression).
2. Track quote depth via `"` parity rather than a simple boolean: increment on each unmatched `"` seen once triggered, decrement on each closing `"`, treat quoted-content suppression as active while depth > 0. This is necessary because (confirmed on `01/2007/UBTVQH12`) a single citing Khoản's quoted target can itself span many lines/fake-Khoản-shaped fragments before the quote actually closes — a simple "next line closes it" assumption would under-suppress.
3. Same suppression point as Phase 1: checked immediately before `KHOAN_PATTERN`/`DIEM_PATTERN` matching, falling through to `appendText`. Same exit path: a new `Điều`/`Chương`/`Mục`/`Phần`/`Phụ lục` match forcibly resets quote depth to 0 (an unclosed quote at that point means the source itself was inconsistent — don't let a parse anomaly suppress real structure indefinitely).
4. **Known gap, acceptable for v1:** nested quotes (a quoted Điều that itself quotes a further amendment) would still track correctly via depth-counting as long as quote characters are used consistently — not separately verified against a real sample, flag as a follow-up if the re-sync's gate check surfaces it.

## Shared verification

- **Regression tests** in `document-node.parser.spec.ts`, following the existing convention (real-shaped fixtures, not synthetic minimal cases) — at minimum: one fixture reproducing the `19/2007/NQ-CP` table shape (intro Khoản + header row + numeric fragments, assert only one Khoán node results and its text contains the fragment lines), one reproducing the `01/2007/UBTVQH12` quote shape (citing Khoản + quoted multi-clause target, assert only one Khoản node results), and one negative case per phase confirming a genuine short numbered Khoản/quote-free amendment still parses normally (don't regress the common case).
- **Corpus-wide gate**, same query already established this session:
  ```sql
  SELECT count(*) FROM (SELECT document_id, path, node_type FROM document_node GROUP BY 1,2,3 HAVING count(*)>1) t;
  ```
  Must stay 0 throughout re-sync (matches the Phase 0/§13/§15 convention already used all session).
- **Backstop-suffix count as the real signal of fix impact** (not just the gate staying 0, since the backstop already guaranteed that): baseline going into this work is 591 documents / 31,144 rows carrying a `dedupeOrdinal`-suffixed ordinal (post-§15). Expect a substantial drop after re-syncing the ~194 combined candidate documents (81 + 113, likely with some overlap) — track the before/after count as the concrete verification metric, the same way §15's 629→591 delta was the proof of that fix's real impact.
- **Re-sync scope:** union of the two candidate lists (81 §12b + 113 §12c documents, deduplicated by `sourceUrl`, per CLAUDE.md's citation-collision guidance), batched in ~50-document lots via `PUT /laws/index/crawl/batch?force=true` against the job-queue endpoint (per this session's established pattern — submit, poll `GET /laws/index/jobs/:jobId`, gate-check after each batch), through the currently-running **prod-mode** server (`node dist/src/main.js`, not `nest --watch`) to avoid the file-watch-restart collision already diagnosed once this session.
- Update `docs/monitoring/law-index-flagged-documents.md` §12b/§12c status to Resolved with the same root-cause/fix/verification structure used for §13/§14/§15, once both phases are done and re-synced.

## Deferred / explicitly out of scope

- Full correct sub-tree reconstruction for quoted or tabular content (a dedicated `document_node` per quoted sub-clause or table row) — the suppression approach intentionally discards this granularity; revisit only if a concrete retrieval need for it shows up later.
- A dedicated `table` node/content type — suppressed table content stays flat text on the enclosing Khoản.
- Any document whose table/quote uses vocabulary or punctuation not covered by the calibrated triggers — falls back to the existing `dedupeOrdinal` backstop (still safe, just not actually fixed); not chased down exhaustively in this pass.
