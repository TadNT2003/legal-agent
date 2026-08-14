"""
Eval-02: run every Eval-01 sample through pdf-inspector, save markdown output to
outputs/, and record per-document metrics (same field names as
sandbox/extract-tool-resilience/scripts/run_pdf_inspector.py for comparability:
status, elapsed_sec, page_count, confidence, is_complex_layout,
has_encoding_issues, pages_needing_ocr_count, md_chars, has_table) plus congbao-
specific context from Eval-01's manifest (citation, type_slug, issued_date,
pre/post the ~2017 DOCX-availability boundary found during source evaluation).

Core question this answers: does pdf-inspector confirm -- across a random 200-
document sample spanning the full 2010-2026 archive, not just the one document
manually checked during recon -- that congbao's PDFs are genuinely digital text
everywhere, never scanned images needing OCR?
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pdf_inspector

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
OUT = ROOT / "outputs"
OUT.mkdir(parents=True, exist_ok=True)

manifest = json.loads((SAMPLES / "manifest.json").read_text(encoding="utf-8"))
by_filename = {m["filename"]: m for m in manifest}

results = []
t_start = time.perf_counter()
for src in sorted(SAMPLES.glob("*.pdf")):
    m = by_filename.get(src.name, {})
    issued_date = m.get("issued_date")
    entry = {
        "file": src.name,
        "citation": m.get("citation"),
        "type_slug": m.get("type_slug"),
        "issued_date": issued_date,
        "docx_era": (issued_date is not None and issued_date[:4] >= "2017"),  # per the ~Jan2016-Jun2017
        # DOCX-rollout boundary found in docs/plan/congbao-source-evaluation.md; irrelevant to this eval
        # (which only ever downloaded the PDF form) but useful for cross-tabbing results by era
        "size_bytes": src.stat().st_size,
    }
    t0 = time.perf_counter()
    try:
        r = pdf_inspector.process_pdf(str(src))
        elapsed = time.perf_counter() - t0
        md = r.markdown
        needing_ocr = len(r.pages_needing_ocr) if r.pages_needing_ocr else 0
        entry.update({
            "status": "ok",
            "elapsed_sec": round(elapsed, 4),
            "page_count": r.page_count,
            "confidence": r.confidence,
            "is_complex_layout": r.is_complex_layout,
            "has_encoding_issues": r.has_encoding_issues,
            "pages_needing_ocr_count": needing_ocr,
            "fully_scanned": bool(needing_ocr) and needing_ocr == r.page_count,
            "md_chars": len(md) if md else 0,
            "has_table": bool(md and "|" in md),
        })
        if md:
            (OUT / (src.stem + ".md")).write_text(md, encoding="utf-8")
    except Exception as e:
        elapsed = time.perf_counter() - t0
        entry.update({"status": "error", "elapsed_sec": round(elapsed, 4), "error": f"{type(e).__name__}: {e}"})
    results.append(entry)
    print(f"[{len(results)}/{len(manifest)}] {entry['file']}  status={entry['status']}"
          f"  elapsed={entry.get('elapsed_sec')}s  pages_needing_ocr={entry.get('pages_needing_ocr_count')}")

(OUT / "_timings.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

ok = [r for r in results if r["status"] == "ok"]
errors = [r for r in results if r["status"] == "error"]
scanned = [r for r in ok if r["fully_scanned"]]
tables = [r for r in ok if r["has_table"]]
encoding_issues = [r for r in ok if r["has_encoding_issues"]]
total_elapsed = time.perf_counter() - t_start

print(f"\nTotal: {len(results)}  ok: {len(ok)}  errors: {len(errors)}")
print(f"Total elapsed: {total_elapsed:.2f}s ({total_elapsed/max(1,len(results)):.4f}s/doc avg)")
print(f"Fully-scanned (0 extractable text, needs OCR): {len(scanned)}/{len(ok)}")
print(f"has_table (possible false-positive garbled table, per prior extract-tool-resilience finding): {len(tables)}/{len(ok)}")
print(f"has_encoding_issues: {len(encoding_issues)}/{len(ok)}")
for e in errors:
    print("ERROR:", e["file"], e.get("error"))
