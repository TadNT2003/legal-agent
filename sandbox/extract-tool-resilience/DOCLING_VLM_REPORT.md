# docling + local VLM, page-by-page plain text: exploratory report

Scope: **docling only, VLM pipeline**, exploratory and supplementary to
`DOCLING_REPORT.md` (the EasyOCR-based evaluation on the same 50-doc/909-page
sample). Not a strict apples-to-apples replacement for that report — this
documents a different pipeline architecture that emerged through active
investigation, including three real bugs found and fixed or newly identified
along the way (one in docling's own table export, two in this project's
production parser). Where `DOCLING_REPORT.md` tested `docling + EasyOCR(vi)`,
this report tests `docling`'s separate `VlmPipeline` against a self-hosted
model, with a materially different downstream design: instead of asking the
model to produce structure-aware Markdown/HTML, it's asked to transcribe
plain text and hand structure-recovery to the project's existing production
parser. 47 of the 50 sample documents completed with the final configuration.

## Executive summary

**The core hypothesis — plain-text transcription plus the existing
`document-node.parser.ts` parser, no structural tagging required — is
validated with real evidence, not just a proof of concept.** 47 of 50
documents completed with a stable, tuned configuration; all 47 parsed through
the real production parser with zero exceptions, recovering 331 Điều, 1,115
Khoản, 554 Điểm, 144 Phụ lục, and genuine multi-level Chương/Phần/Mục
hierarchy where present. Getting here required working through several real,
non-obvious failure modes — a cloud model silently dropping pages to content
filtering, a reasoning model's hidden "thinking" tokens, a table-format bug
in docling's own export layer, two page-transcription bugs, and — found only
once the full sample ran — a second, more consequential gap in the
production parser itself, where "zero exceptions" did not mean "zero silent
content loss." Each finding is diagnosed with direct evidence rather than
assumed fixed.

| Finding | Result |
| --- | --- |
| Structural reconstruction (final config) | 47/47 parsed, 0 exceptions — but see the parser-coverage gap below; exception-free is not the same as content-complete |
| Aggregate structure recovered | 331 Điều, 1,115 Khoản, 554 Điểm, 144 Phụ lục, 20 Chương, 1 Phần, 9 Mục |
| Cloud VLM (Gemini via gateway) | Rejected — silently dropped 5/9 pages to content filtering, undetectable without item-level provenance checks |
| Local VLM (reasoning model) | Viable once `reasoning_effort: "none"` is set; needs a large `max_tokens` budget regardless |
| Table format | Native Markdown pipe-tables can't represent merged cells; HTML with real `colspan`/`rowspan` works, but only via `table.export_to_html()` — docling's own `export_to_markdown()` has a bug that corrupts spanning tables |
| Architecture | Whole-document single-request → reverted to true per-page once plain text (no tags) removed the reason for batching pages together |
| **New parser-coverage gap** | A real Nghị quyết with no `Điều` wrapper at all (substantive content directly under `"QUYẾT NGHỊ:"` as bare numbered items) has its entire body — 319 lines — silently dropped; the parser has no fallback for this valid, real structural variant |
| **Open risk** | 3/50 documents fail outright (300s+ gateway/network timeouts on individual dense pages, not fully deterministic per document); citation-number hallucination found once, not re-verified at this config; table *content* correctness not verified at scale |

## Setup

**Gateway:** Bifrost (LiteLLM-style), OpenAI-compatible `/v1/chat/completions`,
configured via `sandbox/extract-tool-resilience/.env` (not committed — see
root `.gitignore`). Two models tested across this investigation:

- **Cloud:** `gemini/gemini-3.1-flash-lite` — rejected, see Findings.
- **Local/self-hosted:** `SDS-AI/softdream`, a reasoning-capable model served
  via vLLM behind the same gateway — used for every result reported here.

**Test documents:** primary single-document deep-dive on `128/2020/QH14`
(9 pages, table_score 2055 — the median-complexity document from
`DOCLING_REPORT.md`'s table-heavy sample, chosen as a genuinely "average"
case, not cherry-picked). Scale test on the same 50-document/909-page sample
used throughout `extract-tool-resilience` (`samples/docling/`,
`docling_manifest.json`).

**Wiring:** docling's `VlmPipeline` + `ApiVlmOptions` for early experiments
(`enable_remote_services=True` required — docling refuses remote calls by
default). The final scale-test harness bypasses docling's pipeline entirely
in favor of a custom script driving the API directly — see Findings for why.

