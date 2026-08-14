# markitdown: `.docx` resilience-at-scale report

Scope: **markitdown only**, `.docx` format. Third of three tool-specific reports for
`extract-tool-resilience`. The prior evaluation
(`sandbox/text-extract-evaluation/REPORT.md`) recommended markitdown as primary for
`.docx` based on a **single test document** — explicitly flagged at the time as an
untested gap. This report closes that gap with all 60 genuine `.docx` documents that
exist on vanban.chinhphu.vn (see sandbox setup notes — `.docx` turned out to be a rare
format there, concentrated in one 1975 transcription batch, not a random cross-section).

## Executive summary

**Character-level extraction is accurate — diacritics and text content are correct
throughout, as expected for a tool reading native XML rather than doing OCR. But
structurally, the sample is dominated by a document-authoring convention that defeats
markitdown's paragraph handling: 58 of 60 documents (97%) have their entire body text
collapsed into a single giant table cell, destroying the paragraph/clause structure any
downstream line-based parser would need.**

| Finding | Result |
| --- | --- |
| Reliability | 60/60 processed, 0 crashes/errors |
| Speed | 9.55s total for 60 docs (0.16s/doc average) |
| Character/diacritic accuracy | Correct throughout, spot-checked directly — not an OCR path, so no diacritic-stripping risk |
| **Structural collapse** | **58/60 documents (97%)** have their entire body — every `Điều`/`Khoản` clause — flattened into one table-cell line, losing all paragraph structure |
| Root cause | Source-document authoring convention (a single whole-page table used for 1975-era transcriptions), not a markitdown bug — confirmed by contrast with 2 modern documents that don't have this problem |

## Setup

**Sample:** all 60 genuine `.docx` documents available from vanban.chinhphu.vn (see
sandbox setup — the real ceiling on this source, not a random 100-doc draw as originally
scoped). 58 of the 60 are from a single 1975 transcription batch (old pre-digital
documents re-typed into Word at some point); the other 2 are more typical born-digital
documents (`10/2011/QH13`, `248/2025/QH15`). This composition matters directly for how to
read the findings below — see Files for the manifest.

**Harness:** sequential loop, one `MarkItDown().convert()` call per file, capturing
status/timing/character count/`has_table` flag. Like pdf-inspector, no parallelism or
checkpointing needed. See `scripts/run_markitdown.py`.

## Findings

### Reliability and character accuracy: no issues found

60/60 documents converted without a crash or exception, 9.55s total (0.16s/doc average,
range 0.038s-0.82s). Every document produced non-trivial output (847-30,862 characters).
Diacritics were checked directly in every spot-checked document and are correct
throughout — expected, since markitdown reads a `.docx`'s native XML text rather than
running OCR, so it has no character-recognition step to get wrong. This is a real,
positive confirmation of the single-document result the prior evaluation had — accuracy
holds at n=60.

### The real finding: 97% of this sample has its body text trapped in one table cell

Line-counting the 60 output files immediately shows something unusual: 58 of them are
just 4-5 lines long, while the other 2 run to 114 and 157 lines. Reading the short ones
shows why — the *entire* document, including every numbered `Điều` clause, is embedded
inside a single markdown table row:

```
|  |  |  |
| --- | --- | --- |
| **PHỦ THỦ TƯỚNG**  Số: 232/BT |  | **VIỆT NAM DÂN CHỦ CỘNG HÒA** ... |
| **QUYẾT ĐỊNH** ... **Điều 1.-** Nay chia xã Phình Giàng ... **Điều 2.-** Giải thể xã
  Khẩu Hú ... **Điều 3.-** Uỷ ban hành chính tỉnh Lai Châu chịu trách nhiệm thi hành
  Quyết định này. | | |
```

(`232/BT`, a short 3-article decision — all three `Điều` clauses run together in one
cell, one line, with no paragraph breaks between them.) This isn't limited to short
documents — `1/TT-LB`, a longer circular with six substantive numbered points, shows the
identical pattern: the entire multi-paragraph body is one continuous run of text inside
one table cell.

**This is a source-document authoring artifact, not a markitdown bug** — confirmed by
contrast with the 2 modern documents in the sample. `10/2011/QH13` and `248/2025/QH15`
also use a small table for their letterhead block (issuing body / date, the standard
Vietnamese official-document header), but their actual body — `NGHỊ QUYẾT`, `QUỐC HỘI`,
and every clause after — sits *outside* the table as normal markdown headings and
paragraphs with real line breaks. The 1975-era documents, evidently transcribed by
embedding the entire original page's free-form layout into one big table rather than
using Word's native paragraph structure for the body, don't get that same treatment —
markitdown converts what's actually in the file faithfully in both cases; the difference
is entirely in how the source `.docx` was authored.

**Practical consequence:** for the 58/60 affected documents, there is no way to recover
per-clause structure from markitdown's output alone — the `Điều`/`Khoản` boundaries exist
in the source text (as bold markers, `**Điều 1.-**`) but not as separate lines or
paragraphs, so `document-node.parser.ts`'s line-anchored regex (already known from the
prior evaluation to need a `#`-stripping adapter for the *other* tools' output) would
find literally nothing to match here — the entire document is one line. A fix would need
to either post-process markitdown's table-cell output to re-split on the bold `Điều`/
`Khoản` markers, or bypass markitdown's table conversion entirely for single-cell
whole-document tables and fall back to reading paragraph runs directly from the `.docx`
XML.

### Corpus-composition caveat

This finding is scoped to the actual population available for testing, not to `.docx` as
a format in general: 58 of 60 samples are old transcribed documents sharing one unusual
authoring convention, because that's genuinely almost all of the `.docx` supply this
project's source (vanban.chinhphu.vn) has. The 2 modern documents in the sample show no
sign of this problem. If this project's corpus later gains more born-digital `.docx`
documents (newer document types, or documents sourced elsewhere), this specific failure
mode may turn out to be much rarer than 97% — but for the `.docx` documents that actually
exist in `laws/` today, it's close to universal.

## Verdict

markitdown's core extraction is trustworthy at the character level — no diacritic or
content-accuracy issues found anywhere in 60 documents, closing the single-document gap
the prior evaluation left open. But the structural finding changes what "primary for
`.docx`" should mean in practice for this specific corpus: raw markitdown output is not
directly usable by a line-based downstream parser for the large majority of this
project's actual `.docx` supply, not because markitdown extracted anything incorrectly,
but because the source documents' own authoring convention traps the useful structure
inside a single opaque table cell. This needs its own preprocessing step — separate from,
and more involved than, the generic `#`-stripping adapter the prior evaluation already
identified as necessary for the other tools' Markdown-heading output.

## Files

- `samples/markitdown/`, `samples/markitdown_manifest.json` — the 60-doc `.docx` sample
  (5 already-local + 27 + 26 downloaded via `/laws/downloads/batch`, see sandbox setup)
- `outputs/markitdown/*.md` — per-document markdown output
- `outputs/markitdown/_timings.json` — per-document status/timing/flags
- `scripts/run_markitdown.py` — the evaluation harness
