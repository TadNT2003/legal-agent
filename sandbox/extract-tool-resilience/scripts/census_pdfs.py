"""
Classify every PDF currently in laws/ with pdf-inspector to build a sampling
pool for extract-tool-resilience: scan status (digital/scanned/mixed),
is_complex_layout (table-risk / table-candidate signal), page count.

Reads laws/manifest.json directly (not the filesystem) so the census carries
citation/title/tier/source path alongside the classification.
"""

import json
import time
from pathlib import Path

import pdf_inspector

ROOT = Path(__file__).resolve().parents[3]  # repo root
LAWS = ROOT / "laws"
MANIFEST = LAWS / "manifest.json"
OUT = Path(__file__).resolve().parents[1] / "census_pdfs.json"

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
pdf_entries = [d for d in manifest if d.get("filename", "").lower().endswith(".pdf")]
print(f"{len(pdf_entries)} PDF entries in manifest", flush=True)

results = []
t_start = time.perf_counter()
for i, d in enumerate(pdf_entries, 1):
    path = LAWS / d["subdir"] / d["folder"] / d["filename"]
    entry = {
        "citation": d.get("citation"),
        "title": d.get("title"),
        "subdir": d.get("subdir"),
        "folder": d.get("folder"),
        "filename": d.get("filename"),
        "path": str(path.relative_to(ROOT)),
        "size_bytes": path.stat().st_size if path.exists() else None,
    }
    if not path.exists():
        entry["status"] = "missing_on_disk"
        results.append(entry)
        continue
    t0 = time.perf_counter()
    try:
        r = pdf_inspector.process_pdf(str(path))
        elapsed = time.perf_counter() - t0
        needing_ocr = len(r.pages_needing_ocr) if r.pages_needing_ocr else 0
        entry.update({
            "status": "ok",
            "elapsed_sec": round(elapsed, 4),
            "page_count": r.page_count,
            "is_complex_layout": r.is_complex_layout,
            "has_encoding_issues": r.has_encoding_issues,
            "pages_needing_ocr_count": needing_ocr,
            "scan_status": (
                "clean" if needing_ocr == 0
                else "fully_scanned" if needing_ocr == r.page_count
                else "mixed"
            ),
        })
    except Exception as e:
        elapsed = time.perf_counter() - t0
        entry.update({
            "status": "error",
            "elapsed_sec": round(elapsed, 4),
            "error": f"{type(e).__name__}: {e}",
        })
    results.append(entry)
    if i % 50 == 0 or i == len(pdf_entries):
        print(f"  {i}/{len(pdf_entries)} done ({time.perf_counter()-t_start:.1f}s elapsed)", flush=True)

OUT.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

ok = [r for r in results if r["status"] == "ok"]
clean = sum(1 for r in ok if r["scan_status"] == "clean")
scanned = sum(1 for r in ok if r["scan_status"] == "fully_scanned")
mixed = sum(1 for r in ok if r["scan_status"] == "mixed")
complex_layout = sum(1 for r in ok if r.get("is_complex_layout"))
errors = sum(1 for r in results if r["status"] == "error")
missing = sum(1 for r in results if r["status"] == "missing_on_disk")

print(f"\nTotal: {len(results)}  ok: {len(ok)}  errors: {errors}  missing: {missing}")
print(f"clean: {clean}  fully_scanned: {scanned}  mixed: {mixed}")
print(f"is_complex_layout=True: {complex_layout}")
print(f"Total elapsed: {time.perf_counter()-t_start:.1f}s")
print(f"Written to {OUT}")
