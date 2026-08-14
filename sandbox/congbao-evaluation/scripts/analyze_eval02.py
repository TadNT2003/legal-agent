"""
Post-hoc analysis of Eval-02's pdf-inspector run: OCR-need distribution, and a
character-level corruption scan across every markdown output (the corruption
scan is NOT something pdf-inspector reports itself -- has_encoding_issues was
checked against it directly and found not to correlate; this script is the
actual detector). Two corruption signatures found by manual inspection during
this evaluation, both traced to the same root cause (a PDF's embedded font
having a broken/incomplete ToUnicode CMap for some Vietnamese precomposed
characters):
  - unmapped glyph -> U+FFFD replacement character, or a bare "(cid:NNNN)"
    reference (pdfplumber's way of saying "no Unicode mapping for this glyph")
  - wrongly-mapped glyph -> a plausible-looking but wrong character, e.g. a
    Vietnamese A-acute (U+00C1) missing its CMap entry and landing on
    U+00A1 ("inverted exclamation mark", exactly 0x20 below the correct
    codepoint) instead -- confirmed by inspecting the raw codepoints of a
    "KHAC" that rendered as "KH<inverted-exclamation>C".
Both patterns are scanned for; a small set of legitimately-used Vietnamese
Latin-1-range letters (A-grave/acute/circumflex/tilde etc. that happen to sit
in the Latin-1 Supplement block) are excluded so they don't trigger false
alarms.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs"
results = json.loads((OUT / "_timings.json").read_text(encoding="utf-8"))

LEGIT_LATIN1 = set("ÀÁÂÃÈÉÊÌÍÒÓÔ"
                    "ÕÙÚÝàáâãèéêì"
                    "íòóôõùúý")
SUSPECT_RE = re.compile("[ -ÿ]")  # Latin-1 Supplement block
REPLACEMENT_CHAR = "�"


def scan_corruption(text: str) -> dict:
    repl = text.count(REPLACEMENT_CHAR)
    cid = len(re.findall(r"\(cid:\d+\)", text))
    suspect = len([ch for ch in SUSPECT_RE.findall(text) if ch not in LEGIT_LATIN1])
    return {"replacement_chars": repl, "cid_refs": cid, "suspect_chars": suspect}


# --- OCR-need distribution ---
any_ocr = [r for r in results if r["pages_needing_ocr_count"] > 0]
fully_scanned = [r for r in results if r["fully_scanned"]]
total_pages = sum(r["page_count"] for r in results)
total_ocr_pages = sum(r["pages_needing_ocr_count"] for r in results)

# --- corruption scan across every markdown output ---
corruption = []
for r in results:
    md_path = OUT / (Path(r["file"]).stem + ".md")
    if not md_path.exists():
        continue
    text = md_path.read_text(encoding="utf-8")
    c = scan_corruption(text)
    total_bad = c["replacement_chars"] + c["cid_refs"] + c["suspect_chars"]
    if total_bad > 0:
        severity_pct = 100 * total_bad / max(1, r["md_chars"])
        corruption.append({**r, **c, "severity_pct": round(severity_pct, 4)})
corruption.sort(key=lambda x: -x["severity_pct"])

severe = [c for c in corruption if c["severity_pct"] > 1.0]
trace = [c for c in corruption if c["severity_pct"] <= 1.0]

# --- table has_table rate (real-vs-fake split requires eyeballing content and
# was done manually during this evaluation, see REPORT.md; not re-derived here
# since "is this prose or real tabular data" isn't reliably decidable from the
# markdown text alone) ---
tabled = [r for r in results if r["has_table"]]

summary = {
    "total_documents": len(results),
    "ocr": {
        "zero_pages_needing_ocr": len(results) - len(any_ocr),
        "any_page_needing_ocr": len(any_ocr),
        "fully_scanned": len(fully_scanned),
        "fully_scanned_files": [r["file"] for r in fully_scanned],
        "total_pages": total_pages,
        "total_ocr_pages": total_ocr_pages,
        "ocr_page_pct": round(100 * total_ocr_pages / total_pages, 2),
    },
    "corruption": {
        "any_signal": len(corruption),
        "severe_over_1pct": len(severe),
        "severe_files": [{"file": c["file"], "severity_pct": c["severity_pct"]} for c in severe],
        "trace_under_1pct": len(trace),
    },
    "has_table": {"count": len(tabled), "pct": round(100 * len(tabled) / len(results), 1)},
}

(OUT / "analysis_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
(OUT / "corruption_detail.json").write_text(json.dumps(corruption, indent=2, ensure_ascii=False), encoding="utf-8")

print(json.dumps(summary, indent=2, ensure_ascii=False))
