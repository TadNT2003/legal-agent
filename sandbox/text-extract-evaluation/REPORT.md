# Text-extraction tool evaluation: docling vs. markitdown vs. pdf-inspector vs. MinerU

Evaluated as candidate PDF/DOCX/RTF/DOC → Markdown converters for the proposed chinhphu.vn+OCR fallback
pipeline (used when a citation is missing from vbpl.vn). Branch: `evaluate/document-parser`. 56 real
documents from `laws/` were run through four tools — docling and MinerU across three OCR configurations
each in docling's case — with results merged into one dataset per tool/configuration below.

## Executive summary

**Recommended architecture:** pdf-inspector as primary router/extractor for anything that doesn't need
OCR, markitdown as primary for `.docx` only, docling + EasyOCR(`lang='vi'`) run page-by-page as the OCR
fallback. Full reasoning in Recommendation, below.

| Entry                                           | Role                                                                          | Vietnamese OCR                                                                       | Reliability                                                                                                             | Speed (CPU-only)                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **pdf-inspector**                         | Recommended primary for anything not needing OCR                              | N/A — never attempts OCR                                                            | Zero failures across 52 attempts                                                                                        | ~free (<100ms)                                                                       |
| **markitdown**                            | Recommended primary for`.docx` only                                         | N/A — never attempts OCR                                                            | Zero crashes across 56 attempts, but two silent-failure modes (see Issues)                                              | Fast when it does anything                                                           |
| **MinerU**                                | Not recommended — reliable, but architecturally can't fix its Vietnamese OCR | Broken, no fix path (hardcoded language enum, no swappable OCR engine)               | 14/14 (100%) complete, zero crashes                                                                                     | Slowest of the OCR-capable tools, 2–5× docling                                     |
| **docling (default, RapidOCR)**           | Not recommended alone — fast but silently unreliable                         | Broken (no Vietnamese in RapidOCR's language list; tried chinese/latin/en, all fail) | 5/14 (36%) processable docs show content loss; 3/14 (21%) lose >50%, silently                                           | Fast when clean, wildly variable otherwise                                           |
| **docling + EasyOCR(vi), whole-document** | Dead end as tested                                                            | **Fixed** — correct diacritics                                                | Crashed (`std::bad_alloc`) on the one full document tested                                                            | N/A — never completed                                                               |
| **docling + EasyOCR(vi), page-by-page**   | **Recommended OCR fallback**                                            | **Fixed** — correct diacritics, but a separate word-order bug remains open    | 295/295 pages complete across 11 documents, zero crashes — including both documents that crashed under default docling | ~2.8× slower than default docling overall (varies a lot by document — see Metrics) |

**Bottom line:** none of the six entries is a clean, unqualified win. The corpus this pipeline actually
has to handle is 92%+ scanned Vietnamese PDF (see Issues), so the decisive axis is "does this produce
correct Vietnamese text and actually finish" — and only one tested configuration clears both bars:
docling with EasyOCR swapped in for the default RapidOCR backend, run one page at a time. It's slow and
still has one open bug (word order, not character accuracy), but it's the only one that isn't disqualified
outright. pdf-inspector and markitdown aren't competing for that role at all — they're the correct default
path for the (smaller, but real) slice of documents that don't need OCR in the first place. MinerU is the
most reliable OCR engine tested by default, and a dead end anyway, since it cannot take the one fix that
actually matters here.

## Setup

**Main venv (`.venv/`, Python 3.14.4, repo root):**

- `docling`, `torch` (CPU wheel), `pdfminer.six` — pre-installed.
- `markitdown` upgraded to 0.1.7, scoped to `[pdf,docx]` extras only. `markitdown[all]==0.1.7` is
  **broken on PyPI** — it pins `youtube-transcript-api~=1.0.0`, and no release in that exact line exists
  (published versions jump 0.6.2 → 1.2.3). Installing `[all]` fails outright; install only the extras
  actually needed.
- `pdf-inspector` 0.2.7 — installed clean, no issues (PyO3/Rust wheel, `cp38-abi3`, Python-version-agnostic
  — the only one of the four tools that installed on 3.14 without any caveat).
- `easyocr` 1.7.2 — installed clean; confirmed `'vi'` is a real supported language
  (`easyocr.config.all_lang_list`).

**Second venv (`sandbox/text-extract-evaluation/.venv-mineru/`, Python 3.12.1):** `mineru` caps at
`Requires-Python >=3.10,<3.14`, so it cannot install into the main 3.14 venv at all (pip fails immediately
and explicitly). Used `py -0p` to find an existing Python 3.12 install (`C:\Python312`) and created a
dedicated venv there. Installed `mineru[core]` 3.4.4.

**Both docling and MinerU ran CPU-only.** This machine has an RTX 3060 (6GB VRAM, driver 596.36, CUDA
13.2), but `pip install torch` on this platform/index resolves to the CPU-only wheel
(`torch-2.13.0+cpu`) in *both* venvs — GPU use requires an explicit CUDA-indexed install
(`--index-url https://download.pytorch.org/whl/cu...`) that neither tool's default install path sets up
automatically. All timings in this report are CPU-only.

**docling-specific blocker:** its default pipeline invokes `torch.compile` (TorchInductor), which needs
an MSVC C++ compiler (`cl.exe`) — not present on this machine, and it fails hard
(`InvalidCxxCompiler`) rather than falling back. Worked around with `TORCHDYNAMO_DISABLE=1` (forces
eager execution). Without that env var, docling does not run at all on a fresh Windows box with no Visual
Studio Build Tools installed.

## Sample documents

**56 documents total, no overlap.** An initial 6 were hand-picked for format diversity
(PDF/DOCX/RTF/DOC); a later 50 were sampled specifically to test PDF depth (since PDF is what new
documents actually arrive as), stratified by tier/year/size and excluding the first 6.

|                                                             | Count                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format-diverse set                                          | 6 — 2 PDF, 2 legacy`.doc`, 1 `.rtf`, 1 `.docx`                                                                                                              |
| PDF-stratified set                                          | 50                                                                                                                                                                 |
| **Total**                                             | **56**                                                                                                                                                       |
| Tiers represented                                           | `01-hien-phap`, `02-luat-nghi-quyet-quoc-hoi`, `03-phap-lenh-nghi-quyet-ubtvqh`                                                                              |
| Year range (stratified set)                                 | 2005–2026                                                                                                                                                         |
| Size range (stratified set)                                 | 33KB – 21.5MB                                                                                                                                                     |
| Carried into the docling/MinerU OCR-configuration deep-dive | 11 of the 50 stratified samples, plus one of the initial 6 (reused across every EasyOCR/page-by-page test — the single most-analyzed document in this evaluation) |

### Format-diverse set (6 documents)

| #  | Document                         | Format         | Scan status                                     | Notes                                                              |
| -- | -------------------------------- | -------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| 01 | 48/2024/QH15 (Luật Thuế GTGT)  | PDF, 20p       | Clean digital text (confirmed via`pypdfium2`) |                                                                    |
| 02 | 109/2025/QH15 (Luật Thuế TNCN) | PDF, 15p       | Fully scanned (confirmed via`pypdfium2`)      | Reused for every docling+EasyOCR test (whole-doc and page-by-page) |
| 03 | 57/2010/QH12 (Luật Thuế BVMT)  | legacy`.doc` | N/A                                             |                                                                    |
| 04 | 01/2002/QH11 (Luật Ngân sách) | legacy`.doc` | N/A                                             |                                                                    |
| 05 | Hiến pháp 1980                 | `.rtf`       | N/A                                             | Legacy TCVN3/VNI font encoding                                     |
| 06 | 248/2025/QH15                    | `.docx`      | N/A                                             |                                                                    |

### PDF-stratified set (50 documents)

Sourced from `laws/manifest.json`, excluding the 2 PDFs already in the format-diverse set.
**Scan status** is pdf-inspector's classification; **OCR subset** marks the 11 documents used in the
docling/MinerU configuration deep-dive.

| #  | Citation                 | Tier         | Year | Size   | Scan status                                                        | OCR subset? |
| -- | ------------------------ | ------------ | ---- | ------ | ------------------------------------------------------------------ | ----------- |
| 01 | `.` (Hiến pháp 2013) | 01-hien-phap | 2013 | 2.0MB  | Fully scanned                                                      |             |
| 02 | 02/2026/QH16             | 02           | 2026 | 578KB  | Fully scanned                                                      |             |
| 03 | 10/2009/PL-UBTVQH12      | 03-phap-lenh | 2009 | 1.2MB  | Fully scanned                                                      |             |
| 04 | 2013 (Hiến pháp 2013)  | 01-hien-phap | 2013 | 2.0MB  | Fully scanned                                                      | ✅          |
| 05 | 38/2013/QH13             | 02           | 2013 | 1.3MB  | Fully scanned                                                      |             |
| 06 | 50/2014/QH13             | 02           | 2014 | 6.3MB  | Fully scanned                                                      |             |
| 07 | 74/2018/QH14             | 02           | 2018 | 561KB  | Fully scanned                                                      | ✅          |
| 08 | 68/2025/QH15             | 02           | 2025 | 1.4MB  | Fully scanned                                                      | ✅          |
| 09 | 179/2025/QH15            | 02           | 2025 | 132KB  | Fully scanned                                                      | ✅          |
| 10 | 36/2021/QH15             | 02           | 2021 | 247KB  | Fully scanned                                                      |             |
| 11 | 35/2017/QH14             | 02           | 2017 | 224KB  | Fully scanned                                                      |             |
| 12 | 99/2019/QH14             | 02           | 2019 | 372KB  | Fully scanned                                                      |             |
| 13 | 103/2025/QH15            | 02           | 2025 | 949KB  | Fully scanned                                                      |             |
| 14 | 153/2024/QH15            | 02           | 2024 | 138KB  | Fully scanned                                                      |             |
| 15 | 03/2026/QH16             | 02           | 2026 | 600KB  | Fully scanned                                                      |             |
| 16 | 125/2025/QH15            | 02           | 2025 | 7.8MB  | Fully scanned                                                      |             |
| 17 | 33/2021/QH15             | 02           | 2021 | 188KB  | Fully scanned                                                      |             |
| 18 | 127/2016/QH13            | 02           | 2016 | 140KB  | Fully scanned                                                      |             |
| 19 | 43/2022/QH15             | 02           | 2022 | 710KB  | Fully scanned                                                      |             |
| 20 | 126/2025/QH15            | 02           | 2025 | 7.1MB  | Fully scanned                                                      |             |
| 21 | 51/2022/QH15             | 02           | 2022 | 230KB  | Fully scanned                                                      |             |
| 22 | 06/2022/QH15             | 02           | 2022 | 666KB  | Mixed — 1/65 pages scanned                                        | ✅          |
| 23 | 128/2025/QH15            | 02           | 2025 | 21.0MB | Fully scanned                                                      |             |
| 24 | 108/2025/QH15            | 02           | 2025 | 2.9MB  | Fully scanned                                                      |             |
| 25 | 39/2024/QH15             | 02           | 2024 | 820KB  | Clean — 0/46 pages scanned                                        | ✅          |
| 26 | 41/2017/QH14             | 02           | 2017 | 392KB  | Fully scanned                                                      | ✅          |
| 27 | 11/2026/QH16             | 02           | 2026 | 661KB  | Fully scanned                                                      |             |
| 28 | 59/2024/QH15             | 02           | 2024 | 315KB  | Clean — 0/12 pages scanned                                        | ✅          |
| 29 | 131/2025/QH15            | 02           | 2025 | 10.7MB | Fully scanned                                                      |             |
| 30 | 149/2025/QH15            | 02           | 2025 | 151KB  | Fully scanned                                                      |             |
| 31 | 198/2025/QH15            | 02           | 2025 | 4.1MB  | Fully scanned                                                      |             |
| 32 | 137/2025/QH15            | 02           | 2025 | 4.5MB  | Fully scanned                                                      |             |
| 33 | 114/2016/QH13            | 02           | 2016 | 175KB  | Fully scanned                                                      |             |
| 34 | 117/2020/QH14            | 02           | 2020 | 211KB  | Fully scanned                                                      |             |
| 35 | 246/2025/QH15            | 02           | 2025 | 6.6MB  | Fully scanned                                                      | ✅          |
| 36 | 14/2026/QH16             | 02           | 2026 | 773KB  | Fully scanned                                                      |             |
| 37 | 97/2025/QH15             | 02           | 2025 | 352KB  | Fully scanned                                                      |             |
| 38 | 148/2025/QH15            | 02           | 2025 | 1.2MB  | Fully scanned                                                      |             |
| 39 | 59/2018/QHH14            | 02           | 2018 | 210KB  | Fully scanned                                                      |             |
| 40 | 213/2025/QH15            | 02           | 2025 | 135KB  | Fully scanned                                                      |             |
| 41 | 88/2019/QH14             | 02           | 2019 | 494KB  | Fully scanned                                                      |             |
| 42 | 74/2022/QH15             | 02           | 2022 | 5.1MB  | Fully scanned (corrupted baked-in text layer — see Issues)        |             |
| 43 | 81/2025/QH15             | 02           | 2025 | 1.1MB  | Fully scanned                                                      |             |
| 44 | 43/2005/QH11             | 02           | 2005 | 33KB   | **Error — not actually a PDF** (mislabeled RTF, see Issues) |             |
| 45 | 44/2013/QH13             | 02           | 2013 | 2.5MB  | Fully scanned                                                      | ✅          |
| 46 | 94/2019/QH14             | 02           | 2019 | 446KB  | Fully scanned                                                      |             |
| 47 | 85/2015/QH13             | 02           | 2015 | 2.3MB  | Fully scanned                                                      | ✅          |
| 48 | 192/2025/QH15            | 02           | 2025 | 420KB  | Fully scanned                                                      |             |
| 49 | 134/2020/QH14            | 02           | 2020 | 719KB  | Fully scanned                                                      |             |
| 50 | 106/2016/QH13            | 02           | 2016 | 460KB  | Fully scanned                                                      |             |

Tier codes: `01` = `01-hien-phap`, `02` = `02-luat-nghi-quyet-quoc-hoi`, `03` = `03-phap-lenh-nghi-quyet-ubtvqh`.
Full citation/title/source-path detail is in `samples2/_manifest.json`.

## Issues

Every distinct finding from this evaluation, once each, grouped by what it's actually about — not by
when it was found.

### The corpus itself

- **PDF is almost entirely a tier-2 phenomenon.** Only 3 of 719 total PDFs in `laws/` exist outside
  `02-luat-nghi-quyet-quoc-hoi` (2 Hiến pháp, 1 Pháp lệnh) — so the 50-document stratified sample ending
  up 47/50 tier-2 is a fact about the corpus, not a sampling bias.
- **This corpus is overwhelmingly scanned, not digital-native.** 47/51 valid PDF classifications (92.2%)
  are fully scanned; only 3 are clean digital text, 1 is mixed. Year doesn't predict it — a 2025-dated
  law (`68/2025/QH15`) came back fully scanned same as a 2013 one. This is the fact that makes the
  Vietnamese-OCR problem below the dominant case for this pipeline, not an edge case in it.
- **A file mislabeled with the wrong extension.** `43/2005/QH11`'s `.pdf` file is actually RTF content
  — confirmed by reading raw bytes directly (`{\rtf1\ansi...`). pdf-inspector's sniffer guessed "JSON"
  (wrong, likely tripped by the leading `{`); markitdown's sniffer correctly identified RTF but then hit
  its own broken RTF handler (see below). A real `laws/` download/labeling bug, independent of this
  evaluation — worth a note to whoever owns `server/src/law/download`, since neither file extension nor
  either tool's content-sniffing can be fully trusted here.
- **A text layer that's present but already corrupted.** `74/2022/QH15` is classified "fully scanned" by
  pdf-inspector, yet markitdown (which never OCRs) extracted 580K real characters from it — because it
  has an embedded text layer, just one that's already diacritic-stripped (`"QUOC HOI CQNG HOa XA HOI CHU NGHIA VIET NAM"`), apparently from a low-quality OCR pass baked in before this pipeline ever touched
  it. A third failure mode beyond clean/scanned: present-but-unusable, invisible to a naive
  "does it have text?" check, and something a tool that trusts any existing text layer (markitdown) will
  silently index as-is.

### Tool-specific bugs

- **markitdown's RTF handling is completely broken, confirmed on two independent files.** It dumps the
  raw, unparsed `{\rtf1\ansi\ansicpg1252...}` control-code source as "successfully extracted" text —
  reports `status: ok`, a real character count, zero actual parsing. Found once on a genuine `.rtf`
  sample, found again independently on the mislabeled-extension file above. Two unrelated files, same
  exact failure — this is a permanent limitation of the tool's RTF path, not an edge case.
- **pdf-inspector's table detection has a real false-positive risk — but it's predictable.** On plain
  two-column prose (common in Vietnamese gazette layouts) it can confidently emit a garbled, misaligned
  Markdown table instead of returning nothing. Checked all 4 clean/mostly-clean documents in this
  evaluation specifically for this: the two that showed table garbling (one severely, one a minor 3-line
  false table) both had `is_complex_layout: true`; the two with zero garbling both had
  `is_complex_layout: false`. 4-for-4 — small n, but a free, already-computed signal worth gating on
  (see Recommendation).
- **docling's OCR pipeline has a severe, silent reliability bug.** `std::bad_alloc` (memory allocation
  failure) hits repeatedly on scanned documents beyond roughly 14–15 pages, and the failure rate
  *worsens* the more pages are processed within a single `.convert()` call — consistent with memory
  pressure accumulating within that one call, not across separate calls (confirmed directly: chunking
  the same 15-page document into 15 separate single-page `.convert()` calls within one reused converter
  instance completed with zero crashes — see the page-by-page entry in Metrics). Critically, **the
  failure is silent**: docling still returns `status: ok`, still writes a `.md` file, with no indication
  that whole pages were dropped. Confirmed by direct inspection — a 46-page document hit `bad_alloc` on
  pages 14–46 and its output cuts off mid-sentence with no error marker
  (`"...b) Bố trí phòng bỏ phiếu, chuẩn bị hòm phiếu;"` — then nothing): 26,371 characters captured for
  what should be a complete document (MinerU captured 97,394 characters — 3.7× more — from the identical
  file, running all the way to its real closing signature block). This is the single most dangerous
  failure mode found in this evaluation, because it looks exactly like success.
