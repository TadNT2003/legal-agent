"""
Select 100 PDFs for the pdf-inspector resilience-at-scale test: 80 clean/digital
+ 20 fully-scanned, evenly spaced through each pool (by size) for variety rather
than clustering on one tier/year, then copy into samples/pdf-inspector/.
"""

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SANDBOX = Path(__file__).resolve().parents[1]
CENSUS = SANDBOX / "census_pdfs.json"
OUT = SANDBOX / "samples" / "pdf-inspector"

census = json.loads(CENSUS.read_text(encoding="utf-8"))
clean = [d for d in census if d["status"] == "ok" and d["scan_status"] == "clean"]
scanned = [d for d in census if d["status"] == "ok" and d["scan_status"] == "fully_scanned"]


def evenly_spaced(items, n):
    items = sorted(items, key=lambda d: d["size_bytes"])
    if n >= len(items):
        return items
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]


picked_clean = evenly_spaced(clean, 80)
picked_scanned = evenly_spaced(scanned, 20)
picked = picked_clean + picked_scanned

manifest_out = []
for d in picked:
    src = ROOT / d["path"]
    dest = OUT / d["filename"]
    shutil.copy2(src, dest)
    manifest_out.append({
        "citation": d["citation"],
        "title": d["title"],
        "filename": d["filename"],
        "scan_status": d["scan_status"],
        "page_count": d["page_count"],
        "size_bytes": d["size_bytes"],
    })

(OUT.parent / "pdf-inspector_manifest.json").write_text(
    json.dumps(manifest_out, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(f"Copied {len(picked_clean)} clean + {len(picked_scanned)} scanned = {len(picked)} total")
print(f"-> {OUT}")
