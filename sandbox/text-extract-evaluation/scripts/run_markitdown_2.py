import json
import time
from pathlib import Path

from markitdown import MarkItDown

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples2"
OUT = ROOT / "outputs2" / "markitdown"
OUT.mkdir(parents=True, exist_ok=True)

md_converter = MarkItDown()

results = []
for src in sorted(SAMPLES.glob("*.pdf")):
    print(f"--- {src.name} ---", flush=True)
    t0 = time.perf_counter()
    entry = {"file": src.name, "size_bytes": src.stat().st_size}
    try:
        result = md_converter.convert(str(src))
        md = result.text_content
        elapsed = time.perf_counter() - t0
        out_path = OUT / (src.stem + ".md")
        out_path.write_text(md, encoding="utf-8")
        entry.update({"status": "ok", "elapsed_sec": round(elapsed, 2), "md_chars": len(md)})
        print(f"  OK  {elapsed:.2f}s  {len(md)} chars", flush=True)
    except Exception as e:
        elapsed = time.perf_counter() - t0
        entry.update({"status": "error", "elapsed_sec": round(elapsed, 2), "error": f"{type(e).__name__}: {e}"})
        print(f"  ERROR after {elapsed:.2f}s: {type(e).__name__}: {e}", flush=True)
    results.append(entry)

(OUT / "_timings.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
print("\nDone.", OUT / "_timings.json")