- **Neither docling's nor MinerU's default OCR has real Vietnamese language support.** Confirmed
  independently on both: docling (RapidOCR backend) tried `lang=['chinese']` (its own default),
  `['latin']`, and `['en']` — all three badly strip Vietnamese diacritics
  (`"Điều"` → `"Điu"`/`"Dièu"`, `"được"` → `"đưc"`/`"duoc"`, `"Luật"` → `"Lut"`/`"Luât"`). Checked
  RapidOCR's own supported-language list directly — no Vietnamese option exists at all. MinerU
  (`pipeline` backend, `-l ch` — the only remotely plausible option in its own enumerated list) produces
  the identical failure shape on the identical document. Neither tool's bundled OCR model was ever
  trained with real Vietnamese support.
- **MinerU cannot be given a different OCR engine at all — a hard architectural wall, not a config
  gap.** Confirmed by reading its source (`mineru/utils/ocr_language.py`): the `pipeline` backend's
  language selector is a hardcoded 12-value enum (`ch`, `korean`, `ta`, `te`, `ka`, `th`, `el`, `arabic`,
  `east_slavic`, `cyrillic`, `devanagari`), each pointing at its own bundled model + dictionary file — its
  own PyTorch reimplementation of PP-OCR, with no `easyocr`/`paddleocr` dependency anywhere in the
  installed package. `validate_public_ocr_lang()` raises a hard `ValueError` for anything outside that
  list, and there is no extension point to substitute a different engine. docling, by contrast, genuinely
  supports swappable OCR backends (`EasyOcrOptions`/`RapidOcrOptions`/`TesseractOcrOptions` are real,
  documented, interchangeable pipeline options) — a fundamentally different design. MinerU's separate
  `vlm-engine`/`hybrid-engine` backend (a vision-language model instead of the fixed pipeline) is a
  theoretical alternative path that was not tried — large extra model download, likely much slower on
  this CPU-only machine, and not worth the cost against the evidence that MinerU's pipeline backend was
  already the more reliable of the two default OCR tools.
