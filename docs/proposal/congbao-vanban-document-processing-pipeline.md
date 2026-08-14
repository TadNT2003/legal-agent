# Unified document-processing pipeline for vbpl.vn, congbao.chinhphu.vn, and vanban.chinhphu.vn

**Status: proposal, not yet implemented.** This is a design, not a plan with assigned
work — it exists so the next person doesn't have to re-derive the reasoning behind it.
Builds directly on `docs/plan/congbao-source-evaluation.md` (source-level reconnaissance)
and `sandbox/congbao-evaluation/REPORT.md` (200-document pdf-inspector viability
evaluation). Read those first for the evidence this proposal is built on; this doc
covers the full three-source pipeline shape, the reasoning behind it, and the concrete
gaps against the existing codebase.

## Scope

All three sources need a real document-processing step somewhere in their path, not
just the two without server-rendered text. vbpl.vn is the exception *most* of the time
(it exposes full text directly), but not unconditionally — its own scraped text has a
real, documented history of missing content and duplicated Khoản/Điều (see "Grounding
note" below), so this design gives it an error-triggered fallback into the same raw-
document pipeline congbao and vanban always need. That shared pipeline is what would
replace `document-text-extractor.ts`'s `DOCUMENT_TEXT_EXTRACTOR` port (currently
`NullDocumentTextExtractor`, a placeholder returning `{ fullText: null, extractionMethod:
null }`) — one pipeline, three entry points, since the difference between sources turns
out to be *trigger rate and cost profile*, not *shape* (see "Expected cost asymmetry").

## The full pipeline

### Stage A — source cascade with a citation as input

```
citation number
      |
      v
 scraper endpoint
      |
      v
 vbpl.vn: has document?
      |
      +-- yes --> scrape vbpl.vn --> metadata --------------> Postgres
      |                          --> references -------------> Postgres
      |                          --> full text --> document_node
      |                                            parser #1 (vbpl-specific)
      |                                                  |
      |                                    text error OR has a table?
      |                                        |                |
      |                                        no               yes
      |                                        |                |
      |                                        v                v
      |                              hierarchical           download original
      |                              structure -->           document from
      |                              Postgres                vbpl.vn --> raw doc
      |                                                            |
      |                                                            v
      |                                                  [Stage B, below]
      |
      +-- no --> congbao.chinhphu.vn: has document?
                     |
                     +-- yes --> scrape congbao --> raw doc -----> [Stage B]
                     |                          --> references --> Postgres
                     |                          --> metadata ----> Postgres
                     |
                     +-- no --> vanban.chinhphu.vn: has document?
                                    |
                                    +-- yes --> scrape vanban --> metadata --> Postgres
                                    |                         --> raw doc ---> [Stage B]
                                    |
                                    +-- no --> report scrape failure (terminal)
```

This matches the fallback hierarchy `docs/plan/congbao-source-evaluation.md` already
argued for (vbpl.vn primary, congbao first fallback, vanban last resort) and adds a
fourth entry point into the same shared pipeline: vbpl.vn's own text, when it's bad
enough to distrust.

### Stage B — shared raw-document pipeline

Fed by three sources: vbpl.vn's downloaded original (fallback only), congbao's raw
document, vanban's raw document.

```
raw document
      |
      v
 split into pages
      |
      v
 page has a table?
      |
      +-- yes --------------------------------------> docling VLM (table -> HTML)
      |
      +-- no --> classify page format
                      |
                      +-- .doc          --> textract
                      +-- .docx         --> markitdown / mammoth
                      +-- digital .pdf  --> pdf-inspector
                      +-- scan .pdf     --> docling VLM
                      +-- .rtf          --> unsupported, page/doc not scraped
                      |
      +-----------------+
      |
      v
 merge every page's output for this document
 (also normalizes: MD -> plain text, per page)
      |
      v
 self-processed full text (shaped to resemble vbpl.vn's fullText)
      |
      v
 document_node parser #2 (self-processed text)
      |
      v
 hierarchical structure --> Postgres (same instance as Stage A)
```

Both Postgres targets in Stage A and Stage B are the same instance — the cascade and
the shared pipeline both write into the one `document`/`document_node`/
`document_reference` schema, just via different entry paths depending on which source
and which of vbpl.vn's two outcomes produced the content.

## Why per-page, not whole-document, for the PDF branch

