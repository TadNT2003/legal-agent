# docling + EasyOCR(vi) page-by-page: table-heavy resilience-at-scale report

Scope: **docling only**. First of three tool-specific reports for `extract-tool-resilience`
(pdf-inspector and markitdown follow separately, per request — this report is not a
cross-tool comparison). Tests the OCR-fallback configuration the prior evaluation
(`sandbox/text-extract-evaluation/REPORT.md`) recommended — docling + EasyOCR(`lang='vi'`),
page-by-page — against 50 scanned PDFs specifically selected for table density, at a scale
(909 pages) the prior evaluation never exercised for tables.

## Executive summary

**The configuration is reliable at scale but has a table-density-correlated correctness
problem the prior evaluation never surfaced.** All 909 pages across all 50 documents
eventually completed with zero per-page OCR errors — the page-by-page crash fix from the
prior evaluation held. But table density turns out to predict a second, more serious
failure mode than the previously-known word-order bug: **the denser a page's table
grid, the more of its Vietnamese diacritics EasyOCR simply fails to produce.**

| Finding                                           | Result                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reliability (pages)                               | 909/909 (100%) — 0 per-page errors                                                                                                                                                         |
| Reliability (infra)                               | 2 whole-pool crashes (`BrokenProcessPool`), both auto-recovered via checkpointing — 0 pages lost                                                                                         |
| Speed                                             | 18.6 s/page (low table density) to 166.8 s/page (highest table density) — a 9× range driven by table complexity, not scan quality                                                         |
| **Diacritic correctness vs. table density** | **Pearson r = -0.641.** 17/50 docs (34%) severely degraded (<40% of healthy diacritic density); 8/50 (16%) near-total failure; 1/50 complete failure (672,131 chars, zero diacritics) |
| Table structure                                   | Simple 2-3 column tables: structure + labels mostly usable. Dense multi-column (7+) financial tables: structure captured, but many cell contents dropped blank                              |
| Word-order bug (from prior eval)                  | Still present, unchanged, confirmed at this scale too                                                                                                                                       |

This doesn't overturn the prior evaluation's recommendation for prose-dominant content —
it identifies a real gap specific to dense tabular content that the prior, more
prose-weighted sample didn't have enough table-heavy documents to catch.

## Setup

**Sample:** 50 scanned PDFs, 909 pages total (min 4 / median 13 / max 163 pages/doc),
selected by an OpenCV ruled-gridline heuristic (render each page, morphological-open to
isolate long horizontal/vertical lines, count grid intersections) run across all 597
scanned PDFs in the `laws/` corpus and ranked by total intersections. Validated against
`246/2025/QH15` (confirmed in the prior evaluation to contain a real table): scored
21,118 vs. single/low-double-digit scores on prose-only documents — a clean 2-3
order-of-magnitude separation. Top 50 selected (scores 294-49,161). See
`sandbox/extract-tool-resilience/scripts/detect_table_gridlines.py` and
`docling_manifest.json`.

**Harness:** one `DocumentConverter` per worker (`EasyOcrOptions(lang=['vi'], use_gpu=False)`),
pages processed one at a time (`page_range=(i,i)`) per the prior evaluation's crash fix.
50 documents split round-robin into 5 chunks of 10 (so each chunk mixes heavy/light
documents rather than clustering all the slow ones together), run through a
`ProcessPoolExecutor`. Each chunk checkpoints every single page to its own
`outputs/docling/_chunk{N}_timings.json`, so a crash costs only in-flight work, not
progress already on disk. See `scripts/run_docling_parallel.py`.

**Parallelism:** started at 5 workers per the original request; measured real per-process
memory footprint first (~1.1GB RSS once docling+EasyOCR models are loaded, stable across
pages — consistent with the prior evaluation's finding that page-by-page chunking
prevents *within-process* memory accumulation). Only 5.2GB RAM was free at the time
(Postgres/OpenSearch/Neo4j/ChromaDB/Redis docker stack + dev server already resident);
stopping non-essential containers didn't help, since Docker Desktop's WSL2 VM doesn't
release memory back to Windows just because containers inside it stop. Settled on 4
workers, later stepped down to 3 after an empirical crash (below).

