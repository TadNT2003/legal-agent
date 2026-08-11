# Text-extraction tool evaluation: docling vs. markitdown vs. pdf-inspector vs. MinerU

Evaluated as candidate PDF/DOCX/RTF/DOC → Markdown converters for the proposed chinhphu.vn+OCR
fallback pipeline (used when a citation is missing from vbpl.vn). Branch: `evaluate/document-parser`.
Two passes: round 1 (6 hand-picked docs, format diversity — PDF/DOCX/RTF/DOC) and round 2 (50 more
PDF-only docs, stratified by tier/year/size, since PDF is what new documents actually arrive as).

## Executive summary

| | pdf-inspector | markitdown | docling | MinerU |
|---|---|---|---|---|
| **Role** | Free pre-router: classify text-vs-scanned in <100ms before paying for OCR | Fast path for genuinely clean input (digital PDF, docx) | OCR workhorse candidate — best output shape, worst reliability | OCR workhorse candidate — slowest, but the reliable one |
| **Vietnamese OCR** | N/A, never attempts OCR | N/A, never attempts OCR | **Broken** — no Vietnamese in RapidOCR's language list; tried chinese/latin/en, all garble diacritics | **Broken** — same failure, independently confirmed; no Vietnamese in its language list either |
| **Reliability at scale** | No failures across 56 docs total | No crashes; but silently returns empty on scanned PDFs and silently corrupts on RTF | **`std::bad_alloc` past ~14 pages**, worsening through a session — silently truncates output while reporting success (confirmed: 46-page doc cut off mid-sentence at page 14, no error) | Zero crashes across the same 11-doc subset incl. 65-page docs; verified output reaches the true end of the source document |
| **Format coverage** | PDF only | PDF, docx; clean reject on .doc; **catastrophic** silent failure on RTF (dumps raw source as "success") | PDF, docx; explicit reject on RTF; hard error on .doc | PDF, image, docx, pptx, xlsx; no .doc/.rtf attempt at all |
| **Speed (CPU-only)** | ~free (<100ms) | Fast when it does anything (no OCR cost) | Fast *when clean*, but wildly variable (688s outlier) and undercuts its own numbers via silent truncation | Consistently slowest, 2–5× docling — but is actually finishing the document |
| **Setup complexity** | Trivial — single wheel, no models | Light, but `[all]` extra is broken on PyPI | Heaviest footguns: needs `TORCHDYNAMO_DISABLE=1` or MSVC; wrong OCR language by default, silently | Needs its own Python <3.14 venv; heaviest download; same OCR-language gap |