`pdf_inspector`'s simpler `process_pdf()` API — the one `sandbox/congbao-evaluation`'s
Eval-02 harness used — only exposes `has_table`/`has_encoding_issues` at the whole-document
level. The package also ships `extract_pages_markdown(path, pages=None) ->
PagesExtractionResult`, which is page-indexed throughout: `pages: list[PageMarkdown]`
(each with its own `needs_ocr`/`ocr_reason`), `pages_with_tables: list[int]`,
`pages_needing_ocr`, `ocr_reasons_by_page`. Building against this instead means a
95-page document with one bad page sends *one page* to VLM, not all 95 — the entire
cost-asymmetry argument in `sandbox/congbao-evaluation/REPORT.md`'s Verdict depends on
this being page-granular, not document-granular. There's also a cheap `classify_pdf(path)
-> PdfClassification` (fast detection only, no text extraction, but does return
`pdf_type` and `pages_needing_ocr`) worth considering as an even earlier pre-classifier,
if per-page classification cost turns out to matter at real scale.

## Grounding note: the vbpl-text-error fallback is probably low-trigger-rate, not load-bearing

Checked `docs/monitoring/law-index-flagged-documents.md` before treating this branch as
a major pipeline component, since it's specifically the project's own record of this
exact problem class. Nearly every entry in that log (§1, §6, §7, §12, §15, §17, §18,
§19) is "missing content" or "duplicate Khoản/Điều" caused by vbpl.vn's own scraped
text — and almost all are marked **✅ Resolved, via parser-level fixes**, not via
re-fetching the original document. `dedupeOrdinal` in `document-node.parser.ts` in
particular is a corpus-wide backstop that guarantees no DB-level path collisions
regardless of cause — it doesn't fix tree *shape*, but "duplicate Khoản" no longer means
lost data, just an imprecisely-labeled node.

This doesn't invalidate the fallback branch — it's a reasonable safety net for whatever
the *next* not-yet-found vbpl-scraping bug turns out to be — but its expected trigger
rate should now be low, and the precise trigger condition needs picking deliberately:
"any document that ever hit the `dedupeOrdinal` backstop" (broad — hundreds per the
log's historical counts, though falling as more shapes get fixed) versus something
narrower like "empty `fullText`" or "suspiciously short relative to expected length."
Those give very different fallback-trigger rates and very different load on Stage B.

## Open questions (need answers before this is implementation-ready)

1. **Does vbpl.vn actually expose a downloadable original document?** The "download
   original from vbpl.vn" step assumes it does. Not confirmed anywhere in this repo's
   own documentation of `VbplClientService` (which does 3 page loads — full text,
   thuộc-tính, lược-đồ — no mention of a downloadable-attachment concept). Needs
   confirming before this branch is buildable at all.

2. **"Split into pages" doesn't apply natively to `.docx`/`.doc`/`.rtf`.** PDF pages are
   real (fixed layout). Word documents reflow — pages only exist once rendered at a fixed
   size/font, which normally means converting to PDF first to get real page boundaries.
   Does page-splitting apply only to the PDF branch (with DOCX/DOC handled as one
   whole-document unit downstream, tables detected via the format's own structure —
   e.g. python-docx can enumerate `.docx` tables directly, no page concept needed), or is
   there an implied DOCX-to-PDF conversion step before splitting that isn't drawn?

3. **How is "digital .pdf" vs. "scan .pdf" actually decided, and by what?** If it's
   `pdf_inspector`'s own per-page `needs_ocr` classification, that means pdf-inspector
   has to run *first* to make the routing decision — worth drawing as one sequential
   step rather than two parallel branches. `classify_pdf`/`detect_pdf` (see above) are
   candidates for that first pass specifically because they're cheaper than full
   markdown extraction.

4. **Two separate `document_node` parsers — permanent, or meant to converge later?**
   `document-node.parser.ts` already carries a lot of generic infrastructure that has
   nothing to do with vbpl.vn specifically (`dedupeOrdinal`, `GROUP_MARKER_PATTERN`, the
   footer-drop logic). Maintaining two full parsers risks the second one re-discovering
   the same structural bugs independently instead of reusing what's already
   battle-tested. Worth considering a shared core grammar with source-specific
   pre-normalization (clean each source's own quirks before one shared parser) instead
   of two full parsers — unless the two input shapes are different enough that this
   genuinely doesn't work, which hasn't been established either way yet.

5. **How much of vanban's corpus is RTF-only, with no PDF/DOC alternative?** If some
   vanban documents are only ever available as RTF, "not supported" becomes a permanent,
   silent corpus gap rather than a minor format-coverage note. Worth knowing the scale
   before accepting the loss.

## Gaps against the current codebase (concrete, found by reading the actual source)

### Table representation conflicts with how `document-node.parser.ts` currently treats tables

This is the biggest open question, found by reading the parser itself, not assumed.
`document-node.parser.ts`'s own header states its input is vbpl.vn's "plain innerText,
no HTML structure retained" — and its actual strategy for tables (§12b/§17 in the file's
comments) is **suppression, not reconstruction**: a flattened table row or header line
is *detected* (via tab-character heuristics, a small vocabulary of known header words
like "Đơn vị tính"/"Thứ tự", and a rule that a `KHOAN_PATTERN` match whose remainder is
pure digits/punctuation is a mis-scraped table cell, not a real Khoản) specifically so it
can be swallowed into inert surrounding body text — *precisely to avoid* creating fake
Khoản/Điểm nodes from it. There is currently no code path that preserves a table as
distinguishable structured content at all, HTML or otherwise; `ParsedDocumentNode.textContent`
is `string | null`, and `ContentClass` is `'normative' | 'template'` — no table-aware
variant exists.

Feeding real `<table>...</table>` HTML into `fullText` as this proposal describes
therefore doesn't just need a new input format — it needs an explicit decision the
parser doesn't currently make: does a detected table become its own child node (new
`nodeType` or `ContentClass`?), inline content on its parent Khoản/Điều, or continue
being suppressed (in which case the VLM step's whole reason for producing HTML instead
of plain text disappears)? This applies to parser #2 (self-processed text) directly, and
to parser #1 (vbpl-specific) indirectly if vbpl.vn's own "has a table" fallback trigger
is kept — both would need the same decision. Not resolved here — flagging it as the one
piece of this proposal that needs a real design decision before implementation, not just
wiring.

### Per-page corruption detection doesn't exist as a reusable tool yet

`pdf_inspector`'s `has_encoding_issues` is whole-document-only and was directly confirmed
unreliable during Eval-02 (checked against 3 flagged documents, found clean in all 3; the
real corruption found wasn't flagged by it at all). `sandbox/congbao-evaluation/scripts/
analyze_eval02.py` has a working detection approach (scan for U+FFFD, bare `(cid:N)`
references, stray Latin-1 Supplement characters outside the small legitimate
Vietnamese-letter set) but it currently runs post-hoc over whole-document markdown, once,
after the fact — not per-page, not as an importable function. Turning it into a per-page
check against each `PageMarkdown.markdown` is a small adaptation, not a rewrite, but it
doesn't exist as reusable code yet.

### `.doc` and `.docx` are different extraction problems

`mammoth` (already in `.venv`) only handles `.docx` (OOXML). Legacy `.doc` (binary,
pre-2007 format — confirmed this is what congbao serves for documents from roughly
2017 to the early 2020s, before switching to `.docx`, per
`docs/plan/congbao-source-evaluation.md`'s bisection) needs a different tool entirely.
Nothing `.doc`-capable is in `.venv` currently. Options not yet evaluated here:
`antiword`/`catdoc` (lightweight, Linux-oriented), LibreOffice headless conversion
(heavier, but handles the format reliably and is likely already the most practical
choice given it can also serve as a `.rtf` fallback if "unsupported" turns out to be too
lossy per open question 5 above).

### Running headers need stripping before concatenation, source-specific pattern

Every congbao PDF page carries an injected running header (`"CÔNG BÁO/Số 631 +
632/Ngày 30-6-2014"` — confirmed present on every sampled page across all 200
Eval-01/02 documents). Concatenating pages raw scatters this string through the middle
of continuous Điều/Khoản/Điểm text, which `document-node.parser.ts` was built against
vbpl.vn's *clean*, page-concept-free text and has no reason to expect. This needs an
explicit strip step in the "merge every page's output" stage, and the pattern is
presumably congbao-specific (vanban's, once its own PDFs are characterized, may differ
or may not exist at all if vanban's scans don't carry the same congbao-branded header).

