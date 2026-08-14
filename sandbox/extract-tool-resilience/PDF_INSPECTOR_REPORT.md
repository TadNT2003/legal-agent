# pdf-inspector: resilience-at-scale report

Scope: **pdf-inspector only**. Second of three tool-specific reports for
`extract-tool-resilience` (docling done, markitdown follows — this report is not a
cross-tool comparison). Tests pdf-inspector's role from the prior evaluation
(`sandbox/text-extract-evaluation/REPORT.md`) — primary router/extractor for anything
not needing OCR — against a deliberately stratified 100-document sample (80 classified
digital/clean, 20 classified fully-scanned), a larger and more evenly-split sample than
the 52 opportunistic attempts the prior evaluation had.

## Executive summary

**Reliability and OCR-routing behavior are exactly as strong as the prior evaluation
found — 100/100 documents processed, zero crashes, and every scanned document correctly
routed to "needs OCR" with zero fabricated output.** But the table false-positive risk
flagged as a minor caveat last time (n=4, "4-for-4" correlation with `is_complex_layout`)
turns out to be a much bigger problem at real scale: it hits roughly **a third of clean
digital documents**, not an edge case, and the predictor that seemed clean at n=4 has at
least one confirmed counter-example at n=100.

| Finding | Result |
| --- | --- |
| Reliability | 100/100 processed, 0 crashes/errors |
| Speed | 17.7s total for 100 docs (0.177s/doc average); still effectively free |
| OCR routing correctness | 20/20 scanned docs correctly produced zero output; 80/80 clean docs produced real content |
| **Table false-positive rate** | **22/71 unique clean documents (31%)** produced a garbled pipe-table on ordinary prose — spot-checked 10, 10/10 confirmed false positives |
| `is_complex_layout` predictor | Directionally still useful (21/22 false-positive docs had it set), but not clean: found one confirmed counter-example (flag `False`, output still garbled) |
| Corpus data-quality finding | 9 of 100 sampled files are byte-identical duplicates under different `laws/manifest.json` entries — a real corpus issue, not a sampling bug |

## Setup

**Sample:** 100 PDFs — 80 classified "clean" (digital text, 0 pages needing OCR) + 20
classified "fully scanned" (100% pages needing OCR), evenly spread by file size from the
full 721-PDF census built during sandbox setup. See `samples/pdf-inspector_manifest.json`.

**Harness:** straightforward sequential loop, one `pdf_inspector.process_pdf()` call per
file, capturing status/timing/page count/confidence/`is_complex_layout`/pages-needing-OCR/
markdown output. No parallelism or checkpointing needed — pdf-inspector's per-document
cost is small enough that the entire 100-document run finishes in seconds, not hours.
See `scripts/run_pdf_inspector.py`.

## Findings

### Reliability and OCR-routing: unchanged from the prior evaluation, now at 5x the sample size

100/100 documents processed without a single crash or exception. All 20 documents
pre-classified as fully-scanned produced **exactly zero** characters of markdown output —
pdf-inspector correctly recognizes it can't extract real text and returns nothing rather
than fabricating content, precisely the "correctly detects needs OCR, doesn't attempt"
behavior the prior evaluation found. All 80 clean documents produced real,
non-trivial output (1,584 to 201,150 characters). This is a clean confirmation, not a new
finding — but it's now backed by 100 attempts instead of 52, with a deliberately
half-and-half split instead of an opportunistic one.

### A corpus data-quality finding, independent of pdf-inspector itself

9 of the 100 sampled files turned out to be **byte-identical duplicates** (verified via
MD5) sitting under two different `laws/manifest.json` entries with slightly different
generated slugs (e.g. `31-2024-QH15_luat-dat-dai-1.pdf` and `31-2024-QH15_luat-dat-dai.pdf`,
same 100% MD5 match). This means the 80-document "clean" sample is actually only 71
unique documents, not 80 — the even-by-size sampling had no way to know two manifest
entries pointed at the same content. This isn't a sampling bug (the census correctly
treated them as separate rows, matching the manifest); it's a real gap in the underlying
`laws/` corpus, most likely duplicate download events at different dates landing under
different auto-generated slugs. Worth a note for whoever owns `server/src/law/download` —
this project's manifest doesn't currently dedupe by content, only by whatever key the
crawl naturally assigns. All percentages below are reported against the 71 unique
documents, not the raw 80 slots.