- **Swapping in EasyOCR(vi) fixes docling's diacritics but introduces a new, different correctness bug:
  word order scrambles at line-wrap boundaries.** Confirmed on multiple pages, same consistent pattern
  each time — the last word (or few words) of a line that wraps mid-sentence gets displaced to the *end*
  of its paragraph instead of staying in place:

  > `"...tính theo 12 liên tục kể từ ngày đầu tiên có mặt tại Việt Nam; tháng"` (should read `"...tính theo 12 tháng liên tục kể từ ngày đầu tiên có mặt tại Việt Nam"` — `"tháng"` displaced to the end)
  >

  Every individual word is spelled correctly (diacritics intact) — this is purely a reading-order bug,
  not a character-recognition bug, and it's the kind of error that's easy to miss on a skim but corrupts
  anything downstream that assumes line order reflects reading order. Most likely cause: docling's
  layout-to-reading-order logic was tuned against RapidOCR's bounding-box conventions, and EasyOCR's
  boxes are shaped/ordered differently enough to break it. Page-by-page chunking (which fixes the crash,
  below) neither fixes nor worsens this bug, confirming it's a within-page issue, orthogonal to the
  memory problem.
- **Page-by-page chunking fixes docling's crash entirely — confirmed at full corpus-subset scale, not
  just on one document.** One `DocumentConverter` instance, reused across sequential single-page
  `.convert(path, page_range=(i, i))` calls instead of one whole-document call per file. First confirmed
  on a single 15-page document (15/15 pages, zero crashes); then re-run across the entire 11-document
  OCR subset (the same 11 documents used for the default-docling and MinerU reliability comparisons) —
  **295/295 pages completed, zero crashes**, including both documents that specifically triggered
  `bad_alloc` under default docling (the 37-page and 46-page documents, previously truncated at ~41% and
  ~27% of their real content, both completed in full here: 82,853 and 83,078 characters respectively).
  This directly confirms the diagnosis above: the memory pressure accumulates *within* one multi-page
  `.convert()` call, not across repeated calls to a reused converter, and the fix holds at scale, not just
  for one lucky document.