### MD-to-plain-text needs to handle embedded raw HTML, not just Markdown syntax

Directly observed in real pdf-inspector output: `*(Kèm theo Thông tư số 79/2022/TT-BQP
ngày 04 tháng 11 năm 2022* <u>của Bộ trưởng Bộ Quốc phòng)</u>` — literal `<u>` tags
inline in the markdown, not just `#`/`**`/`*` syntax. A stripper that only handles
Markdown syntax will leave these in. `pdf_inspector.extract_text(path) -> str` is a
genuine plain-text extractor with neither — worth evaluating as the source for
non-flagged pages instead of markdown-then-strip, though it has no `pages` parameter
(whole-document only), so page-level routing decisions still need
`extract_pages_markdown` regardless of which extractor produces the final text.

## Expected cost asymmetry (by design, not a bug to investigate later)

congbao: ~95% of pages need nothing beyond the plain pdf-inspector/DOCX path (Eval-02:
77.5% of documents had zero pages needing OCR; 4.65% of all pages needed it across the
full 200-document sample). vanban: expected close to 100% VLM fallback, every document,
every time — it has no digital-PDF path at all, confirmed structurally
(`document-text-extractor.ts`'s own comment), not just usually-scanned. vbpl.vn: expected
very low trigger rate into Stage B at all, per the "Grounding note" above. Worth stating
explicitly wherever this pipeline's cost/throughput gets discussed later, so these very
different profiles don't look like regressions against each other.

## Explicitly out of scope here

- Which VLM tool wins (docling vs. alternatives) — still under evaluation in
  `sandbox/extract-tool-resilience` and `sandbox/text-extract-evaluation`, outside this
  worktree.
- Table representation's parser-side design decision (see above) — flagged, not resolved.
- `.doc`/`.rtf` tool selection — flagged, not resolved.
- The five open questions above — flagged, not resolved.
- Implementation sequencing/timeline.
- Whether this replaces `NullDocumentTextExtractor` directly or lands behind a flag first.
