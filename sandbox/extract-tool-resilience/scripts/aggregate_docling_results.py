import json
import glob
from pathlib import Path

SANDBOX = Path(__file__).resolve().parents[1]
OUT = SANDBOX / "outputs" / "docling"

manifest = json.loads((SANDBOX / "samples" / "docling_manifest.json").read_text(encoding="utf-8"))
manifest_by_file = {m["filename"]: m for m in manifest}

all_docs = {}
for f in sorted(glob.glob(str(OUT / "_chunk*_timings.json"))):
    chunk_id = f.split("_chunk")[1].split("_")[0]
    d = json.loads(Path(f).read_text(encoding="utf-8"))
    for filename, doc in d.items():
        pages = doc["pages"]
        total_time = sum(p.get("elapsed_sec", 0) for p in pages.values())
        total_chars = sum(p.get("chars", 0) for p in pages.values())
        ok_pages = sum(1 for p in pages.values() if p.get("status") == "ok")
        m = manifest_by_file.get(filename, {})
        all_docs[filename] = {
            "chunk": chunk_id,
            "citation": doc["citation"],
            "num_pages": doc["num_pages"],
            "ok_pages": ok_pages,
            "total_time_sec": round(total_time, 1),
            "total_chars": total_chars,
            "sec_per_page": round(total_time / ok_pages, 2) if ok_pages else 0,
            "table_score": m.get("table_score"),
            "pages_with_grid": m.get("pages_with_grid"),
        }

docs = list(all_docs.values())
docs.sort(key=lambda d: d["sec_per_page"])

print(f"Total docs: {len(docs)}")
print(f"Total pages: {sum(d['ok_pages'] for d in docs)}")
print(f"Total OCR compute time (sum across pages, not wall-clock): {sum(d['total_time_sec'] for d in docs):.1f}s = {sum(d['total_time_sec'] for d in docs)/3600:.2f}h")
print(f"Total chars captured: {sum(d['total_chars'] for d in docs)}")
print()
print("--- Fastest 10 (sec/page) ---")
for d in docs[:10]:
    print(f"  {d['sec_per_page']:6.2f} s/page  {d['citation']:20s} pages={d['num_pages']:3d}  table_score={d['table_score']}")
print()
print("--- Slowest 10 (sec/page) ---")
for d in docs[-10:]:
    print(f"  {d['sec_per_page']:6.2f} s/page  {d['citation']:20s} pages={d['num_pages']:3d}  table_score={d['table_score']}")
print()
print("--- All docs, sorted by total_time_sec desc (biggest time sinks) ---")
by_time = sorted(docs, key=lambda d: d["total_time_sec"], reverse=True)
for d in by_time[:10]:
    print(f"  {d['total_time_sec']:8.1f}s total  {d['citation']:20s} pages={d['num_pages']:3d}  {d['sec_per_page']:.2f}s/page")

(SANDBOX / "docling_results_summary.json").write_text(
    json.dumps(sorted(docs, key=lambda d: d["citation"]), indent=2, ensure_ascii=False), encoding="utf-8"
)
print(f"\nWritten to {SANDBOX / 'docling_results_summary.json'}")