- **Per-page speed under EasyOCR varies enormously by document, and it lines up with whether the
  document has a real text layer.** Across the 295-page subset run, documents pdf-inspector classified as
  clean or mostly-clean (0 or 1 of their pages actually needing OCR) processed at roughly 1.1–1.3s/page —
  15–20× faster than the ~17–28s/page typical of fully-scanned documents. This held even though every
  page was run through the identical page-by-page EasyOCR pipeline regardless of classification,
  suggesting docling's own pipeline skips the actual OCR pass on pages that already carry a usable text
  layer, even with EasyOCR configured as the OCR backend. Good news for real-world throughput: a mixed
  corpus doesn't pay full OCR cost on every page, only on the pages that are genuinely scanned.
- **One document was anomalously slow under both OCR configurations, independent of engine.** `246/2025/QH15`
  (15 pages) averaged 41.6s/page here (up to 96.25s on one page) — and was also the single slowest
  document under default docling in this evaluation (688.3s total, with "RapidOCR returned empty result"
  warnings). Same anomaly, two different OCR engines — points to something about this specific
  document's scan quality or page complexity, not an OCR-engine-specific bug.

### Cross-cutting / integration issues, regardless of tool choice

- **None of the four base tools handle this corpus's legacy `.doc`/`.rtf` formats.** Per
  `laws/manifest.json` (1,155 documents total): 191 `.doc` (17%) + 236 `.rtf` (20%) = **37% of the
  existing corpus** untouched by any tool as-is. A LibreOffice-headless (`--convert-to docx`)
  pre-conversion step is a prerequisite regardless of which tool is chosen downstream — no LibreOffice
  install exists on this machine, so that step is itself unbuilt.
