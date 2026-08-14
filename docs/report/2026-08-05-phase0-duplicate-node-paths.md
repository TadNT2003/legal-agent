# Report: Phase 0 — fixing duplicate `document_node` paths

**Report timestamp: 2026-08-05, 16:59 (UTC+7) / 09:59 UTC.**

> **Vietnamese version:** [2026-08-05-phase0-duplicate-node-paths.vi.md](2026-08-05-phase0-duplicate-node-paths.vi.md). This English version is canonical — prefer it where the two diverge. Section (§) numbering is 1:1 across both.

**Status: partially complete.** The code side (parser fix + backstop + tests) is done and verified. The data backfill (re-scraping the 636 affected documents) has only reached 70/636 (11%), stopped on request to report status — see §5 for what remains.

This is the status report for Phase 0 of [../plan/opensearch-projector-plan.md](../plan/opensearch-projector-plan.md) — the prerequisite before the OpenSearch projector can be built, since `document_node` needs to be unique on `(document_id, path)` for each provision's `_id` in the index to mean anything. Full technical detail (root cause, worked examples, numbers) already lives in [../monitoring/law-index-flagged-documents.md](../monitoring/law-index-flagged-documents.md) §12 — this document is a decision-oriented summary, not a duplicate of that detail.

---

## 1. At a glance

| Item | Status |
| - | - |
| Fix repeated-annex-header bug (`document-node.parser.ts`) | ✅ Done, regression-tested |
| Ordinal-collision backstop (all node types) | ✅ Done, regression-tested |
| Test suite | ✅ 128/128 pass (25 new parser tests) |
| Technical log entry (§12a/12b/12c) | ✅ Done |
| Backfill of the 636 affected documents | 🟡 70/636 (11%) — **stopped mid-run on request** |
| Corpus-wide gate check (0 duplicate `(document_id, path, node_type)` rows) | 🟡 Down from ~9,446 to 8,863 duplicate groups — not yet 0 |
| Root cause of recurring server crashes (pre-existing §11) | ⚠️ Still undiagnosed, but with more concrete data now |

---

## 2. Code changes — complete

Three changes in `server/src/law-index/crawl/document-node.parser.ts`:

1. **Fixed the repeated-annex-header bug.** When a Phụ lục (annex) has multiple subsections, each one restates the "Phụ lục N" header line — the old parser opened a new sibling node every time it saw that line again, so 21 subsections of the same annex fragmented into 21 duplicate nodes sharing the same path. Fix: a repeated header line carrying the same Roman numeral as the currently-open annex is folded into that annex's body text instead of opening a new node.
2. **Ordinal-collision backstop**, applied to every node type (Điều, Khoản, Điểm, Chương, Mục, Tiểu mục, Phụ lục): when a computed ordinal collides with an already-open sibling, a counter suffix (`1` → `1_2`) is appended to the internal value used to build the ltree path, while `label` stays exactly as parsed from the source text.
3. Two new tests in `document-node.parser.spec.ts` confirm both mechanisms work correctly, plus a test confirming a genuinely different Roman numeral still opens a new annex as expected.