## Reliability: two whole-pool crashes, zero data loss

**First attempt (4 workers, no auto-retry):** ran 9,022s (~2.5h), then all 4 workers died
simultaneously — `BrokenProcessPool: A process in the process pool was terminated abruptly while the future was running or pending.` Checkpointing meant this cost nothing
but time: 384/909 pages (42%) were already safely on disk, zero errors among them.

Root cause was not conclusively identifiable: checked Windows System and Application
event logs for OOM, application-crash (Event ID 1000), and sleep/wake events in the
crash window — found none of the three. Windows doesn't log user-mode allocation
failures deep in native code (torch/EasyOCR/OpenCV C++ extensions) the way Linux's
OOM-killer logs to dmesg, so the absence of an event doesn't rule out memory pressure —
it just means there's no smoking gun either way.

**Second attempt (3 workers + auto-retry-until-complete wrapper):** the harness was
changed to retry incomplete chunks in a loop (up to 8 passes) rather than require manual
intervention. Pass 1 crashed the *same way* — all 5 chunks, `BrokenProcessPool`, again
with no OS-log signal. Pass 2 (automatic, no intervention needed) finished everything:
909/909 pages, 50/50 docs, 0 errors, 8,607.9s (~2.4h) for pass 2's own share of the work.

**Total across both attempts:** ~4.9h wall-clock, two full-pool crashes, zero pages lost
to either one. A new finding this run surfaces: the crash pattern (all workers dying
*together*, not just one) is consistent with peak-load memory contention specifically —
and this run's documents are, by construction, the most table-dense in the corpus, which
independently turned out to be both the slowest *and* (see below) most compute-intensive
pages via docling's table-structure-recognition stage. Concurrent processing of several
workers' worst-case pages at once is a plausible aggravating factor beyond the tight
RAM margin already flagged before starting. This is not proven, only consistent with the
evidence — worth testing at 2 workers if it recurs.

**Takeaway for anyone reusing this harness:** the checkpointed-chunk + auto-retry design
worked exactly as intended. A crash rate of 2-for-2 attempts on this table-heavy,
memory-constrained combination is high enough that the auto-retry wrapper should be
considered required, not optional, for any run of this size — treat single-pass
completion as the exception, not the assumption.

## Speed: table density predicts processing time, not scan quality

|                  | sec/page                                      |
| ---------------- | --------------------------------------------- |
| Fastest document | 18.6 (`27/2016/QH14`, table_score 294)      |
| Slowest document | 166.8 (`223/2025/QH15`, table_score 48,789) |
| Median           | ~65                                           |

The fastest and slowest deciles separate almost perfectly by table_score — every one of
the 10 fastest documents has table_score < 3,600; every one of the 10 slowest has
table_score > 12,000. This is a different mechanism than the prior evaluation's
clean-text-layer-skip speedup (1.1-1.3s/page there): all 50 documents here are
pdf-inspector-classified "fully scanned," so none benefit from that shortcut. The
variance instead tracks how much work docling's table-structure-recognition stage has
to do — dense grids mean more candidate cells to resolve, independent of whether the
underlying text is easy or hard to read.

The single biggest time sink by far: `74/2022/QH15`, 163 pages (more than 3× the next
largest document), 7,567.9s total — 13.4% of this run's entire compute time from one
document. It's also the document with the most severe correctness failure (next
section), which is unlikely to be a coincidence given both trace back to the same
underlying pipeline stages.

## The headline finding: table density collapses diacritic correctness

Vietnamese diacritics are semantically load-bearing (`ma`/`má`/`mà`/`mã`/`mạ` are five
different words) — this was the central correctness axis in the prior evaluation, and
EasyOCR(vi) was that evaluation's fix for it. This run found a real limit to that fix.