- **`document-node.parser.ts` is incompatible with every tool's output, the same way, regardless of
  tool.** It's a line-based plain-text parser —
  `DIEU_KHOAN_PATTERN = /^Điều\s+(\d+)([a-zđ]?)\s*[.:]?\s*(.*)$/iu` and friends are anchored to match a
  raw line starting *literally* with `"Điều"`/`"Chương"`/etc. — written against vbpl.vn's plain-innerText
  scrape, never against Markdown. Every tool tested prefixes detected headings with `#`/`##` (confirmed
  by reading real output files: `"## Điều 1. Phạm vi điều chỉnh"`), which the current regex does not
  match — same failure mode as the NFD/NFC bug already logged in
  `docs/monitoring/law-index-flagged-documents.md` §16. The parser's table-suppression heuristics
  (tuned for flattened plain-text table rows from vbpl.vn's scrape shape) don't apply to either Markdown
  pipe-tables (docling) or embedded HTML tables (MinerU) either — not actively harmful, but the table's
  real structure stays invisible to the parser regardless of source. **A preprocessing adapter is
  required before this parser can consume any of these tools' output** — at minimum stripping leading
  `#+\s*` from heading lines; this isn't a differentiator between tools, it's shared required work no
  matter which one wins.
- **Neither docling nor MinerU uses the available GPU by default.** Both resolved to CPU-only torch
  wheels on this machine despite an available RTX 3060; real GPU use needs an explicit CUDA-indexed pip
  install neither tool's default instructions set up automatically.

## Metrics

Six entries, one row each, per dimension. **n varies by entry** — pdf-inspector/markitdown/MinerU/docling
(default) were run across the full 56-document corpus (or the subset each format supports).
docling+EasyOCR whole-document was tested on one document (15 pages, confirmed scanned — the same one
where the original diacritics failure was found) and stayed there, since the result (a crash) made a
larger run pointless. docling+EasyOCR page-by-page started the same way, then was re-run across the full
11-document/295-page OCR subset (the same subset used for the default-docling and MinerU reliability
comparisons) once the single-document result looked promising enough to warrant checking at scale — see
Issues for the full findings from that larger run.

### Format coverage

| Entry                           | PDF (digital)                                   | PDF (scanned)                                                                                                  | `.docx`         | legacy`.doc`                           | `.rtf`                 |
| ------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------- | ------------------------ |
| pdf-inspector                   | ✅                                              | ⚠️ classify-only, no OCR                                                                                     | ❌ not a PDF tool | ❌                                       | ❌                       |
| markitdown                      | ✅                                              | ❌ silent empty                                                                                                | ✅                | ❌ clean exception                       | ❌ silent corruption     |
| MinerU                          | ✅                                              | ⚠️ OCR runs, diacritics unusable                                                                             | ✅                | ❌ not in supported list                 | ❌ not in supported list |
| docling (default)               | ✅                                              | ⚠️ OCR runs, diacritics unusable, and unreliable past ~14p                                                   | ✅                | ❌ hard error (despite claiming support) | ❌ explicit rejection    |
| docling + EasyOCR, whole-doc    | (not re-tested — same non-OCR path as default) | ⚠️ diacritics fixed, but crashes past ~14p                                                                   | (not re-tested)   | (not re-tested)                          | (not re-tested)          |
| docling + EasyOCR, page-by-page | (not re-tested)                                 | ✅ diacritics fixed, completes reliably (295/295 pages across 11 docs — see Reliability); word-order bug open | (not re-tested)   | (not re-tested)                          | (not re-tested)          |

### Correctness (diacritics + table fidelity)

| Entry                           | Digital-native text | Scanned-PDF text                                                                                                                            | Table fidelity                                                                                             |
| ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| pdf-inspector                   | Accurate, complete  | N/A — correctly detects "needs OCR," doesn't attempt                                                                                       | Usually correct; false-positive risk on complex layouts (see Issues), predictable via`is_complex_layout` |
| markitdown                      | Accurate, complete  | Silent failure — 0 chars, no error                                                                                                         | N/A (doesn't extract structured tables)                                                                    |
| MinerU                          | Accurate, complete  | Structure correct; diacritics badly garbled                                                                                                 | Correct data, but raw inline HTML`<table>` on one long line, not Markdown syntax                         |
| docling (default)               | Accurate, complete  | Structure correct; diacritics badly garbled                                                                                                 | Correct — clean native Markdown pipe-table when it doesn't crash                                          |
| docling + EasyOCR, whole-doc    | (not re-tested)     | **Diacritics correct** on completed pages; new word-order bug at line-wraps                                                           | Not evaluated this pass (crashed before reaching a table page)                                             |
| docling + EasyOCR, page-by-page | (not re-tested)     | **Diacritics correct**, confirmed on multiple documents up to 46 pages; same word-order bug, page-local, confirmed unchanged at scale | Not evaluated this pass                                                                                    |

One more risk found specifically on the digital-native case: pdf-inspector's heuristic table detector
produced a garbled, misaligned pipe-table on plain two-column running prose in one VAT law — not just
"returns nothing" on non-tables, it can confidently emit a wrong one (see Issues for the
`is_complex_layout` mitigation). Separately, the RTF legacy-encoding question this evaluation set out to
test (does anything correctly decode `.VnTime`/TCVN3 8-bit Vietnamese fonts to Unicode?) never actually
got exercised — three of the four base tools reject RTF outright, and the one that returns `status: ok`
(markitdown) isn't parsing the file at all, just echoing its raw bytes back.

### Reliability at scale

| Entry                           | Attempts                     | Completed cleanly                                                               | Known failure mode                                                                                                                                                                           |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdf-inspector                   | 52                           | 51 (1 correctly rejected malformed input)                                       | None — the one "failure" is the*correct* call on genuinely malformed input (the mislabeled RTF file); it's the only tool of the four that neither faked a result nor crashed on that file |
| markitdown                      | 56                           | 54 report`status: ok` (2 clean rejections)                                    | 46/56 silent-empty on scanned PDFs; 2/2 silent RTF-source-dump (see Issues) — zero crashes                                                                                                  |
| MinerU                          | 14                           | **14/14 (100%)**                                                          | None — zero crashes across both batches, including 65-page documents                                                                                                                        |
| docling (default)               | 17 attempted, 14 processable | 14/14 report`status: ok`, but only 9/14 (64%) actually match expected content | 5/14 (36%) show content loss; 3/14 (21%) lose >50%, silently, via`bad_alloc`                                                                                                               |
| docling + EasyOCR, whole-doc    | 1 document                   | 0/1                                                                             | Crashed at the final page, zero output                                                                                                                                                       |
| docling + EasyOCR, page-by-page | 11 documents, 295 pages      | **295/295 pages (100%)**                                                  | None — zero crashes, including on the exact 2 documents (37p, 46p) that crashed under default docling in this same table                                                                    |

### Speed (CPU-only, wall-clock)

| Entry                           | Total time                                                             | Total characters captured | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdf-inspector                   | Negligible (sub-100ms/doc, up to ~0.23s when generating real markdown) | —                        | Effectively free next to the other five                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| markitdown                      | 48.4s across 56 docs                                                   | —                        | Fast because it does little on scanned input (no OCR)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| MinerU                          | 3,231.3s (~53.9 min) across 14 docs                                    | 821,861                   | 2–5× slower than default docling; no wasted work — every character captured is real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| docling (default)               | 1,715s (~28.6 min) across 14 processable docs                          | 653,412                   | Fast per-document, but a meaningful share of both the time and the characters is spent on documents that silently lost content                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| docling + EasyOCR, whole-doc    | Never completed (crashed)                                              | 0                         | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| docling + EasyOCR, page-by-page | 4,438.4s (~74.0 min) across the 11-document/295-page subset            | 635,174                   | ~2.8× slower than default docling on the identical 11 documents (1,564.8s) overall — but that ratio understates the real cost, since a chunk of default docling's "fast" time on the 2 documents it crashed on came from stopping early, not from finishing. Per-page speed varies enormously by document: ~1.1–1.3s/page on documents with a real text layer (docling appears to skip the actual OCR pass there even with EasyOCR configured), ~17–28s/page on genuinely scanned ones, and one document anomalously slow (~41.6s/page) under both this and default docling — see Issues |

### Setup complexity

| Entry                            | Install                                                                       | Real footguns hit                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| pdf-inspector                    | `pip install pdf-inspector`                                                 | None — simplest of all six by a wide margin                                                                                       |
| markitdown                       | `pip install markitdown[pdf,docx]`                                          | `[all]` extra is broken on PyPI (bad dependency pin) — scope extras to what's needed                                            |
| MinerU                           | `pip install mineru[core]` in a dedicated Python <3.14 venv                 | Hard Python version cap (but pip fails loudly/immediately); heaviest download (bundles a full Gradio web UI even for CLI-only use) |
| docling (default)                | `pip install docling`                                                       | Needs`TORCHDYNAMO_DISABLE=1` or an MSVC compiler to run at all on Windows; default OCR language is silently wrong for Vietnamese |
| docling + EasyOCR, either config | Add`pip install easyocr`, set `ocr_options = EasyOcrOptions(lang=['vi'])` | Same docling footguns as above, plus: EasyOCR downloads its own detection/recognition models on first use                          |

### Parser compatibility

Identical situation across all six entries, so one line covers it: every tool's Markdown output prefixes
headings with `#`/`##`, which `document-node.parser.ts`'s current line-based regex does not match at all
— see Issues for the full explanation. This is not a differentiator between entries; it's required
adapter work regardless of which one is chosen.

## Final verdict and conclusion

The scanned-PDF OCR problem — the actual reason chinhphu.vn+OCR was on the table — comes down to one
fact: **this corpus is 92%+ scanned Vietnamese PDF, and no tool's default OCR configuration produces
usable text for it.** Vietnamese diacritics are semantically load-bearing (`ma`/`má`/`mà`/`mã`/`mạ` are
five different words), so a reliably-completing pipeline that produces wrong diacritics (MinerU, docling
default) is not actually more useful than an unreliable one — both are non-starters for this corpus's
dominant case, just in different ways.

Fixing the OCR language is possible for exactly one of the two candidates. MinerU's OCR engine is a
closed system — confirmed by reading its source, not inferred — so there is no tested or available path
to Vietnamese support for it. docling's is genuinely pluggable, and EasyOCR(`lang='vi'`) is a real,
verified fix for the character-accuracy half of the problem. But that fix alone made docling's other
known weakness (the `bad_alloc` reliability crash) worse, not better — until combined with page-by-page
processing, which fixes the crash completely without touching the diacritics fix. That fix isn't a
single-document fluke: confirmed first on one 15-page document (15/15 pages), then re-confirmed across
the entire 11-document/295-page reliability subset (295/295 pages, zero crashes, including on the exact
two documents that crashed under default docling). The combination — EasyOCR(vi) + page-by-page — is the
only tested configuration, across all six entries in this evaluation, that produces correct Vietnamese
text *and* completes reliably, and that conclusion now rests on 295 pages of evidence, not one document.
It is not fully solved: a distinct word-order bug remains at line-wrap boundaries (confirmed unchanged
at the larger scale too), and the configuration is meaningfully slower than default docling — roughly
2.8× overall, though that ratio actually understates the gap, since default docling's numbers on the two
documents it crashed on look artificially fast because it stopped early rather than finished. Speed also
turns out to depend heavily on the document: pages with an existing text layer process 15–20× faster
than genuinely scanned ones, since docling appears to skip the real OCR pass on them even with EasyOCR
configured — so the realistic cost of this configuration is lower than the worst-case numbers suggest for
a corpus that isn't 100% scanned. Both open issues are bounded problems with concrete next steps (see
Recommendation), not reasons to discard the approach.

Outside the OCR question entirely, two things hold regardless of which tool is chosen: 37% of the
existing `laws/` corpus (`.doc` + `.rtf`) is untouched by every tool tested and needs a separate
LibreOffice pre-conversion step that doesn't exist yet, and `document-node.parser.ts` needs a
preprocessing adapter (strip Markdown heading syntax, parse native pipe-tables) before it can consume
output from any of these tools — necessary work either way, not a cost specific to the recommended path.

## Recommendation

### The core call: docling + EasyOCR(`lang='vi'`), run page-by-page, for anything that needs OCR

This is the only tested configuration that clears both hard requirements at once — correct Vietnamese
text and reliable completion (see Metrics and Final verdict, above).

One known defect remains open, and it's a content-correctness bug, not something the parser rewrite can
absorb: words get displaced to the end of a line when a sentence wraps mid-line. Two cheap things to try
before writing anything custom:

1. Swap `TesseractOcrOptions` in for `EasyOcrOptions` — docling supports it natively, and Tesseract's
   layout analysis differs enough from EasyOCR's that it might not inherit the bug at all.
2. If that doesn't pan out, the fix is likely a targeted re-sort of docling's text elements by
   bounding-box position (top-to-bottom, left-to-right) before `export_to_markdown()` —
   `result.document` already carries the bbox data, and the bug looks like it's in how the markdown
   export orders things, not in the OCR pass itself.

### pdf-inspector as primary for anything that *doesn't* need OCR

pdf-inspector wins on every metric that matters for the common case — cost, speed, and accuracy on text
that's actually there — so it should own routing, not just be one candidate among six:

1. **Classify first, always.** `<100ms`, correctly identified scanned-vs-digital across all 52 PDFs
   attempted in this evaluation. Only pay for docling+EasyOCR on documents/pages it actually flags as
   needing OCR.
2. **Trust its markdown output directly when `pages_needing_ocr == 0` and `is_complex_layout == false`.**
   The table false-positive found in this evaluation correlated 4-for-4 with `is_complex_layout` — a
   signal pdf-inspector already computes for free (see Issues).
3. **When `is_complex_layout == true`, don't trust the table output blindly.** Route the table-bearing
   sections through docling for a cross-check, or flag for the same kind of spot-review pattern this
   project already uses in `docs/monitoring/law-index-flagged-documents.md`. This doesn't disqualify
   pdf-inspector as primary — none of the six entries were fully hands-off anywhere in this evaluation —
   it just means the primary path needs one guardrail, not zero.

### markitdown: narrow but real — `.docx` only

pdf-inspector doesn't touch `.docx` at all, and there's no reason to run a second tool on a PDF
pdf-inspector already owns cleanly. markitdown's role narrows to exactly the gap: primary for `.docx`
(accurate and fast there in every test), nothing else. Its scanned-PDF and RTF failure modes disqualify
it everywhere else.

### `.doc` / `.rtf`: still unsolved, still a separate work item

None of the tools handle these — this recommendation doesn't change that. A pre-conversion step to
`.docx`/`.pdf`, run upstream of the whole pipeline above, is still the prerequisite. **Not yet installed
or tested on this machine — this subsection is a recommendation to validate, not a result to trust
blindly, unlike the rest of this report.**

**Recommended: LibreOffice headless conversion**
(`soffice --headless --convert-to docx file.doc`, or `--convert-to pdf`). It natively reads both legacy
binary `.doc` and `.rtf`, is free, and is one of the most battle-tested open-source implementations of
legacy MS Office format compatibility available. Two things to get right, not just "install it and call
it done":

- **Don't spawn a fresh `soffice` process per file.** Naive per-file CLI invocation pays real startup
  overhead (~2–5s) and concurrent invocations can hit user-profile lock conflicts — this doesn't scale
  cleanly to a corpus this size. Run it as a persistent listener instead: either `unoconv` (a wrapper
  that talks to a long-running LibreOffice instance over its UNO API) or LibreOffice's own `--accept`
  socket mode.
- **Verify it correctly decodes this corpus's legacy Vietnamese encoding before trusting it.** The
  `.rtf` sample in this evaluation used `.VnTime`/`.VnTimeH` fonts — TCVN3/VNI 8-bit encoding, not
  Unicode. "LibreOffice supports RTF" doesn't automatically mean it correctly remaps that specific
  legacy 8-bit font scheme to proper Unicode diacritics on output. This is a real, testable,
  project-specific risk, not something to assume from LibreOffice's general format support — exactly
  the kind of claim this evaluation otherwise verified directly rather than took on faith.

**Alternatives, with honest tradeoffs, if LibreOffice doesn't pan out:**

- **Aspose.Words** (commercial .NET/Java/Python library) — generally the highest-fidelity legacy-format
  converter available, no LibreOffice/Word dependency, but it costs money, unlike everything else
  evaluated in this report.
- **MS Word via COM automation** (`pywin32`) — native fidelity since it's the format's own owner, but
  requires an actual licensed Word install on the machine and is fragile for unattended server
  automation.
- **Pandoc** — handles `.rtf` reasonably, but support for the old *binary* `.doc` format as input is
  uncertain and unverified here; don't assume it without testing, the same way LibreOffice's RTF fidelity
  above needs testing.

Concrete next step, not yet done: install LibreOffice, run it against this project's real `.doc`/`.rtf`
samples, and specifically check whether the TCVN3/VNI-encoded `.rtf` sample decodes to correct Unicode
Vietnamese — before this becomes a trusted part of the pipeline.

### What this fixes for the parser rewrite

Given the parser is being rewritten to consume Markdown rather than vbpl.vn's flat scraped text anyway,
this architecture fixes the concrete shape it needs to handle:

- Strip leading `#+\s*` before matching `Điều`/`Chương`/etc. — every tool tested prefixes headings this
  way, not a docling-specific quirk.
- Parse native Markdown pipe-tables (`| ... |`) as structured cells — this is specifically docling's
  table shape. (MinerU's is raw inline HTML `<table>` instead — a different branch entirely; not needed
  for this recommendation, but worth keeping the table-ingestion layer's design aware of that shape if
  MinerU is ever revisited.)
- Don't assume line order is reading order for OCR-sourced content until the word-order bug above is
  actually closed — worth a validation pass (e.g. spot-checking reconstructed sentences against a
  known-good phrase list) before trusting page-by-page docling+EasyOCR output at face value in
  production.

## Files

- `samples/`, `samples2/`, `samples2_ocr_subset/` — source documents (gitignored, copies of
  already-gitignored `laws/` data)
- `outputs/<tool>/`, `outputs2/<tool>/` — each tool's `.md` output per sample + `_timings.json`
- `scripts/run_*.py` — the conversion harnesses used across the evaluation
- `.venv-mineru/` — MinerU's dedicated Python 3.12 environment (gitignored)
