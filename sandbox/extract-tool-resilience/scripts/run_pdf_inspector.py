import json
import time
from pathlib import Path

import pdf_inspector

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples" / "pdf-inspector"
OUT = ROOT / "outputs" / "pdf-inspector"
OUT.mkdir(parents=True, exist_ok=True)

manifest = json.loads((ROOT / "samples" / "pdf-inspector_manifest.json").read_text(encoding="utf-8"))
by_filename = {m["filename"]: m for m in manifest}

results = []
t_start = time.perf_counter()
for src in sorted(SAMPLES.glob("*.pdf")):
    m = by_filename.get(src.name, {})
    entry = {"file": src.name, "citation": m.get("citation"), "expected_scan_status": m.get("scan_status"), "size_bytes": src.stat().st_size}
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

(OUT / "_timings.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

ok = [r for r in results if r["status"] == "ok"]
errors = [r for r in results if r["status"] == "error"]
print(f"Total: {len(results)}  ok: {len(ok)}  errors: {len(errors)}")
print(f"Total elapsed: {time.perf_counter()-t_start:.2f}s")
for e in errors:
    print("ERROR:", e["file"], e.get("error"))
