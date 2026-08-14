import json
import time
import traceback
from pathlib import Path

from docling.document_converter import DocumentConverter

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
OUT = ROOT / "outputs" / "docling"
OUT.mkdir(parents=True, exist_ok=True)

converter = DocumentConverter()

results = []
for src in sorted(SAMPLES.iterdir()):
    if not src.is_file():
        continue
    print(f"--- {src.name} ---", flush=True)
    t0 = time.perf_counter()
    entry = {"file": src.name, "size_bytes": src.stat().st_size}
    try:
        result = converter.convert(str(src))
        md = result.document.export_to_markdown()
        elapsed = time.perf_counter() - t0
        out_path = OUT / (src.stem + ".md")
        out_path.write_text(md, encoding="utf-8")
        entry.update({
            "status": "ok",
            "elapsed_sec": round(elapsed, 2),
            "md_chars": len(md),
            "num_pages": result.document.num_pages() if hasattr(result.document, "num_pages") else None,
        })
        print(f"  OK  {elapsed:.2f}s  {len(md)} chars -> {out_path.name}", flush=True)
    except Exception as e:
        elapsed = time.perf_counter() - t0
        entry.update({
            "status": "error",
            "elapsed_sec": round(elapsed, 2),
            "error": f"{type(e).__name__}: {e}",
        })
        print(f"  ERROR after {elapsed:.2f}s: {type(e).__name__}: {e}", flush=True)
    results.append(entry)

(OUT / "_timings.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
print("\nDone. Timings written to", OUT / "_timings.json")