**Method:** counted Vietnamese-diacritic characters as a fraction of total output
characters per document (regex over precomposed diacritic letters). Verified this isn't
a Unicode-normalization artifact before trusting it — the project has a known prior NFD/NFC
bug (`docs/monitoring/law-index-flagged-documents.md` §16) so this was checked directly:
zero U+0300-U+036F combining marks in the low-scoring outputs, and re-running NFC
normalization changes nothing. The characters genuinely aren't diacritics — spot-checking
the worst document's actual output shows stray Latin-1 symbols (`£ § © « ® · » • € ■`)
in place of accented letters, a real OCR misrecognition, not an encoding artifact.

**Result:** Pearson correlation between table_score and diacritic ratio across all 50
documents: **r = -0.641** — a strong, statistically clear relationship, not noise. Docs
below table_score ~1,500 mostly sit in the healthy 0.10-0.20 diacritic-ratio range
(matching normal Vietnamese text density); docs above ~10,000 mostly collapse to
0.02-0.09.

- **17/50 (34%)** below 0.06 (under 40-60% of healthy density)
- **8/50 (16%)** below 0.03 (near-total failure)
- **1/50** complete failure: `74/2022/QH15` — 672,131 characters, **zero** diacritic
  characters anywhere in the entire 163-page document. Example line: `"Can cu Hien phdp nuac Cong hoa xd hoi chit nghia Viet Ham"` (should read `"Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam"`) — every diacritic-bearing word either stripped bare or
  substituted to a different plain letter.

Even the run's own validation document, `246/2025/QH15` (table_score 21,118, confirmed
in the prior evaluation to have correct diacritics on its table) — comes in at 0.083,
below the healthy baseline. A quick visual skim of it (see below) still reads as "mostly
correct Vietnamese," which is exactly the risk: **the degradation is severe enough in
aggregate to be a real data-quality problem, but not always severe enough to be obvious
on casual inspection** — it needs the character-density check, not a skim, to catch
reliably.

This did not appear in the prior evaluation because that evaluation's 11-document/295-page
OCR subset wasn't selected for table density — it happened to contain few genuinely
dense tables, so this failure mode had no opportunity to show up. It is a genuine gap in
this project's understanding of the pipeline, not a regression — the earlier "diacritics
fixed" conclusion is still correct for prose-dominant content; it just doesn't generalize
to table-dense content the way the prior report implied it might.

**Root-cause hypothesis (not confirmed):** dense grid tables likely produce narrow,
tightly-bounded per-cell text regions during layout analysis, which is a harder
recognition task for EasyOCR than free-flowing paragraph text with more surrounding
context. Untested, but consistent with the correlation and with per-cell content loss
observed directly in the table-fidelity check below.

## Table structure fidelity: correct shape, inconsistent content

Two documents at opposite ends of table complexity, both spot-checked directly against
their rendered markdown output:

**`246/2025/QH15`** (simple, 3-column: STT | Nội dung | Dự toán) — row labels and numbers
are mostly captured and correctly aligned column-to-column:

```
| STT | NỘI DUNG                                              | DỰ TOÁN   |
| A   | CHI BỎ SUNG CÂN ĐÓI CHO NSĐP                          | 238.421   |
|     | Chi đầu tư phát triển                                 |           |
| 2   | Chi an ninh và trật tự an toàn xã hội                 | 152.190   |
```

Still shows the prior evaluation's known word-order bug within multi-word cells (e.g.
`"Chi khoa học, nghệ, đổi mới tạo và chuyển đổi số công sáng"` — `"công nghệ"` and
`"sáng tạo"` scrambled — should read `"Chi khoa học, công nghệ, đổi mới sáng tạo và chuyển đổi số"`), confirming that bug is genuinely orthogonal to the new one and persists
unchanged at this scale.

**`132/2024/QH15`** (dense, 7+ numeric columns, budget reconciliation table) — table
*structure* (row/column shape) is captured as a real pipe-table, but a meaningful
fraction of cells are simply blank where a row label should be:

