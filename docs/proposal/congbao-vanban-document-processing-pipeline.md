# Unified document-processing pipeline for congbao.chinhphu.vn and vanban.chinhphu.vn

**Status: proposal, not yet implemented.** This is a design, not a plan with assigned
work — it exists so the next person doesn't have to re-derive the reasoning behind it.
Builds directly on `docs/plan/congbao-source-evaluation.md` (source-level reconnaissance)
and `sandbox/congbao-evaluation/REPORT.md` (200-document pdf-inspector viability
evaluation). Read those first for the evidence this proposal is built on; this doc
focuses on the pipeline shape and the concrete gaps against the existing codebase.

## Scope

Both congbao.chinhphu.vn and vanban.chinhphu.vn share the same fundamental problem
vbpl.vn doesn't have: neither exposes server-rendered full text, so both need a real
document-processing step — download an attachment, extract its text, hand it to
`document-node.parser.ts` — before a `document_node` tree can be built. This is exactly
the gap `document-text-extractor.ts`'s `DOCUMENT_TEXT_EXTRACTOR` port already exists for
(currently `NullDocumentTextExtractor`, a placeholder returning `{ fullText: null,
extractionMethod: null }`). This proposal is what would replace it — one pipeline shared
by both sources, since the difference between them turns out to be *cost profile*, not
*shape*: congbao mostly doesn't need the expensive path, vanban almost always does (see
"Expected cost asymmetry" below), but the same stages apply to both.

vbpl.vn itself is out of scope — it already has server-rendered text and needs none of this.

## Pipeline stages

```
source attachment(s)
       |
       v
 [0] format branch: .docx / .doc / .rtf / .pdf
       |
       +-- .docx --> mammoth --------------------------+
       |                                                 |
       +-- .doc  --> (needs a *different* tool --        |
       |              see "Gaps" below)                  |
       |                                                 v
       +-- .rtf  --> (vanban only -- needs its own   [pure text, per document]
       |              path, see "Gaps" below)             |
       |                                                 |
       +-- .pdf  --> pdf_inspector.extract_pages_markdown |
                     (per-page: markdown, needs_ocr,      |
                      ocr_reason, pages_with_tables)       |
                            |                              |
              +-------------+-------------+                |
              |             |             |                |
       [1a] page needs  [1b] page has  [1c] page is    [1d] page is
       OCR (built-in)   a table        clean but shows  clean, no
       (built-in flag)  (built-in      corruption        issues
                         flag)         (custom per-page
                                        detector -- not
                                        built-in, see
                                        "Gaps")
              |             |             |                |
              v             v             v                v
       [2] VLM (docling) reprocessing            [3] MD-to-plain-text,
       for flagged pages only, table              strip running headers/
       output kept as HTML                        footers/page numbers
              |                                            |
              +-------------------+------------------------+
                                  |
                                  v
                  [4] concatenate pages in order
                  (pure text + inline table HTML,
                   shaped to resemble vbpl.vn's fullText)
                                  |
                                  v
                  { fullText, extractionMethod }
                  (DocumentTextExtractor contract,
                   document-text-extractor.ts)
                                  |
                                  v
                  document-node.parser.ts -> document-node.repository.ts
                  -> document_node rows in Postgres
```

## Why per-page, not whole-document

`pdf_inspector`'s simpler `process_pdf()` API — the one `sandbox/congbao-evaluation`'s
Eval-02 harness used — only exposes `has_table`/`has_encoding_issues` at the whole-document
level. The package also ships `extract_pages_markdown(path, pages=None) ->
PagesExtractionResult`, which is page-indexed throughout: `pages: list[PageMarkdown]`
(each with its own `needs_ocr`/`ocr_reason`), `pages_with_tables: list[int]`,
`pages_needing_ocr`, `ocr_reasons_by_page`. Building against this instead means a
95-page document with one bad page sends *one page* to VLM, not all 95 — the entire
cost-asymmetry argument in `sandbox/congbao-evaluation/REPORT.md`'s Verdict depends on
this being page-granular, not document-granular.

## Gaps against the current codebase (concrete, not yet resolved)

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
of plain text disappears)? Not resolved here — flagging it as the one piece of this
proposal that needs a real design decision before implementation, not just wiring.

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
choice given it can also serve as a `.rtf` fallback — see next).

### `.rtf` (vanban-specific) has no path in this design yet

vanban.chinhphu.vn's attachments are PDF/DOC/**RTF** (`chinhphu-document.interface.ts`'s
`attachmentFileUrls`) — RTF doesn't appear in congbao's format set at all, so it's easy
to miss if this pipeline is designed congbao-first. LibreOffice headless (if adopted for
`.doc`) would cover this too in one tool rather than three.

### Running headers need stripping before concatenation, source-specific pattern

Every congbao PDF page carries an injected running header (`"CÔNG BÁO/Số 631 +
632/Ngày 30-6-2014"` — confirmed present on every sampled page across all 200
Eval-01/02 documents). Concatenating pages raw scatters this string through the middle
of continuous Điều/Khoản/Điểm text, which `document-node.parser.ts` was built against
vbpl.vn's *clean*, page-concept-free text and has no reason to expect. This needs an
explicit strip step, and the pattern is presumably congbao-specific (vanban's, once its
own PDFs are characterized, may differ or may not exist at all if vanban's scans don't
carry the same congbao-branded header).

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
(`document-text-extractor.ts`'s own comment), not just usually-scanned. Worth stating
explicitly wherever this pipeline's cost/throughput gets discussed later, so vanban's
very different profile doesn't look like a regression against congbao's numbers.

## Explicitly out of scope here

- Which VLM tool wins (docling vs. alternatives) — still under evaluation in
  `sandbox/extract-tool-resilience` and `sandbox/text-extract-evaluation`, outside this
  worktree.
- Table representation's parser-side design decision (see above) — flagged, not resolved.
- `.doc`/`.rtf` tool selection — flagged, not resolved.
- Implementation sequencing/timeline.
- Whether this replaces `NullDocumentTextExtractor` directly or lands behind a flag first.
