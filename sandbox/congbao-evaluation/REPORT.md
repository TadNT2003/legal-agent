# congbao.chinhphu.vn + pdf-inspector: extraction viability report

Scope: does a lightweight PDF text extractor (pdf-inspector) suffice for congbao's
whole PDF archive, as `docs/plan/congbao-source-evaluation.md` (main repo) concluded
from a single manually-inspected document? Tests that conclusion against a random,
independently-sampled 200-document set spanning the full ~2010-2026 archive.

## Executive summary

**The core conclusion holds, with real, now-quantified exceptions.** 200/200 PDFs
processed without a crash. 77.5% of documents are 100% native digital text needing
no OCR at all. But two things the single-document check couldn't have found: a small
number of documents (2/200, ~1%) are genuinely fully scanned images despite living in
the "digital PDF" archive, and a distinct font-encoding defect (broken Unicode
mapping for some Vietnamese diacritic glyphs, unrelated to scanning) silently
corrupts text in 33/200 documents — severely in 2 of them, negligibly in the other
31. Both defects are real properties of specific PDFs on congbao, not scraping
errors — every document was already independently confirmed correct by citation in
the Eval-01 verification pass.

| Finding | Result |
| --- | --- |
| Reliability | 200/200 processed, 0 crashes/errors, 23.65s total (0.118s/doc avg) |
| Fully native digital text (0 pages needing OCR) | 155/200 (77.5%) |
| Some pages needing OCR | 43/200 (21.5%), 4.65% of all 4,131 pages total |
| Fully scanned (100% of pages) | 2/200 (1%) — a real exception to "congbao's PDF archive is never scanned" |
| **Text corruption** (broken font ToUnicode CMap, unrelated to scanning) | 33/200 (16.5%) show *some* corruption signal; only 2/200 (1%) are severely corrupted (>1% of characters) |
| Table false-positive rate (`has_table`) | 49% flagged; spot-check suggests a genuine mix (not mostly false positives, unlike the `laws/` corpus) |

## Setup

**Sample:** the 200 PDFs from Eval-01 — random citations, one per weighted-random
(type, target-date) draw, spanning 2010-2026, downloaded via the binary-search
citation-lookup method (see `docs/plan/congbao-source-evaluation.md`). Every one of
the 200 was independently confirmed to be the document its recorded citation claims
(see Eval-01's `verify_citation_match.py`, 200/200 after fixing the checker itself
through three iterations) — so anything found here is a property of the PDFs
themselves, not a wrong-document artifact.

**Harness:** `scripts/eval02_run_pdf_inspector.py` — one `pdf_inspector.process_pdf()`
call per file, capturing the same fields as
`sandbox/extract-tool-resilience/scripts/run_pdf_inspector.py` for comparability
(status, elapsed, page count, confidence, `is_complex_layout`, `has_encoding_issues`,
pages-needing-OCR, markdown length, `has_table`), plus congbao-specific context from
Eval-01's manifest (citation, type, issued date). `scripts/analyze_eval02.py` is the
post-hoc analysis (OCR distribution + the corruption scan below — corruption isn't
something pdf-inspector reports itself, see the next section for why).

## Findings

### Reliability: clean, consistent with the prior evaluation

200/200 processed without a single crash or exception, 23.65s total. Comparable
per-document speed to the prior `extract-tool-resilience` finding on the `laws/`
corpus (0.118s/doc here vs. 0.177s/doc there).

### OCR need is real but small — and NOT simply "old documents are scanned"

155/200 documents (77.5%) have zero pages needing OCR — fully native digital text,
confirming the general shape of the earlier single-document check. But 45/200 have
*at least one* page needing OCR, and importantly **this doesn't cleanly track the
2010-2016 pre-DOCX era** the earlier recon used as a rough proxy for "might not be
digital" — partial-OCR documents show up as recently as 2023-2025
(`quyet-dinh-so-1386-qd-ttg-40510.pdf`, 9/95 pages; `nghi-quyet-so-99-nq-cp-39788.pdf`,
5/14 pages), not just in the older tail. Most likely cause, not independently
confirmed here: individual scanned attachments/annexes (a signed cover memo, a scanned
map, an externally-sourced appendix) embedded into an otherwise fully-typeset
document, rather than the whole document being scanned.

**2 documents are classified fully scanned (100% of pages)**:
`thong-tu-so-04-2020-tt-btttt-30810.pdf` and `thong-tu-so-79-2022-tt-bqp-38213.pdf`.
This is a direct, concrete exception to "congbao's PDF archive is never a scan" —
rare (1%), but real, and both are well inside the supposedly-safe DOCX-available era
(2020, 2022), so era alone isn't a reliable predictor of which documents need OCR.

### A distinct, unexpected finding: broken font encoding corrupts a subset of documents' text — independent of scanning