## Findings

### Cloud VLM: silently drops pages to content filtering, not a viable default

First full-document test on Gemini looked clean at the surface level —
`ConversionStatus.SUCCESS`, correct 9-page count, 11,312 characters of
well-formed output. Direct verification (mapping every content item back to
its source page via `item.prov[0].page_no`) told a different story: **pages
1-5 had zero content items** — no `TextItem`, no `TableItem`, nothing. Only
the 4 appendix tables (pages 6-9) came through.

Root cause, confirmed by hitting the gateway directly and inspecting the raw
JSON: pages 1-5 returned `finish_reason: content_filter` — Gemini's safety
classifier blocked generation outright on pages containing governmental
letterhead/citation content (`"QUỐC HỘI"`, citations to `"Hiến pháp"`,
references to specific government reports and decrees), while the pure
numeric-table appendix pages passed through fine. A content-filtered response
has no completion, so `usage.completion_tokens` is absent from the JSON —
which fails docling's `OpenAiResponseUsage` Pydantic model (that field is
required, no default), and docling's broad exception handler
(`api_image_request.py`) silently swallows the resulting validation error
into empty text. **`ConversionStatus.SUCCESS` and a correct page count do not
guarantee real per-page content** — this is a genuine docling reliability gap
worth knowing about independent of which model sits behind the API.

