import json
import time
from pathlib import Path

import pypdfium2 as pdfium
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import EasyOcrOptions, PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples2_ocr_subset"
OUT = ROOT / "outputs2" / "docling-easyocr-pagebypage"
OUT.mkdir(parents=True, exist_ok=True)

opts = PdfPipelineOptions()
opts.ocr_options = EasyOcrOptions(lang=["vi"], use_gpu=False)
# One converter instance reused across every page of every document in the subset --
# the same "long-running service" pattern as the single-document page-by-page test,
# now stress-tested across 295 pages / 11 documents instead of 15 pages / 1 document.
converter = DocumentConverter(
    format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
)

doc_results = []
run_t0 = time.perf_counter()

for src in sorted(SAMPLES.glob("*.pdf")):
    num_pages = len(pdfium.PdfDocument(str(src)))
    print(f"=== {src.name} ({num_pages} pages) ===", flush=True)
    page_results = []
    all_md = []
    doc_t0 = time.perf_counter()
    for page in range(1, num_pages + 1):
        t0 = time.perf_counter()
        entry = {"page": page}
        try:
            result = converter.convert(str(src), page_range=(page, page))
            md = result.document.export_to_markdown()
            elapsed = time.perf_counter() - t0
            entry.update({"status": "ok", "elapsed_sec": round(elapsed, 2), "md_chars": len(md)})
            all_md.append(f"<!-- page {page} -->\n{md}")
            print(f"  page {page}/{num_pages}: OK {elapsed:.2f}s {len(md)} chars", flush=True)
        except Exception as e:
            elapsed = time.perf_counter() - t0
            entry.update({"status": "error", "elapsed_sec": round(elapsed, 2), "error": f"{type(e).__name__}: {e}"})
            print(f"  page {page}/{num_pages}: ERROR after {elapsed:.2f}s: {type(e).__name__}: {e}", flush=True)
        page_results.append(entry)

    doc_elapsed = time.perf_counter() - doc_t0
    out_md = OUT / (src.stem + ".md")
    out_md.write_text("\n\n".join(all_md), encoding="utf-8")
    ok_pages = sum(1 for r in page_results if r["status"] == "ok")
    total_chars = sum(r.get("md_chars", 0) for r in page_results)
    doc_results.append({
        "file": src.name,
        "num_pages": num_pages,
        "pages_ok": ok_pages,
        "pages_failed": num_pages - ok_pages,
        "elapsed_sec": round(doc_elapsed, 2),
        "total_md_chars": total_chars,
        "pages": page_results,
    })
    print(f"  -> {ok_pages}/{num_pages} pages OK, {total_chars} chars, {doc_elapsed:.2f}s\n", flush=True)

    (OUT / "_timings.json").write_text(json.dumps(doc_results, indent=2, ensure_ascii=False), encoding="utf-8")

run_elapsed = time.perf_counter() - run_t0
total_pages = sum(d["num_pages"] for d in doc_results)
total_ok = sum(d["pages_ok"] for d in doc_results)
print(f"\n=== DONE: {total_ok}/{total_pages} pages OK across {len(doc_results)} docs, {run_elapsed:.2f}s total ===")