This is not something pdf-inspector's own `has_encoding_issues` flag reliably
surfaces — it was checked directly against 3 flagged documents and found clean in
all 3 (see "Files" below for the detection script). Found instead by manually
reading pdf-inspector's markdown output for the "fully scanned"
`thong-tu-so-04-2020-tt-btttt-30810.pdf` and noticing systematic garbling
(`"Số"` → `"S<REPLACEMENT>"`, `"Bộ"` → `"B<REPLACEMENT>"`) even though the same
document has **zero embedded images and 111 font references** — i.e. it is
definitionally not a scan. Cross-checked directly against `pdfplumber`'s own
extraction of the same PDF (independent of pdf-inspector), which showed the identical
defect as `(cid:1237)`-style unmapped-glyph references — confirming this is a real
property of the PDF's embedded font (an incomplete `/ToUnicode` CMap for some
Vietnamese precomposed characters), not an artifact of either extraction tool.

A second, harder-to-spot manifestation of the *same* root cause was found while
spot-checking table output: `nghi-quyet-so-229-nq-cp-45810.pdf` renders "KHÁC" as
"KH¡C" — not a missing-mapping replacement character, but a **wrong** one
(U+00A1 "¡" is exactly 0x20 below the correct U+00C1 "Á"). A CMap entry that's wrong
rather than absent produces a plausible-looking but incorrect character instead of a
visible failure marker — the more dangerous variant, since nothing about the output
signals "this might be wrong."

Scanning every one of the 200 markdown outputs for both signatures
(`scripts/analyze_eval02.py`):

