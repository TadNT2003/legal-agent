import json
import time
from pathlib import Path

import pdf_inspector

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
OUT = ROOT / "outputs" / "pdf-inspector"
OUT.mkdir(parents=True, exist_ok=True)

results = []
for src in sorted(SAMPLES.iterdir()):
    if not src.is_file():
        continue
    if src.suffix.lower() != ".pdf":
        results.append({"file": src.name, "status": "unsupported_format", "note": "pdf-inspector only accepts PDF input"})
        print(f"--- {src.name} --- SKIP (not a PDF)", flush=True)
        continue

    print(f"--- {src.name} ---", flush=True)
    t0 = time.perf_counter()
    entry = {"file": src.name, "size_bytes": src.stat().st_size}
    try:
        r = pdf_inspector.process_pdf(str(src))
        elapsed = time.perf_counter() - t0
        md = r.markdown
        entry.update({
            "status": "ok",
            "elapsed_sec": round(elapsed, 4),
            "page_count": r.page_count,
            "confidence": r.confidence,
            "is_complex_layout": r.is_complex_layout,
            "has_encoding_issues": r.has_encoding_issues,
            "pages_needing_ocr": r.pages_needing_ocr,
            "md_chars": len(md) if md else 0,
        })
        if md:
            out_path = OUT / (src.stem + ".md")
            out_path.write_text(md, encoding="utf-8")
            entry["output_file"] = out_path.name
        print(f"  OK  {elapsed:.4f}s  pages_needing_ocr={r.pages_needing_ocr}  md_chars={len(md) if md else 0}", flush=True)
    except Exception as e:
        elapsed = time.perf_counter() - t0
        entry.update({
            "status": "error",
            "elapsed_sec": round(elapsed, 4),
            "error": f"{type(e).__name__}: {e}",
        })
        print(f"  ERROR after {elapsed:.4f}s: {type(e).__name__}: {e}", flush=True)
    results.append(entry)

(OUT / "_timings.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
print("\nDone. Timings written to", OUT / "_timings.json")
