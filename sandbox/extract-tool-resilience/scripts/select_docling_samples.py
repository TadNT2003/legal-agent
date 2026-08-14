"""
Select the top 50 scanned PDFs by table-gridline score (see
detect_table_gridlines.py) for the docling+EasyOCR(vi) page-by-page
table-heavy resilience test, and copy them into samples/docling/.
"""

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SANDBOX = Path(__file__).resolve().parents[1]
TRIAGE = SANDBOX / "scripts" / "_table_triage_full.json"
OUT = SANDBOX / "samples" / "docling"

results = json.loads(TRIAGE.read_text(encoding="utf-8"))
ok = [r for r in results if "error" not in r]
ok.sort(key=lambda r: r["total_intersections"], reverse=True)
top50 = ok[:50]

manifest_out = []
total_pages = 0
for r in top50:
    src = ROOT / r["path"]
    dest = OUT / src.name
    shutil.copy2(src, dest)
    total_pages += r["num_pages"]
    manifest_out.append({
        "citation": r["citation"],
        "title": r["title"],
        "filename": src.name,
        "num_pages": r["num_pages"],
        "table_score": r["total_intersections"],
        "pages_with_grid": r["pages_with_grid"],
    })

(OUT.parent / "docling_manifest.json").write_text(
    json.dumps(manifest_out, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(f"Copied {len(top50)} docs, {total_pages} total pages -> {OUT}")
print(f"Score range: {top50[0]['total_intersections']} (highest) to {top50[-1]['total_intersections']} (50th)")