**Bottom line:** none of the four is deployable as-is for this corpus's actual dominant case — scanned
Vietnamese PDFs (94% of the PDF corpus per round 2). pdf-inspector and markitdown are solid, low-risk
building blocks for the parts of the pipeline they're actually suited to (routing, and clean-text
extraction). Between the two OCR-capable candidates, MinerU is the safer default *today* despite being
much slower — a wrong-looking result that silently drops two-thirds of a document is worse than a slow
correct one. Round 3 (below) tried the obvious fix — swap in a Vietnamese-capable OCR engine — on
docling (MinerU can't take it at all, architecturally): it genuinely fixes character-level diacritics,
but trades that for a new word-reordering bug and makes docling's `bad_alloc` reliability problem worse,
not better. **So the OCR-language gap isn't a simple missing-config-flag fix** — closing it well enough
to matter is its own open problem, not a one-line change either tool was one setting away from. Also
unconditional on tool choice: ~37% of the existing `laws/` corpus (.doc + .rtf) is untouched by all four
tools, and `document-node.parser.ts` needs a preprocessing adapter (strip Markdown heading syntax) before
it can consume any of their output.

## Setup

**Main venv (`.venv/`, Python 3.14.4, repo root)** — already had `docling`, an early `markitdown`
(0.0.2), `torch` (CPU wheel), and `pdfminer.six` preinstalled before this pass started. Added:

- `markitdown` upgraded 0.0.2 → 0.1.7, scoped to `[pdf,docx]` extras only. `markitdown[all]==0.1.7`
  is currently **broken on PyPI** — it pins `youtube-transcript-api~=1.0.0`, and no release in that
  exact line exists (published versions jump 0.6.2 → 1.2.3). Installing `[all]` fails outright;
  install only the extras you need.
- `pdf-inspector` 0.2.7 — installed clean, no issues (PyO3/Rust wheel, `cp38-abi3`, so it's
  Python-version-agnostic; the only one of the four that installed on 3.14 without any caveat).

**Second venv (`sandbox/text-extract-evaluation/.venv-mineru/`, Python 3.12.1)** — `mineru` caps at
`Requires-Python >=3.10,<3.14`, so it cannot install into the main 3.14 venv at all (pip fails
immediately and explicitly). Used `py -0p` to find an existing Python 3.12 install (`C:\Python312`)
and created a dedicated venv there. Installed `mineru[core]` 3.4.4.

**Both docling and MinerU ran CPU-only.** This machine has an RTX 3060 (6GB VRAM, driver 596.36,
CUDA 13.2), but `pip install torch` on this platform/index resolves to the CPU-only wheel
(`torch-2.13.0+cpu`) in *both* venvs — GPU use requires an explicit CUDA-indexed install
(`--index-url https://download.pytorch.org/whl/cu...`) that neither tool's default install path
sets up for you. All timings below are CPU-only; ranking between docling/MinerU specifically could
shift under GPU.

**docling-specific blocker:** its default pipeline invokes `torch.compile` (TorchInductor), which
needs an MSVC C++ compiler (`cl.exe`) — not present on this machine, and it fails hard
(`InvalidCxxCompiler`) rather than falling back. Worked around with `TORCHDYNAMO_DISABLE=1` (forces
eager execution). Without that env var, docling does not run at all on a fresh Windows box with no
Visual Studio Build Tools installed.

**Samples** (`samples/`, copied from `laws/`, not committed — see `.gitignore`): picked for format
× content diversity, not randomly —

| #  | Document                         | Format      | Why picked                                                                                                                                                       |
| -- | -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 | 48/2024/QH15 (Luật Thuế GTGT)  | PDF, 20p    | Digital-native — confirmed real text layer via`pypdfium2`                                                                                                     |
| 02 | 109/2025/QH15 (Luật Thuế TNCN) | PDF, 15p    | Confirmed**zero** text layer (genuinely scanned) via `pypdfium2`; contains the progressive tax-bracket table — the hardest case (OCR + table, together) |
| 03 | 57/2010/QH12 (Luật Thuế BVMT)  | legacy .doc | Small, has its own tax-rate table                                                                                                                                |
| 04 | 01/2002/QH11 (Luật Ngân sách) | legacy .doc | Plain prose, no table                                                                                                                                            |
| 05 | Hiến pháp 1980                 | .rtf        | Uses`.VnTime`/`.VnTimeH` — legacy TCVN3/VNI 8-bit Vietnamese font encoding, not Unicode                                                                     |
| 06 | 248/2025/QH15                    | .docx       | Modern Office XML baseline                                                                                                                                       |

## Headline finding: neither ML tool can OCR Vietnamese out of the box

This is the finding that matters most, since OCR-ing chinhphu.vn's scanned PDFs is the actual
reason this evaluation exists. On sample 02 (confirmed scanned, no text layer):

- **docling** (RapidOCR backend) tried with `lang=['chinese']` (its own default), `['latin']`, and
  `['en']` — all three produce badly diacritic-stripped Vietnamese: `"Điều"` → `"Điu"`/`"Dièu"`,
  `"được"` → `"đưc"`/`"duoc"`, `"Luật"` → `"Lut"`/`"Luât"`. Checked RapidOCR's own supported
  recognition languages directly (`rapidocr.LangRec`) — there is no Vietnamese option at all; the
  closest is a generic `latin` model, which still fails badly on Vietnamese's dense diacritic stack.
- **MinerU** (`pipeline` backend, `-l ch` — the only option in its enumerated `--help` language list
  that was even plausible; MinerU's list also has no Vietnamese, no generic latin/en option either)
  produces the **same failure shape** on the same document — same words, same missing tone marks.
- Since this failure is confirmed independently on two different tools/OCR stacks with multiple
  language settings, it isn't a config mistake on my part — Vietnamese just isn't a supported
  language for either tool's bundled OCR models as shipped.
- **pdf-inspector** and **markitdown** don't inherit this bug because neither attempts OCR at all
  (see below) — but that means zero usable content from them on scanned input, not a win.
- Not tested here (time-boxed out): EasyOCR does list `'vi'` as a supported language and docling can
  use it as a pluggable OCR backend instead of RapidOCR — worth trying before ruling out docling
  entirely. Not installed in this pass.

**Practical takeaway: whichever tool is chosen, plan on plugging in a Vietnamese-capable OCR engine
explicitly (EasyOCR with `lang='vi'`, or Tesseract's `vie` traineddata) — the default OCR path in
both docling and MinerU is not usable for this corpus as configured.**

## Metric: correctness (incl. table fidelity)

|               | Digital-native PDF text | Scanned PDF text                                                                  | Scanned PDF table                                                                                                          | RTF (legacy VNI/TCVN3)                                                                                                                                                                                            |
| ------------- | ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdf-inspector | Accurate, complete      | N/A — correctly detects "needs OCR", returns no markdown, does not attempt       | N/A                                                                                                                        | N/A (PDF-only tool)                                                                                                                                                                                               |
| markitdown    | Accurate, complete      | **Silent failure** — reports `status: ok`, 0 chars, no error, no warning | N/A                                                                                                                        | **Silent corruption** — reports `status: ok`, 127,938 chars, but the "extracted text" is the *raw, unparsed RTF control-code source* (`{\rtf1\ansi\ansicpg1252...`), not a converted document at all |
| docling       | Accurate, complete      | Structure (headings) correct;**prose text badly garbled** (see above)       | **Correct** — clean native Markdown pipe-table, right numbers in the right cells despite surrounding OCR errors     | N/A — explicit`File format not allowed` rejection                                                                                                                                                              |
| MinerU        | Accurate, complete      | Structure correct;**same garbling as docling**                              | **Correct** — but emitted as raw inline HTML `<table>...</table>` on one very long line, not Markdown pipe syntax | N/A — not in its supported-format list, silently skipped                                                                                                                                                         |

One more real risk found on the digital-native PDF: **pdf-inspector's heuristic table detector
produced a garbled, misaligned pipe-table** on plain two-column running prose in the VAT law (a
common Vietnamese gazette layout) — cells from unrelated clauses got merged together. It's not just
"returns nothing" on non-tables; it can confidently emit a wrong table. Worth knowing before trusting
its `is_complex_layout`/table output blindly.

The RTF legacy-encoding question I specifically picked sample 05 to test (does anything correctly
decode `.VnTime`/TCVN3 8-bit Vietnamese fonts to Unicode?) **never actually got exercised** — three
of the four tools reject RTF outright, and the one that returns `status: ok` (markitdown) isn't
parsing the file at all, just echoing its raw bytes back.

## Metric: format coverage

| Format        | pdf-inspector              | markitdown               | docling                                                            | MinerU                       |
| ------------- | -------------------------- | ------------------------ | ------------------------------------------------------------------ | ---------------------------- |
| PDF (digital) | ✅                         | ✅                       | ✅                                                                 | ✅                           |
| PDF (scanned) | ⚠️ classify-only, no OCR | ❌ silent empty          | ⚠️ OCR runs, text unusable                                       | ⚠️ OCR runs, text unusable |
| .docx         | ❌ not a PDF tool          | ✅                       | ✅                                                                 | ✅                           |
| legacy .doc   | ❌                         | ❌ clean exception       | ❌ hard error (despite being listed as a supported`InputFormat`) | ❌ not in supported list     |
| .rtf          | ❌                         | ❌ (silently, see above) | ❌ explicit rejection                                              | ❌ not in supported list     |

**None of the four tools handle this corpus's legacy `.doc` or `.rtf` files correctly.** Per
`laws/manifest.json` (1,155 documents total): 191 `.doc` (17%) + 236 `.rtf` (20%) = **37% of the
existing corpus** these tools can't touch as-is. A LibreOffice-headless (`--convert-to docx`)
pre-conversion step would be a prerequisite regardless of which of these four is chosen — no
LibreOffice install was found on this machine, so that step is itself unbuilt.

## Metric: time to process (CPU-only, single-threaded, wall-clock)

| Sample                    | pdf-inspector         | markitdown             | docling      | MinerU  |
| ------------------------- | --------------------- | ---------------------- | ------------ | ------- |
| 01 clean PDF, 20p         | 0.08s                 | 5.5s                   | 52.6s        | 236.0s  |
| 02 scanned PDF, 15p (OCR) | 0.01s (classify only) | 0.07s (no-op)          | 97.0s        | 151.3s  |
| 03 .doc (table)           | n/a                   | error, 0.01s           | error, 0.1s  | skipped |
| 04 .doc (plain)           | n/a                   | error, 0.01s           | error, 0.04s | skipped |
| 05 .rtf                   | n/a                   | 0.02s (garbage output) | error, 0.0s  | skipped |
| 06 .docx                  | n/a                   | 0.59s                  | 1.0s         | 25.2s   |

pdf-inspector is near-free (no ML models, sub-100ms). markitdown is fast for what it does but does
much less (no OCR, no real layout model). docling and MinerU pay real per-page ML cost
(layout + OCR + table-structure models); MinerU ran consistently slower than docling here, notably
on the trivial `.docx` (25.2s vs. 1.0s) — that looks like fixed per-invocation pipeline/model-load
overhead in the CLI rather than actual work, which would amortize away under a persistent
server process instead of one-shot CLI calls (see below).

## Metric: concurrency / batch support

Not load-tested at scale (time-boxed) — from API/CLI shape:

- **pdf-inspector**: stateless Rust calls, trivially safe across threads/processes.
- **markitdown**: stateless per-call converter, safe across processes; no persistent model state to
  worry about.
- **docling**: `DocumentConverter` is reusable/re-invocable (used this way in the harness) and its
  own API supports batch conversion over an iterable of paths with models loaded once. Scaling
  beyond one machine's CPU/GPU means running multiple worker processes, each paying its own
  layout+OCR+table model memory cost.
- **MinerU**: has an explicit client/server split built in — `--api-url` / `vlm-http-client` /
  `hybrid-http-client` backends are designed for a shared inference server fielding concurrent
  requests from lightweight clients. This is a more deliberate concurrency story than docling's
  "run more processes," and matches the ~25s fixed CLI-invocation overhead observed above — MinerU
  looks built to be run as a service, not shelled out to per-document.

## Metric: setup complexity

- **pdf-inspector**: `pip install pdf-inspector`. No system deps, no models. Simplest of the four by
  a wide margin, and the only one that installed on Python 3.14 with zero caveats.
- **markitdown**: `pip install markitdown[pdf,docx]`. Pure-Python-ish, no GPU/models. One real
  footgun: don't use the `[all]` extra (broken dependency pin, see Setup above) — scope extras to
  what's actually needed.
- **docling**: heaviest dependency tree (torch, transformers, onnxruntime, rapidocr,
  docling-ibm-models, doclang...). Two real footguns hit in this pass: (1) needs
  `TORCHDYNAMO_DISABLE=1` or an MSVC compiler to run at all on Windows; (2) default OCR language is
  silently wrong for Vietnamese with no warning.
- **MinerU**: needed its own Python 3.12 venv (hard version cap, but pip fails loudly and
  immediately, so at least it's obvious). Heaviest install by download size — bundles a full Gradio
  web UI as a dependency even for pure CLI use. Same no-Vietnamese-OCR gap as docling, same
  CPU-only-by-default torch.

## Metric: parser compatibility (against `document-node.parser.ts`)

Read the actual parser to check this rather than guessing. It's a **line-based plain-text** parser —
`DIEU_KHOAN_PATTERN = /^Điều\s+(\d+)([a-zđ]?)\s*[.:]?\s*(.*)$/iu` and friends are anchored to match a
raw line starting *literally* with `"Điều"`/`"Chương"`/etc., over text split on `\r?\n`. It was
written against vbpl.vn's plain-innerText scrape — never against Markdown.

- Both docling and MinerU prefix every detected heading with `#`/`##` in their output — confirmed by
  reading the actual files: `"## Điều 1. Phạm vi điều chỉnh"`. `DIEU_KHOAN_PATTERN` does **not**
  match this line (it starts with `#`, not `Điều`) — the parser would silently fail to recognize
  every single Điều/Chương heading from either tool's output, same failure mode as the NFD/NFC bug
  already logged in `docs/monitoring/law-index-flagged-documents.md` §16.
- pdf-inspector's Markdown output uses the same heading-marker convention — same problem.
- The parser's table-suppression heuristics (`TABLE_HEADER_PATTERN`, `looksLikeTableFragment`,
  tab-character detection) are tuned for *flattened plain-text* table rows from vbpl.vn's scrape
  shape. They don't apply to either Markdown pipe-tables (docling) or embedded HTML tables (MinerU)
  — those pass through as inert appended text. Not actively harmful (no fake Khoản collisions), but
  the table's actual structure is invisible to the parser either way; there's no table-extraction
  path downstream yet regardless of source.
- Some existing suppression rules are vbpl.vn-rendering-specific and won't fire the same way against
  chinhphu.vn-sourced Markdown — `AMENDMENT_ANNOTATION_LINE` is literally vbpl.vn's own injected UI
  text and will just never match (harmless no-op for a new source, not a bug). Others
  (`FOOTER_START_PATTERN`, Phụ lục detection) are standards-based (Nghị định 78/2025/NĐ-CP) and
  should generalize regardless of source site.

**Conclusion: a preprocessing adapter is required before `document-node.parser.ts` can consume
*any* of these four tools' output** — at minimum stripping leading `#+\s*` from heading lines. This
isn't a differentiator between the four tools; it's a shared next step no matter which wins.

## Overall verdict

1. **The scanned-PDF OCR problem — the actual reason chinhphu.vn+OCR was on the table — is not
   solved by either ML candidate as configured.** Both fail identically on Vietnamese diacritics.
   Before picking between docling and MinerU on any other axis, get EasyOCR (`lang='vi'`) or
   Tesseract (`vie`) working under one of them and re-run sample 02 — that result should decide the
   tool choice, not raw speed or table formatting.
2. **pdf-inspector's real role isn't "competing converter," it's a near-free pre-router.** It
   classified sample 01 as text-based and extracted it completely in 80ms — docling took 52.6s and
   MinerU took 236s on the identical file. Route every PDF through pdf-inspector's `<100ms`
   classification first; only pay for docling/MinerU on pages it actually flags as needing OCR.
3. **37% of the existing `laws/` corpus (.doc + .rtf) is untouched by all four tools.** A
   LibreOffice-headless conversion step is a prerequisite for those formats no matter what's chosen
   downstream, and doesn't exist yet on this machine.
4. **Table shape differs meaningfully between the two OCR-capable tools when they do work**: docling
   → clean Markdown pipe-table; MinerU → correct but raw inline HTML. Neither is directly usable by
   the current parser without new table-handling logic, but docling's shape is closer to something a
   human (or a future table-aware parser) can read directly.
5. Regardless of which tool(s) are adopted, budget for a `document-node.parser.ts` preprocessing
   adapter (strip Markdown heading syntax) as separate, required work — it's not something any of
   the four tools' output avoids needing.

## Round 2: 50 more PDF-only samples

Round 1 used 6 hand-picked documents across 4 formats. Round 2 drops the legacy-format axis (per
request — .doc/.rtf are declining/legacy, PDF is what new documents actually arrive as) and instead
tests format-coverage depth: 50 more PDFs, stratified across tier/year/size, sourced from
`laws/manifest.json` (excluding the 2 already used). 719 PDFs exist in the corpus total; the
stratification immediately surfaced that **PDF is almost entirely a tier-2 (`02-luat-nghi-quyet-quoc-hoi`)
phenomenon** — only 3 PDFs exist outside that tier (2 Hiến pháp, 1 Pháp lệnh) — so despite deliberately
spreading the pick across all tiers, 47/50 samples ended up tier-2 by construction, not selection bias.
Years span 2005–2026, sizes 33KB–21.5MB.

### New finding: this corpus is overwhelmingly scanned, not digital-native

Classified all 50 with pdf-inspector first (near-free, <10ms/doc) before committing to any expensive
OCR runs. Result: **46 of 49 valid PDFs (94%) are fully scanned — only 2 are clean digital-native text,
1 is mixed.** This directly contradicts the "newer documents are more likely digital-native" assumption
that motivated testing PDF specifically — year doesn't predict it; a 2025-dated law (`68/2025/QH15`)
came back fully scanned just like a 2013 one. **This raises the stakes on the round-1 headline finding
enormously**: if ~94% of this format needs real OCR, and neither docling nor MinerU can OCR Vietnamese
correctly by default (round 1), that default gap blocks correct ingestion of nearly the entire PDF slice
of this corpus, not an edge case within it.

One file failed classification outright: `44_...43-2005-QH11.pdf` — `ValueError: Not a PDF: file
appears to be JSON`. Checked raw bytes directly: it's neither PDF nor JSON, it's **RTF** content
(`{\rtf1\ansi...`) saved under a `.pdf` filename — a real `laws/` download/labeling bug, independent of
this evaluation. pdf-inspector's sniffer likely mis-guessed "JSON" off the leading `{`; markitdown's
sniffer (probably `magika`) correctly detected RTF but then hit the same broken RTF handler from round 1
— dumped the raw RTF source verbatim as "successful" 33,371-char output. Worth a note to whoever owns
`server/src/law/download` — file-extension trust isn't safe for this corpus, and content-sniffing itself
isn't fully reliable either (two different sniffers, two different wrong guesses).

Also found via markitdown (which does zero OCR, so any non-empty output on a pdf-inspector-flagged
"scanned" doc means a real, if degraded, text layer exists): `42_...74-2022-QH15.pdf`
(pdf-inspector: fully scanned) actually has an embedded text layer — but the layer itself is already
corrupted (`"QUOC HOI CQNG HOa XA HOI CHU NGHIA VIET NAM"`, zero diacritics). This looks like a
low-quality OCR pass baked into the PDF before it ever reached this pipeline — **a third failure mode**
beyond clean-digital/needs-OCR: a *present-but-unusable* text layer, invisible to a naive
"does it have text?" check, and one that would get silently indexed as-is by any tool (like markitdown)
that trusts an existing text layer without validating its content.

### New finding: docling has a real reliability problem at realistic document sizes; MinerU doesn't

Round 1's docling/MinerU comparison used only 6 short documents (max 20 pages) in one process — too
small to see this. Round 2 ran both across an 11-file subset (8 confirmed-scanned docs spanning
2013–2025 and 1–65 pages, plus the 3 clean/mixed ones from round 2's classification pass), reusing one
`DocumentConverter`/CLI session per tool, same as round 1's harness pattern.

**docling threw repeated `std::bad_alloc` (memory allocation failure) on every scanned document beyond
roughly 14 pages**, and the pattern worsens progressively later in the session (more affected pages, on
later documents, as the run goes on) — consistent with the process accumulating memory pressure across
repeated `.convert()` calls rather than a one-off bad file. Critically, **the failure is silent**:
docling still returns `status: ok`, still writes a `.md` file, and gives no indication in the output that
whole pages were dropped. Confirmed by direct inspection — sample 47 (`85/2015/QH13`, 46 pages) hit
`bad_alloc` on pages 14–46 and its output file cuts off mid-sentence with no error marker
(`"...b) Bố trí phòng bỏ phiếu, chuẩn bị hòm phiếu;"` — then nothing): 26,371 characters captured for
what should be a full 46-page law.

MinerU ran the identical 8 scanned documents with **zero crashes**. Cross-checked the same
`85/2015/QH13` case: MinerU's output for the same file runs all the way to the document's real closing
signature block (`"...Chủ tịch ký: Nguyễn Sinh Hùng... SAO Y BẢN CHÍNH..."`) — 97,394 characters,
roughly 3.7× more content than docling's silently-truncated version, confirming MinerU actually
processed the whole document.

| Sample | Pages | docling | MinerU | docling issue |
|---|---|---|---|---|
| 04 Hiến pháp 2013 | 31 | 242.2s / 53,252 chars | 482.0s / 54,814 chars | none — matches closely |
| 07 74/2018/QH14 | 4 | 29.0s / 7,608 chars | 94.9s / 7,822 chars | none — matches closely |
| 08 68/2025/QH15 | 32 | 102.1s / 28,852 chars | 554.5s / 63,582 chars | `bad_alloc` pp.16–32 (~55% under-capture) |
| 09 179/2025/QH15 | 1 | 10.7s / 952 chars | 62.8s / 1,051 chars | none — matches closely |
| 22 06/2022/QH15 | 65 (1 scanned) | 109.4s / 144,601 chars | 423.9s / 125,501 chars | `bad_alloc` pp.58,60,63,64 (minor — doc mostly has a real text layer) |
| 25 39/2024/QH15 | 46 (clean) | 87.5s / 105,837 chars | 160.5s / 104,542 chars | none — matches closely |
| 26 41/2017/QH14 | 6 | 46.3s / 12,429 chars | 73.1s / 13,461 chars | none — matches closely |
| 28 59/2024/QH15 | 12 (clean) | 25.3s / 27,780 chars | 69.7s / 27,412 chars | none — matches closely |
| 35 246/2025/QH15 | 15 | **688.3s** / 131,133 chars | 247.5s / 164,280 chars | no `bad_alloc`, but "RapidOCR returned empty result" ×3 — 7× slower *and* 20% less content than MinerU |
| 45 44/2013/QH13 | 37 | 132.3s / 30,630 chars | 299.8s / 77,785 chars | `bad_alloc` pp.16–37 (~59% under-capture) |
| 47 85/2015/QH13 | 46 | 91.7s / 26,371 chars | 350.2s / 97,394 chars | `bad_alloc` pp.14–46, confirmed mid-sentence truncation (~73% under-capture) |

Summed across the 8 truly-scanned documents: **docling captured 291,227 characters total; MinerU
captured 480,189 — 65% more**, and unlike docling's numbers, MinerU's aren't silently missing chunks.
docling was faster when it worked cleanly (short docs, or docs with a mostly-real text layer already),
but on this corpus — 94% scanned, frequently 10s of pages — "when it worked cleanly" excludes most of
the corpus.

**Caveat:** all three tools (docling, MinerU, markitdown) ran concurrently in separate processes during
this pass to save wall-clock time, competing for the same ~29GB RAM. It's possible resource contention
contributed to or caused docling's `bad_alloc`s rather than this being purely a docling-internal leak —
that's not disentangled here. But two things point toward a genuine docling-side issue rather than pure
contention: (1) the failure rate visibly *worsens* across the session (later, larger documents lose more
pages than earlier ones of similar size), consistent with per-process accumulation rather than a flat
external resource ceiling; (2) even where docling didn't crash, it was still frequently slower *and*
produced less content than MinerU (sample 35). Worth confirming with a docling-only rerun (no concurrent
MinerU/markitdown) before fully attributing this to docling itself, but as observed under realistic
concurrent-batch conditions — which is itself a realistic deployment scenario — MinerU was the reliable
one.

### Revised verdict after round 2

Round 1 leaned toward "docling produced the cleaner output shape, pick that, fix Vietnamese OCR first."
Round 2 changes that: **given how much of this corpus is scanned and multi-page, docling's silent
truncation on longer documents is a bigger practical risk than its Markdown-table-vs-MinerU's-HTML-table
formatting difference from round 1.** If forced to choose one tool today, on this evidence MinerU is the
safer default for batch ingestion despite being 2–5× slower — a wrong-but-plausible-looking `.md` file
that silently drops the back two-thirds of a law is a worse failure mode than a slow one. Both still need
the same Vietnamese-OCR fix (EasyOCR/Tesseract `vie`) before either is actually usable for this corpus's
dominant scanned-PDF case — that finding from round 1 stands unchanged and is now more consequential
given the 94% figure.

## Round 3: does swapping in a Vietnamese OCR engine actually fix things?

Requested follow-up: plug EasyOCR (`lang='vi'`) into docling and MinerU and re-test. Result: possible
for docling, architecturally impossible for MinerU, and for docling the fix is a real but incomplete
trade, not a clean win.

### MinerU: not a config change, an architectural wall

Read MinerU's own source (`mineru/utils/ocr_language.py`) rather than guessing. Its `pipeline` backend's
language selector isn't a generic "pick an OCR engine" hook — `PUBLIC_OCR_LANGUAGES` is a hardcoded
12-value enum (`ch`, `korean`, `ta`, `te`, `ka`, `th`, `el`, `arabic`, `east_slavic`, `cyrillic`,
`devanagari`), each pointing at its own bundled model + dictionary file
(`ppocrv5_*_dict.txt`/`ppocrv6_dict.txt`, its own PyTorch reimplementation of PP-OCR — no `easyocr` or
`paddleocr` dependency exists anywhere in the installed package). `validate_public_ocr_lang()` raises a
hard `ValueError` for anything outside that list or its alias sets — Vietnamese isn't in it, and there is
no extension point to substitute a different OCR engine. This is a fundamentally different design from
docling, which genuinely supports swappable OCR backends
(`EasyOcrOptions`/`RapidOcrOptions`/`TesseractOcrOptions` are real, documented, interchangeable pipeline
options). The one theoretical path — MinerU's separate `vlm-engine`/`hybrid-engine` backend, which uses a
vision-language model instead of the fixed pipeline and might have picked up some Vietnamese from general
multilingual pretraining — was not tried (large extra model download, likely far slower on this CPU-only
box, decided not worth it against the round-2 evidence that MinerU's *pipeline* backend was already the
more reliable of the two tools). MinerU is out of scope for the rest of this round.

### docling + EasyOCR(vi): the diacritics problem is real fixed — but it's a trade, not a win

Installed `easyocr` (confirmed `'vi'` is in `easyocr.config.all_lang_list`) and wired it in via
`PdfPipelineOptions.ocr_options = EasyOcrOptions(lang=['vi'], use_gpu=False)`. Three results:

**1. Character-level accuracy is a dramatic, unambiguous improvement.** Same document, same page,
side-by-side against round 1's RapidOCR(`chinese`) output:

| | RapidOCR (round 1) | EasyOCR `vi` (this round) |
|---|---|---|
| | `"Lut s:"` | `"Luật số:"` |
| | `"LUÁT THUÉ THU NHAP CÁ NHÂN"` | `"LUẬT THUẾ THU NHẬP CÁ NHÂN"` |
| | `"Điu 1. Phąm vi điu chinh"` | `"Điều 1. Phạm vi điều chỉnh"` |

Every diacritic is correct. This confirms round 1's diagnosis was right — Vietnamese OCR quality was
always about which model you point at, not some fundamental limit — and that EasyOCR's `vi` model is a
real fix for the character-recognition half of the problem.

**2. But a new, different correctness problem shows up: word order scrambles at line-wrap boundaries.**
Confirmed on two separate pages, same consistent pattern both times — the last word (or few words) of a
line that wraps mid-sentence gets displaced to the *end* of its paragraph instead of staying in place:

> `"...tính theo 12 liên tục kể từ ngày đầu tiên có mặt tại Việt Nam; tháng"` (should read `"...tính
> theo 12 tháng liên tục kể từ ngày đầu tiên có mặt tại Việt Nam"` — `"tháng"` displaced to the end)
>
> `"...phù hợp với tình hình kinh tế xã hội trong thời kỳ. hợp từng"` (should read `"...phù hợp với
> tình hình kinh tế - xã hội trong từng thời kỳ"` — `"hợp"` and `"từng"` both displaced)

Every individual word is spelled correctly (diacritics intact) — this is purely a reading-order bug, not
a character-recognition bug. Read as prose, these sentences are wrong in a way that's easy to miss on a
skim and would corrupt anything downstream that assumes line order reflects reading order — which
`document-node.parser.ts` does (it's a line-based parser). Most likely cause: docling's layout-to-reading-order
logic was tuned against RapidOCR's bounding-box conventions, and EasyOCR's boxes are shaped/ordered
differently enough to break it. Not evaluated against table content specifically this round (the page
sampled for the table check landed on a different, non-table section of the document).

**3. Reliability got worse, not better.** The full 15-page document that RapidOCR-based docling
completed in round 1 (with bad diacritics, but completed) **crashed under EasyOCR** — `std::bad_alloc` on
page 15, process terminated, no output file produced at all. Isolated single pages succeed fine (page 1:
28.5s/1,395 chars; a later page: 31.6s/2,185 chars) — so this isn't "EasyOCR can't process a page," it's
the same cumulative-memory-pressure pattern from round 2's `bad_alloc` finding, now triggering *faster*
because EasyOCR's PyTorch-based models apparently carry a heavier per-page memory footprint than
RapidOCR's lightweight ONNX models. Swapping the OCR engine didn't fix docling's reliability problem —
it made it bite sooner.

### Net conclusion

Fixing the OCR *language* doesn't get either tool to production-ready for this corpus on its own.
docling+EasyOCR(vi) trades a character-accuracy problem for a reading-order problem and a worse
reliability profile; MinerU can't take the fix at all without forking its internals. The realistic next
experiments, in order of promise: (a) same EasyOCR(vi) swap on **Tesseract** instead (docling also
supports `TesseractOcrOptions`, and Tesseract's `vie` model + layout analysis is a different, possibly
more robust combination), (b) process documents page-by-page rather than whole-document to sidestep the
cumulative memory issue directly, (c) a reading-order post-process pass specifically for EasyOCR's output.
None of that was in scope for this round.

## Files

- `samples/`, `samples2/`, `samples2_ocr_subset/` — source documents (gitignored, copies of
  already-gitignored `laws/` data)
- `outputs/<tool>/`, `outputs2/<tool>/` — each tool's `.md` output per sample + `_timings.json`
- `scripts/run_*.py` — the conversion harnesses used for both passes
- `.venv-mineru/` — MinerU's dedicated Python 3.12 environment (gitignored)