```
| STT | NỌl DUNG | DỰ TOÁN     |           |           |           |
|     | [Thu NSNN|             |           |           |           |
| 2   |          | 1.178.408   | 1.447.915 | 565.362   | 882.553   |
|     |          | 28.200      | 78.137    | 78.137    |           |
```

Rows with only numbers and no label are unusable without the label — this is a
different, worse failure mode than diacritic stripping: content loss, not just character
corruption. Table complexity (column count, cell density) appears to degrade content
capture, not just diacritic accuracy — consistent with, and probably the same underlying
mechanism as, the diacritic-density correlation above.

## Metrics

**Reliability:** 909/909 pages (100%), 50/50 docs (100%), 0 per-page OCR errors, 2/2
whole-pool infrastructure crashes recovered automatically via checkpointing with 0 pages
lost either time.

**Speed:** 56,587.9s (15.72h) total OCR compute time summed across pages; ~4.9h actual
wall-clock across both attempts (3-4 workers minus crash/restart overhead) — roughly a
3.2× effective speedup from parallelism. Range 18.6-166.8 s/page, strongly correlated
with table_score (see above). Single biggest cost: `74/2022/QH15` at 7,567.9s (13.4% of
total compute) for 163 pages.

**Correctness:** diacritic-density ratio ranges 0.0000-0.20 across the 50 documents
(healthy baseline ~0.10-0.20), Pearson r = -0.641 against table_score. Word-order bug
from the prior evaluation confirmed still present, unchanged, orthogonal to the new
diacritic-collapse finding.

**Table fidelity:** structure (row/column shape, pipe-table syntax) captured correctly
regardless of complexity; content fidelity degrades with column count / cell density —
simple tables mostly usable, dense financial tables lose row labels to blank cells.

## Verdict

docling + EasyOCR(vi) page-by-page remains the only tested configuration that reliably
*completes* on this corpus's scanned Vietnamese content — that finding from the prior
evaluation holds and is now confirmed at real scale (909 pages, two infrastructure
crashes, zero data loss). But this run adds a real, previously-unknown qualifier: **its
correctness guarantee only holds for prose-dominant content.** On the specific slice of
documents that actually carry the most information-dense tabular data — tax schedules,
budget allocations, appendix tables, exactly the content most valuable to get right in a
legal-document RAG corpus — diacritic and content fidelity degrade sharply and
unpredictably as table density increases.

This means the pipeline recommended in the prior report needs a qualifier, not a
reversal: it's still the right default for OCR fallback, but a document (or page) that
scores high on the table-gridline heuristic built for this evaluation should be treated
as needing extra scrutiny or a different handling path, not trusted at the same
confidence level as prose pages. `sandbox/extract-tool-resilience/scripts/detect_table_gridlines.py`
is itself a candidate for that gating role, having already proven a strong, cheap,
pre-OCR signal for exactly this risk.

Untested next steps, not yet actioned: whether `TesseractOcrOptions` (proposed but never
tested in the prior report for the word-order bug) also helps or hurts on dense tables;
whether increasing render DPI specifically for high-gridline-score pages improves cell
segmentation; whether docling's separate VLM pipeline (`ApiVlmOptions`/`InlineVlmOptions`,
confirmed to exist but not benchmarked anywhere in this project) handles dense tables
better, since it isn't built on the same layout-then-OCR-per-region architecture that
this finding implicates.

## Files

- `samples/docling/`, `samples/docling_manifest.json` — the 50-doc/909-page sample and
  its table-gridline scores (gitignored samples, tracked manifest)
- `outputs/docling/*.md` — per-document combined markdown output
- `outputs/docling/_chunk{0-4}_timings.json` — per-page checkpoint/timing data (the
  source of every number in this report)
- `docling_results_summary.json` — per-document aggregate (pages, time, chars, table_score)
- `scripts/detect_table_gridlines.py` — the table-density triage heuristic
- `scripts/run_docling_parallel.py` — the checkpointed/auto-retry parallel harness
- `scripts/aggregate_docling_results.py` — timing aggregation used for this report