### Table false-positives: a bigger problem than the prior evaluation's small sample suggested

The prior evaluation flagged this as a real but narrow risk: on 4 clean documents
specifically checked for it, 2 showed table garbling and both had `is_complex_layout: true`;
the other 2 had neither. At this scale, the picture is less clean and more concerning:

- **22 of 71 unique clean documents (31%)** produced a markdown pipe-table
  (`has_table: true`).
- Spot-checked 10 of them directly against their source — **10/10 were false positives**:
  ordinary running legal prose (multi-sentence `Điều`/`Khoản` clauses) split arbitrarily
  across table cells, in every case, not real tabular data. One example splits a word
  mid-syllable: `"...229 Kinh doanh d|ịch vụ lưu trữ|"` — `"dịch"` cut into `"d"` and
  `"ịch"` across a cell boundary. Another wraps 1,400+ characters of continuous statutory
  text — several full sentences — into a single 5-column row.
- 21 of the 22 false-positive documents had `is_complex_layout: true`, matching the
  prior evaluation's predictor. But **one confirmed counter-example** broke the clean
  correlation: `33-2024-QH15` (Luật Lưu trữ) produced the same kind of garbled table
  (`"...229 Kinh doanh d|ịch vụ lưu trữ|"`, the example above) with `is_complex_layout:
  false`. At n=4 this predictor looked perfect; at n=71 it's a strong signal, not a
  reliable gate.
- No genuinely correct table was found among the 10 spot-checked — this sample gives no
  positive evidence that pdf-inspector's table detection ever fires correctly on this
  corpus's actual document shapes (predominantly single-column running legal prose with
  occasional two-column letterhead blocks), only evidence of how it fails.

Practical read: this isn't a corner case to gate around with one boolean flag and move
on — it's close to a 1-in-3 chance that a "clean" digital document renders with a bogus
table somewhere in it, and the existing predictor catches most but not all instances of
it.

### Speed: still effectively free

17.7 seconds total for 100 documents (0.177s/doc average, individual range 0.0097s -
4.41s). Consistent with the prior evaluation's "sub-100ms, up to ~0.23s when generating
real markdown" — the slowest documents here are large multi-hundred-page files, still
trivial next to any OCR-based alternative.

## Verdict

pdf-inspector's core value proposition from the prior evaluation is intact and now
better-evidenced: it's fast, it never crashes, and it correctly refuses to fabricate
content on scanned input rather than guessing. It remains the right default router for
anything not needing OCR.

But the table false-positive rate is a real, now well-quantified cost of trusting its
markdown output unconditionally: roughly a third of clean digital documents in this
corpus contain at least one place where continuous prose gets wrongly rendered as a
garbled table. The prior evaluation's mitigation — gate on `is_complex_layout`, route
flagged documents for cross-check — still holds directionally (21/22 cases had the flag
set), but the one counter-example found here means it isn't a complete gate on its own.
Given the scale of the problem (~31%, not a handful of edge cases), this isn't a niche
follow-up anymore — it's central enough to the tool's real-world reliability on this
corpus to warrant either a better detection heuristic or treating every
`pdf_inspector`-generated table as unverified by default, regardless of the
`is_complex_layout` flag, until a stronger signal is found.

## Files

- `samples/pdf-inspector/`, `samples/pdf-inspector_manifest.json` — the 100-doc sample
  (80 clean / 20 scanned slots, 71/20 unique after dedup) and its scan-status metadata
- `outputs/pdf-inspector/*.md` — per-document markdown output
- `outputs/pdf-inspector/_timings.json` — per-document status/timing/flags (the source
  of every number in this report)
- `scripts/run_pdf_inspector.py` — the evaluation harness
