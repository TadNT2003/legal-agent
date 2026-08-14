import json
import time
from pathlib import Path

from markitdown import MarkItDown

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples" / "markitdown"
OUT = ROOT / "outputs" / "markitdown"
OUT.mkdir(parents=True, exist_ok=True)

manifest = json.loads((ROOT / "samples" / "markitdown_manifest.json").read_text(encoding="utf-8"))
by_filename = {m["filename"]: m for m in manifest}

md_converter = MarkItDown()

results = []
t_start = time.perf_counter()
for src in sorted(SAMPLES.glob("*.docx")):
    m = by_filename.get(src.name, {})
    entry = {"file": src.name, "citation": m.get("citation"), "date": m.get("date"), "size_bytes": src.stat().st_size}
    t0 = time.perf_counter()
    try:
        result = md_converter.convert(str(src))
        elapsed = time.perf_counter() - t0
        text = result.text_content
        entry.update({
            "status": "ok",
            "elapsed_sec": round(elapsed, 4),
            "chars": len(text) if text else 0,
            "has_table": bool(text and "|" in text),
        })
        if text:
            (OUT / (src.stem + ".md")).write_text(text, encoding="utf-8")
    except Exception as e:
        elapsed = time.perf_counter() - t0
        entry.update({"status": "error", "elapsed_sec": round(elapsed, 4), "error": f"{type(e).__name__}: {e}"})
    results.append(entry)

(OUT / "_timings.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

ok = [r for r in results if r["status"] == "ok"]
errors = [r for r in results if r["status"] == "error"]
print(f"Total: {len(results)}  ok: {len(ok)}  errors: {len(errors)}")
print(f"Total elapsed: {time.perf_counter()-t_start:.2f}s")
for e in errors:
    print("ERROR:", e["file"], e.get("error"))