- **33/200 (16.5%)** show at least one occurrence of either signature.
- Severity is sharply bimodal, not a smooth distribution:
  - **2/200 (1%)** are severely corrupted — 12.8% and 2.4% of all characters
    respectively (`thong-tu-so-04-2020-tt-btttt-30810.pdf` and
    `thong-tu-so-34-2015-tt-btnmt-16336.pdf`). Both of these are also the two
    documents with the most OCR-needed pages, suggesting the same underlying
    font/rendering problem manifests as both symptoms together on the worst-affected
    documents.
  - **31/200 (15.5%)** have only trace corruption — typically 1-80 stray characters
    inside tens of thousands, well under 0.3% and mostly under 0.05%. Practically
    negligible for corpus/retrieval purposes, but non-zero, and this class would be
    invisible to any check (like Eval-01's own citation verification) that only
    examines a citation number, since citation numbers are plain ASCII and never hit
    a broken diacritic mapping.
- **167/200 (83.5%)** show no corruption signal of either kind.

### Table false-positives: a real risk, but not dominant on this corpus

49% of documents produced a markdown table (`has_table`), well above the 31% the
prior `extract-tool-resilience` evaluation found on the `laws/` corpus. Manually
spot-checked 8 random `has_table` documents plus 2 more found opportunistically
while investigating other findings:

- **2 genuinely correct tables** — a real province-by-region appendix list
  (`van-ban-hop-nhat-so-01-vbhn-bnv-28945.pdf`) and a real task/agency/timeline plan
  (`quyet-dinh-so-225-qd-ttg-19068.pdf`), both with intact, correctly-aligned rows.
- **2 partially-correct tables** — genuine tabular subject matter (a customs tariff
  schedule, a toll-fee schedule) with the right table *detected*, but cell boundaries
  scrambled badly enough that row/column association is lost (prices and vehicle
  categories end up in the wrong cells).
- **1 boilerplate table**, correctly rendered — the standard "Văn phòng Chính phủ"
  publisher-contact footer that closes every Gazette issue (only 3/98 `has_table`
  documents are driven by this alone, so it isn't the main cause of the elevated rate).
- **3 clear false positives** — ordinary running prose (a numbered `Điều`/`Khoản`
  clause, an emulation-program list item) split arbitrarily into fake table cells,
  the same failure pattern the prior evaluation characterized on `laws/`.

Unlike the prior evaluation's "10/10 confirmed false positives," this small sample
suggests congbao's higher `has_table` rate is at least partly explained by the corpus
genuinely containing more real tabular content (fee schedules, appendix lists,
project plans are common in Nghị định/Thông tư/Quyết định annexes) — not purely a
worse false-positive rate. Sample size here (10) is too small to put a real number
on the true/false split with confidence; treat as directional, not conclusive.

## Verdict

The original single-document conclusion — "a lightweight extractor, not
docling/OCR, suffices for congbao" — survives contact with a proper random sample,
but two caveats now have real numbers instead of being purely theoretical:

1. **~1% of documents are genuinely scanned** and need the same OCR path
   vanban.chinhphu.vn's documents already require. Not negligible at any real corpus
   scale, and era (pre/post the DOCX-availability boundary) doesn't reliably predict
   which ones.
2. **A font-encoding defect, unrelated to scanning, silently corrupts a meaningful
   minority of documents (16.5% show it, 1% severely).** This is arguably the more
   important finding: it's invisible to a citation-only correctness check (ASCII
   citations don't hit it), it isn't reliably flagged by pdf-inspector's own
   `has_encoding_issues` field, and its worse variant (wrong-but-plausible character
   substitution) produces no visible failure signal at all in the output. Any
   pipeline built on plain PDF text extraction for congbao should scan its own output
   for this class of defect rather than trust silence — `analyze_eval02.py`'s
   detection approach (scan for U+FFFD, bare `(cid:N)` references, and stray Latin-1
   Supplement punctuation outside the small legitimate Vietnamese-letter set) is a
   reasonable starting point.

Table false-positives remain a real but apparently smaller problem on this corpus
than on `laws/`, based on a small spot-check — worth a larger dedicated sample before
trusting `pdf_inspector`-generated tables unconditionally, same caveat the prior
evaluation already raised.

### These caveats argue for a targeted VLM fallback, not a wholesale VLM pipeline

It would be a natural but wrong reading of the above to conclude congbao needs the
same VLM pipeline (currently under evaluation via docling — `sandbox/extract-tool-
resilience`, `sandbox/text-extract-evaluation`) that vanban.chinhphu.vn's
`DOCUMENT_TEXT_EXTRACTOR` is waiting on. It doesn't, at least not as the default path.
Running every congbao document through a VLM would throw away the exact thing that
makes congbao worth having over vanban.chinhphu.vn as a source: vanban needs OCR/VLM
on **100%** of documents, every time, because it has no server-rendered text and no
digital-PDF path at all (see `docs/plan/congbao-source-evaluation.md`'s comparison
table). Congbao needing it on ~5% of pages, concentrated in an identifiable minority
of documents, is a fundamentally different cost profile — and it's the one place
pdf-inspector's own `pages_needing_ocr` field already seems designed to support: route
only what needs it, not everything.

The shape this argues for is a **tiered pipeline, not a swap**:

1. **DOCX/DOC parsing first, when available** (~2017-onward per the source-evaluation
   doc's bisection) — cleaner than any PDF path, VLM included, and matches
   `document-node.parser.ts`'s Chương/Điều/Khoản/Điểm structure more directly than
   reconstructed PDF line breaks would.
2. **pdf-inspector as the default for the PDF-only era and any DOCX-parse failures** —
   fast, reliable (0 crashes across 200 documents here), and correct on the large
   majority of content (77.5% of documents needed nothing further at all).
3. **VLM invoked only when routed there**, by two independent signals, not one:
   - pdf-inspector's own `pages_needing_ocr` (the scanned-page case), and
   - a corruption detector run over pdf-inspector's *own output*, since the
     font-encoding defect doesn't reliably self-report via `has_encoding_issues` —
     `analyze_eval02.py`'s approach is a reasonable starting point, not a finished
     tool.

Tables are the one area this report can't yet resolve either way — the false-positive
rate on this corpus looks meaningfully better than on `laws/`, but n=10 is too small
to commit to a threshold. Worth a dedicated, larger sample before deciding whether
`has_table` should also trigger a VLM re-check, independent of the OCR/corruption
routing above.

### The relations graph, not extraction cost, may be the bigger differentiator vs. vanban.chinhphu.vn

Independent of all of the above, congbao has something vanban.chinhphu.vn cannot
supply by any extraction-tool improvement: a real, populated relationship graph
("Lược đồ" — confirmed live, e.g. a Nghị định correctly linking to the later decree
that superseded it; see `docs/plan/congbao-source-evaluation.md`). vanban.chinhphu.vn
produces **zero `document_reference` rows, ever, by design** — that gap is structural,
not a tooling gap, and no amount of better OCR/VLM on vanban's side closes it. Combined
with the OCR-cost asymmetry above (congbao: ~5% of pages; vanban: 100% of documents),
congbao looks like a strict upgrade over vanban.chinhphu.vn as the supplementary
source on both dimensions this project actually needs — full text *and* relations —
not just the one this report measured.

## Files

- `samples/*.pdf`, `samples/manifest.json` — the 200-document sample from Eval-01
- `samples/citation_match_check.json` — Eval-01's independent citation-correctness
  verification (200/200), establishing that findings here are properties of the PDFs,
  not wrong downloads
- `outputs/*.md` — per-document pdf-inspector markdown output
- `outputs/_timings.json` — per-document status/timing/flags from the pdf-inspector run
- `outputs/analysis_summary.json`, `outputs/corruption_detail.json` — the OCR and
  corruption analysis this report is based on
- `scripts/eval02_run_pdf_inspector.py` — the evaluation harness
- `scripts/analyze_eval02.py` — the OCR-distribution and corruption-scan analysis
