import json
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
OUT = ROOT / "outputs" / "mineru"
OUT.mkdir(parents=True, exist_ok=True)
MINERU_EXE = ROOT / ".venv-mineru" / "Scripts" / "mineru.exe"

# mineru's own CLI supports pdf/image/docx/pptx/xlsx only (no legacy .doc, no .rtf) per --help.
SUPPORTED_SUFFIXES = {".pdf", ".docx"}

results = []
for src in sorted(SAMPLES.iterdir()):
    if not src.is_file():
        continue
    if src.suffix.lower() not in SUPPORTED_SUFFIXES:
        results.append({"file": src.name, "status": "unsupported_format", "note": "mineru CLI only accepts pdf/image/docx/pptx/xlsx"})
        print(f"--- {src.name} --- SKIP (unsupported format)", flush=True)
        continue

    print(f"--- {src.name} ---", flush=True)
    doc_out = OUT / src.stem
    doc_out.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    entry = {"file": src.name, "size_bytes": src.stat().st_size}
    try:
        proc = subprocess.run(
            [str(MINERU_EXE), "-p", str(src), "-o", str(doc_out), "-b", "pipeline", "-l", "ch"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800,
        )
        elapsed = time.perf_counter() - t0
        md_files = list(doc_out.rglob("*.md"))
        if proc.returncode == 0 and md_files:
            md_path = md_files[0]
            md = md_path.read_text(encoding="utf-8")
            entry.update({
                "status": "ok",
                "elapsed_sec": round(elapsed, 2),
                "md_chars": len(md),
                "output_file": str(md_path.relative_to(OUT)),
            })
            print(f"  OK  {elapsed:.2f}s  {len(md)} chars -> {md_path.relative_to(OUT)}", flush=True)
        else:
            entry.update({
                "status": "error",
                "elapsed_sec": round(elapsed, 2),
                "returncode": proc.returncode,
                "stderr_tail": proc.stderr[-2000:],
            })
            print(f"  ERROR after {elapsed:.2f}s (rc={proc.returncode}): {proc.stderr[-500:]}", flush=True)
    except subprocess.TimeoutExpired:
        elapsed = time.perf_counter() - t0
        entry.update({"status": "timeout", "elapsed_sec": round(elapsed, 2)})
        print(f"  TIMEOUT after {elapsed:.2f}s", flush=True)
    results.append(entry)

(OUT / "_timings.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
print("\nDone. Timings written to", OUT / "_timings.json")