Full technical detail, including analysis of two deeper root causes not fixed in this pass (tabular data misread as Khoản numbering; quoted amendment text carrying its own independent numbering — extending the scope of a previously-logged finding), is in §12 of [law-index-flagged-documents.md](../monitoring/law-index-flagged-documents.md#12-duplicate-document_node-paths--phase-0-of-the-opensearch-projector-plan-three-distinct-causes).

---

## 3. Backfill — actual progress

**70/636 documents** (11%) have been re-scraped via `PUT /laws/index/crawl/batch?force=true` and confirmed **clean (0 duplicates)** via a `sourceUrl`-scoped gate check:

- The original 20-document smoke test (stability check).
- 50 documents from batch 1/13.

**566 documents remain** (12 batches, `rbatch_001` through `rbatch_012`, 50 each, already cut and waiting). Current corpus-wide gate check: **8,863 duplicate groups** (down from a ~9,446 baseline before Phase 0 started — the reduction is disproportionately larger than the 70/636 progress ratio because a handful of the 70 processed documents carried very large duplicate counts individually, e.g. one document alone had 186 duplicate groups from a race condition — see §4).

At the observed rate (~35–45 minutes per 50-document batch when the process is followed correctly, plus time spent resolving any race-condition cases that come up), **the remaining 12 batches are estimated at ~9–11 hours of sequential processing.**

---

## 4. Most important finding: a real race condition in `syncNodes()`

Every time the server restarted itself mid-batch during this backfill (see §5), whatever document was being processed at that moment ended up with its **entire node tree inserted twice** — including Chương/Điều-level container nodes, not just Khoản/Điểm. Three concrete cases confirmed (`104/2026/NĐ-CP` — 186 groups / 372 nodes; `31/2008/NQ-CP` — 33 groups / 302 nodes; `29/NQ-CP` — 2 groups / 4 nodes).

**This is not a defect in the parser fix from §2** — confirmed by distinguishing the two possible signatures: a parser bug would leave a `_2`-style suffix on the ordinal (the backstop from §2 handling it); a race condition produces two rows with **identical** ordinals (two independent calls, each correctly numbering within its own call's scope, neither aware of the other). All three cases matched the second shape.

**Root cause:** `syncNodes()` (`document-node.repository.ts`) deletes all existing nodes and re-inserts fresh ones, with no transaction wrapping the two steps and no lock against a second concurrent call for the same `documentId`. If two `force=true` requests for the same document overlap in time — exactly what happened here, when a client-side timeout led to a retry while the server was still processing the original request — the second call's delete can run before the first call's insert loop finishes, after which both insert loops proceed independently. The result is two complete copies.

**Symptom fixed, root cause not.** Each affected document was re-synced individually (guaranteeing no overlap) and confirmed to drop to 0 duplicates. A proper fix needs a lock or transaction keyed on `documentId` in `syncNodes()` — not attempted here; flagged as separate follow-up work, outside Phase 0's scope.

---

## 5. Infrastructure issues found along the way

Not part of Phase 0's own logic, but a major factor in how long and how reliably the backfill ran — fully logged in [law-index-flagged-documents.md](../monitoring/law-index-flagged-documents.md) (§11 update, §12 note):

1. **Client-side timeout misconfigured.** `AbortSignal` does not override `undici`'s default 300s `headersTimeout` — so any batch running longer than 5 minutes threw a client-side error regardless of whether the server was working fine. Fixed by dropping `fetch` in favor of the `node:http` core module.
2. **`nest --watch` watches the entire `server/` directory, not just `src/`.** Creating scratch files under `server/` risks triggering a recompile mid-batch. All temporary files were moved out of `server/` entirely.
3. **Stopping a task does not reliably kill the actual server process** — `nest --watch` forks a child process that can outlive the parent shell being stopped. Had to find the real PID via `Get-NetTCPConnection -LocalPort 3000` and kill it directly.
4. **The server crashed and self-restarted 3 times during today's session** (PID changed each time: `35944` → `31376` → `4560`). This is a recurrence of a previously-logged, still-undiagnosed issue (§11) — but this time with more concrete data, including being the direct trigger for all three race-condition cases in §4.
5. The initial Playwright-liveness check filtered on the wrong process name (this Playwright build uses `chrome-headless-shell.exe`, not `chrome.exe`), producing false alarms — fixed.

---

## 6. Recommendations for what's next

1. **Before resuming the remaining 12 batches**, decide: is it worth pausing to investigate the server crash root cause (item 4 above) first, or proceed with the current process (run a batch → gate-check that batch → manually heal any race-condition documents → move to the next) as-is?
2. **Fixing the `syncNodes()` race condition properly** (a lock or transaction keyed on `documentId`) is worth doing soon, independently of Phase 0 — the more batches that run before it's fixed, the more manual healing accumulates.
3. At **~9–11 hours** estimated for the remaining 12 batches under the current manual, sequential process, it may be worth running this as a longer, less closely supervised background pass now that the gate-check-and-heal process has been validated against batch 1.