Tried prompt engineering to route around the filter: a minimal prompt
(`"Extract the text from this image as Markdown."`) got past it on 3 of the 5
blocked pages, but at a worse cost than the block itself — the model switched
from transcribing to **summarizing** (`"Dựa trên văn bản bạn cung cấp, dưới
đây là các thông tin chính..."` — "Based on the document you provided, here's
the key information..."), a failure mode that looks plausible but silently
replaces the real text. A stricter "verbatim OCR, do not summarize" prompt
closed that gap but was re-filtered on every page tested, including the one
the minimal prompt got through. No prompt variation reliably solved this.
Moved to a local model instead of continuing to chase it.

### Local reasoning model: hidden "thinking" tokens, real fix, real new cost

The self-hosted model turned out to be a reasoning/"thinking" model — it
emits chain-of-thought in a separate `reasoning` response field before the
real answer in `content`. A trivial "what's 2+2?" prompt burned 161
completion tokens, almost entirely reasoning, before the model even started
on the actual answer. Two consequences: `max_tokens` needs real headroom
(4096 was not enough for a full page's reasoning-plus-transcription; settled
on 8192-24000 depending on task) or the response truncates mid-reasoning with
no real answer at all, and per-request latency is materially higher than a
non-reasoning model.

Per the user-supplied guide for this specific Bifrost/vLLM deployment,
`chat_template_kwargs.enable_thinking: false` (the more commonly-documented
way to disable Qwen-family reasoning) is silently ignored on this deployment
— **`reasoning_effort: "none"` (a top-level request field) is the only
verified-working way to disable it here**, confirmed directly: completion
tokens for the trivial test dropped from 161 to 2, and a 9-page whole-document
transcription dropped from 296.4s to 170.0s with reasoning off.

Disabling reasoning was not free, though: on the same 9-page document, 2 of 4
tables regressed from clean Markdown to raw, unparseable LaTeX
(`\begin{tabular}{|l|l|r|} \hline STT &amp; NỘI DUNG...`) and a 4th table's
content disappeared entirely rather than reformatting badly. Reasoning had
apparently been doing real work on the specific "notice this is a table,
convert it correctly" step; without it, the model sometimes fell back to a
more literal first-guess transcription instead of following the format
instruction. This is what motivated the table-format investigation below,
not a one-off quirk.

### Table format: Markdown pipe-tables can't hold merged cells; docling's own export has a bug

Standard Markdown table syntax has no `colspan`/`rowspan` equivalent — a
structural limitation, not a model failure. Tested an explicit instruction:
plain tables (no merged cells) → native Markdown pipe-table; tables with a
merged header or spanning cell → HTML `<table>` with real `colspan`/
`rowspan` attributes. This fully eliminated the LaTeX fallback (0/6 in a
targeted 3-attempt-per-page reproducibility check) and fully recovered the
previously-missing complex table, correctly reproducing its true spanning
header structure. Minor, harmless overreach observed: the model sometimes
used `rowspan="2"` on a table whose second header row didn't actually need
it (no real column spans anywhere) — cosmetic, didn't affect data.

**Separately, and more importantly: docling's own `export_to_markdown()` has
a real bug with spanning cells.** Feeding a document with a real `colspan=2`
table through the normal Markdown export path produced a duplicated,
misleading result — `CHIA RA` (a header meant to span 2 columns) became two
literal `CHIA RA | CHIA RA` columns, followed by a fake extra "data" row that
just repeated the header text (`STT | NỘI DUNG | NSNN | ...`) as if it were
real content. Confirmed this is an export-layer bug, not data loss: reading
`table.data.table_cells` directly showed the correct underlying structure
(`row_span=2` on `STT`/`NỘI DUNG`/`NSNN`, `col_span=2` on `CHIA RA`) fully
intact, and `table.export_to_html()` on that same data produced correct,
clean HTML (`<td rowspan="2">STT</td>...<td colspan="2">CHIA RA</td>`). The
fix is to call `export_to_html()` instead of `export_to_markdown()` — the
data was never wrong, only one of the two export paths was.

### The architectural pivot: plain text + the existing parser, not structure-aware tags

An extended attempt to get the model to directly emit semantic HTML tags
(`<h1>`-`<h6>` for a full Phần→Chương→Mục→Tiểu mục→Điều/Phụ lục hierarchy,
`<ol>`/`<ol type="a">` for Khoản/Điểm) made real, measurable progress with
increasingly explicit rules — Điều heading-level consistency went from 1
correct out of 4 (no rules) to 4/4 correct once every element type had an
exact, deterministic tag assigned regardless of page — but hit a hard
ceiling: each page is an **independent** VLM request with no memory of how
earlier pages were tagged, so nothing guarantees `Điều 1` on page 1 and
`Điều 4` on page 4 land at the same heading level, or that a Phụ lục page
without a page-visible "Phụ lục" label (partially obscured by an official
seal, in the case actually found) gets recognized as an attachment rather
than a new document.

The actual fix was a reframing, not another round of prompt tuning: this
project's real production parser (`server/src/law-index/crawl/
document-node.parser.ts`) already exists, is extensively calibrated against
real vbpl.vn documents (dozens of named, cited edge cases — table fragments
misread as Khoản numbering, citation blocks quoting another document's
structure, signature footers, duplicated content, outer-grouping markers,
NFD/NFC Unicode variants), and — confirmed directly from its own docstring
and `vbpl-client.service.ts`'s `fullText: (pane as HTMLElement).innerText` —
already expects **plain text with natural line breaks, no HTML or Markdown
at all**. Asking the VLM to *transcribe* faithfully (a natural OCR task) and
letting the existing parser *deduce* structure from line-start patterns
removes the tagging-consistency problem entirely — there's no heading level
to get wrong if there's no tag to assign in the first place.
`DoclingDocument.export_to_text()` (strips heading/bold/italic markup,
preserves list numbering and table pipe-separators) is the matching export
target.

### Two real transcription bugs found and fixed

**First per-page plain-text attempt failed completely** — `parseDocumentBody()`
returned 0 root nodes, not even the first Điều. Root cause, found by direct
inspection of the transcribed text: two independent line-break bugs, both
specific to page-by-page processing:

1. The first page's two-column letterhead (`"QUỐC HỘI"`/issuing body on the
   left, `"CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"`/national motto on the right)
   got blended into one run-on line instead of transcribed as two separate
   lines.
2. Content spanning a page boundary got corrupted by the physical page-number
   digit fusing onto adjacent text — e.g. `"2 Điều 2. Điều chỉnh..."`, page
   2's own page number prefixed directly onto the real heading text. Since
   `DIEU_KHOAN_PATTERN` is anchored to match a line that starts with
   `"Điều"`, this silently broke recognition for every `Điều` heading in the
   test document — all four were either prefixed by a stray digit, buried
   mid-sentence, or split across a boundary.

**Fix, and evidence it worked:** switched to sending every page of a document
as multiple images in one request (bypassing docling's pipeline, which has no
multi-page-per-request mode) with two explicit instructions — read letterhead
columns top-to-bottom, left column then right column, never merge them onto
one line; and recognize page numbers as a layout artifact to omit entirely,
rejoining any sentence/Khoản/Điều that spans a page break as if the break
never happened. Result on the same test document: all 4 Điều correctly
recognized with **exactly** the right Khoản counts (4, 10, 8, 2) matching the
source, zero page-number artifacts, letterhead cleanly split.

### A real bug found in the production parser, not just the VLM path

With the transcription bugs fixed, table content (4 appendix tables) was
still missing from the parsed tree — but this time the cause was **in the
existing parser**, unrelated to anything the VLM did wrong. The document's
signature block reads:

```
CHỦ TỊCH QUỐC HỘI
Nguyễn Thị Kim Ngân
```

`FOOTER_START_PATTERN` only recognized `"Nơi nhận:"`, `"TM./KT. <title>"`, or
`"THAY MẶT"` as signature-block starters — a document whose signer opens
directly with their own standalone title line (no `TM./KT./THAY MẶT` prefix
at all) wasn't one of them, so footer-suppression never engaged and
everything after — signature line, all 4 tables — silently accumulated as
plain text onto the last real Khoản instead of being isolated. This would
affect real vbpl.vn-sourced documents using this exact signature format too,
not just this OCR path.

**Fix:** added `SIGNATURE_TITLE_PATTERN`, matching a standalone Vietnamese
head-of-body title line (Chủ tịch nước/Quốc hội, Thủ tướng, Bộ trưởng, Tổng
thư ký, etc.), anchored to the whole line to avoid catching the same phrase
appearing mid-sentence in real body text. Only `"CHỦ TỊCH QUỐC HỘI"` is
directly confirmed against real content; the sibling titles are a documented,
honest extrapolation (same best-effort posture as the rest of that file, and
flagged as such in the code comment) — not independently confirmed yet.
Added a regression test using the real document's content; all 47 existing
parser tests still pass (`npm test -- document-node.parser`).

### A second, bigger parser gap: "zero exceptions" is not "zero silent loss"

Running the full 47-document batch surfaced a more consequential version of
the same lesson. Two documents produced trees with **zero `Điều` nodes**,
which looked identical in the aggregate summary — worth checking both rather
than assuming either was fine:

- `61-2020-QH14` (sampled as `luat-dau-tu-2.pdf`) — not a bug. The sampled
  PDF genuinely *is* just Luật Đầu tư's Phụ lục I (a list of substances
  banned from investment activity), confirmed by its own first line:
  `"PHỤ LỤC (Ban hành kèm theo Luật Đầu tư số 61/2020/QH14)"`. Zero Điều is
  the correct answer for this specific source file.
- `263-2025-QH15` — a real, previously-unknown parser gap. This Nghị quyết's
  entire substantive content sits directly under `"QUYẾT NGHỊ:"` as bare
  numbered items with no `Điều` wrapper at all — `"1. Quốc hội ghi nhận,
  đánh giá cao nỗ lực của Chính phủ..."`, later subdividing into
  `"2.1. Lĩnh vực tài chính"`, etc. `KHOAN_PATTERN` only gets checked while
  the parser is already inside an open `Điều`/`Khoản`/`Điểm` container; since
  this document never opens one, every one of these lines falls through to
  the final "no container open, nowhere to attach" case and is silently
  dropped — **319 of the document's 565 transcribed lines never made it into
  the tree**, with no exception raised and no signal in the summary output
  beyond "0 Điều" needing a second look.

This is the same category of issue as the `SIGNATURE_TITLE_PATTERN` gap
above — a valid, real Vietnamese legal-document structure the parser has no
coverage for — but bigger in consequence: that one dropped a low-value
signature block, this one drops an entire resolution's operative content.
Not fixed as part of this report (out of scope for this pass); flagged here
because the aggregate "0 parse errors" number would otherwise read as a
cleaner result than it actually is — a parser that never throws is not the
same guarantee as a parser that never silently loses content, which is
exactly the failure shape this whole evaluation series has been built to
catch rather than take on faith.

### Scale-test infrastructure: a logging bug, a hard gateway ceiling, and reverting to per-page

Building the checkpointed 50-document harness surfaced two more real,
non-obvious problems:

**Log bloat from a Bifrost quirk.** On a request timeout, the gateway's
error response echoes back parts of the original request — including our
base64-encoded page images — inside `extra_fields`. Naively stringifying the
full error body for logging purposes turned a handful of timeouts into a
**33MB log file** from multi-megabyte lines. Fixed by extracting only the
human-readable `error.type`/`error.message` fields and bounding any exception
string to 300 characters regardless of type.

**The gateway enforces its own 300-second timeout, independent of the
client's.** Discovered via the error body itself:
`"request timed out (default is 300 seconds). You can increase it by
setting the default_request_timeout_in_seconds..."` — this fires regardless
of what timeout the client requests (600s was set, made no difference).
Multi-page chunked requests (originally 25 pages, then 6 pages per request)
kept landing close to or over this ceiling — even 4-5 page chunks
occasionally took 280s+, and two documents failed outright after exhausting
3 retries each.

**Resolution:** the original reason for batching multiple pages into one
request was fixing cross-page tag consistency — moot once the pipeline
switched to plain text with no tags at all. The letterhead and page-number
fixes were prompt-level, not architecture-level, and hold just as well with
one page per request. Reverting to **true per-page processing** (one image
per request) fixed the timeout problem directly — a single page averages
23-50s, comfortably under the ceiling — without reopening the tagging
problem that no longer exists. Required care when switching: checkpoint
entries from the abandoned 6-page-chunk scheme were keyed by chunk index,
which meant something different under the new 1-page scheme (`chunk "0"`
meant "pages 0-5" under one scheme, "page 0" under the other) — cleared stale
entries for any document without a completed final output before resuming,
to avoid silently reusing mismatched partial data.

## Metrics

**Scale test (final state):** 909 total pages in the sample; 47 of 50
documents completed and fed through the real `parseDocumentBody()` parser.

| | Result |
| --- | --- |
| Documents parsed | 47/47 attempted — 0 exceptions, 0 empty-tree results (2 of the 47 have zero `Điều` for reasons documented above — one correctly, one a real parser gap) |
| Điều | 331 |
| Khoản | 1,115 |
| Điểm | 554 (present in 25/47 docs) |
| Phụ lục | 144 (present in 38/47 docs — confirms the footer-pattern fix holds at full scale, not just the one document that motivated it) |
| Chương / Phần / Mục | 20 / 1 / 9 (7/47 docs have real chapter-structured hierarchy, not just the flat Nghị-quyết shape) |
| Speed | Typically 23-50s/page for most documents; several outliers in the 170-225s/page range, and the 163-page document (`74/2022/QH15`) completed in full at ~37s/page average (6,026s total) — no size-related failure |
| Hard failures | **3/50 documents**: `37-2017-QH14`, `21-2026-QH16`, `132-2024-QH15` — all titled "phê chuẩn quyết toán ngân sách" / "bổ sung dự toán ngân sách" (budget settlement/supplement approvals), failing even at true per-page granularity on individual pages exceeding the gateway's 300s ceiling or the client's own 600s read timeout. Not fully deterministic: a 4th document in this same category (`22-2021-QH15`) failed on its first attempt but succeeded on a later retry with the identical configuration — this is a probabilistic risk correlated with content (almost certainly table density, matching `DOCLING_REPORT.md`'s independent finding), not a fixed blocklist of documents |

## Known open risks — not yet verified at this configuration

- **Citation-number hallucination, found once, not re-checked since.** Early
  in this investigation (an earlier, since-superseded HTML-tagging
  configuration), the same model fabricated wrong citation numbers
  (`"118/2020/QH14"`, `"113/2020/QH14"`) in 2 of 3 appendix-table captions on
  a document that is actually `128/2020/QH14` throughout. This is a
  model-reliability issue orthogonal to every format/architecture fix in this
  report — it has not been specifically retested against the final per-page
  plain-text configuration or any document in the 47-document batch.
- **Table content correctness has not been verified at scale.** Table
  *structure* (real `colspan`/`rowspan`) was validated directly on one
  document. The 47-document parser run only confirms Điều/Khoản/Điểm/Phụ lục
  structure, since the parser doesn't inspect table content at all — a table
  embedded inside a Phụ lục node's text is invisible to this validation
  either way.
- **The parser silently drops non-`Điều`-structured resolution bodies.**
  Confirmed on one real document (`263-2025-QH15`, see Findings) — a Nghị
  quyết whose substantive content is bare numbered items directly under
  `"QUYẾT NGHỊ:"`, no `Điều` wrapper. Unknown how many documents in the
  broader corpus use this shape; not something this report's sample size can
  answer, since it only showed up once in 50 documents.
- **3/50 documents fail outright, and the failure isn't fully deterministic**
  — the same three failed consistently, but a fourth document
  (`22-2021-QH15`) failed once and then succeeded on retry with no
  configuration change, meaning the true failure rate could be somewhat
  higher than 3/50 measures on any single pass. Points at genuinely
  slow-to-transcribe content (most likely table density) rather than a fixed,
  reproducible blocklist.

## Verdict

The core architectural bet — trust the existing, already-calibrated
production parser to recover structure from plain text, rather than asking a
per-page-independent VLM to correctly and consistently tag that structure
itself — is validated by real evidence at real scale: 47/47 attempted
documents parsed without exception, rich and varied recovered structure
(331 Điều, 1,115 Khoản, 554 Điểm, 144 Phụ lục, real Chương/Phần/Mục hierarchy
in 7 documents), and three genuine bugs (one in docling's own export layer,
two in the production parser) found and either fixed or precisely documented
along the way rather than worked around or missed. Diacritics have been
clean everywhere spot-checked, a real contrast to the severe
table-density-correlated diacritic collapse `DOCLING_REPORT.md` found with
EasyOCR.

That said, "pretty good" is the right level of confidence, not "done" — and
running the full sample sharpened rather than resolved that qualifier.
Three real risks — citation-number hallucination, table-content fidelity,
and now a confirmed (if so far singly-observed) parser gap for
non-`Điều`-structured resolutions — were identified during this
investigation but not closed out. All three matter specifically for a
legal-document corpus where an exact number, a specific tax bracket, or an
entire resolution's operative text being silently missing is a different,
worse kind of error than a formatting glitch — and unlike a crash, none of
the three would show up in an aggregate "0 errors" summary without someone
specifically going looking, which is exactly what happened with the
zero-`Điều` check in this pass. The 6% (3/50) hard failure rate on
table-dense documents also isn't solved, only characterized more precisely —
it echoes, rather than departs from, the same table-density risk this
project's OCR evaluations keep finding regardless of which tool or pipeline
is used.

## Recommendation

Before treating this configuration as a candidate to replace or supplement
`docling + EasyOCR(vi)` in the actual pipeline:

1. **Verify citation-number accuracy specifically**, across all 47 completed
   documents — grep each document's known self-citation against its
   transcribed text, the same way the hallucination was originally caught,
   since nothing else in this report's testing would catch a
   confidently-wrong number.
2. **Spot-check table content**, not just structure, on a sample of the 38
   documents that produced Phụ lục nodes — the parser's blindness to table
   content means a garbled number inside a `<table>` would pass every check
   run so far.
3. **Decide how to handle the non-`Điều`-structured resolution gap** — either
   extend `document-node.parser.ts` with a fallback for bare-numbered
   `"QUYẾT NGHỊ:"` bodies, or at minimum survey how common this shape is in
   the broader vbpl.vn corpus before assuming a single-document sample means
   it's rare.
4. **Root-cause the 3 persistent failures (and the 4th intermittent one)**
   directly — render their individual pages and check for the same
   table-density signal (`detect_table_gridlines.py`, already built for
   `DOCLING_REPORT.md`) before assuming there's no fix short of raising the
   gateway's timeout.

## Files

- `scripts/test_docling_vlm.py` — single-document ephemeral test script,
  iterated through every prompt/format variant described above
- `scripts/test_vlm_whole_doc_plaintext.py` — the whole-document
  single-request test that first validated plain-text + parser reconstruction
- `scripts/diagnose_vlm_usage_field.py` — isolates the Gemini
  content-filter/`completion_tokens` finding
- `scripts/test_vlm_table_repro.py` — table-format reproducibility check
  (LaTeX fallback vs. HTML with colspan/rowspan)
- `scripts/test_parser_on_vlm_output.ts` — feeds one document's transcript
  through the real `parseDocumentBody()`
- `scripts/run_vlm_scale_test.py` — the checkpointed 50-document per-page
  harness (final configuration)
- `scripts/run_parser_scale_test.ts` — batch-runs the real parser across all
  completed transcripts
- `outputs/VLM/*.txt` — per-document plain-text transcripts (47/50)
- `outputs/VLM/*_parsed.json` — per-document parsed Điều/Khoản/Điểm/Phụ lục
  trees
- `outputs/VLM/_parser_summary.json` — aggregate node counts per document
- `server/src/law-index/crawl/document-node.parser.ts` — production parser,
  now with `SIGNATURE_TITLE_PATTERN` (the non-`Điều`-structured resolution
  gap found in this pass is not yet fixed here)
- `server/src/law-index/crawl/document-node.parser.spec.ts` — now with a
  regression test for the signature-block fix
