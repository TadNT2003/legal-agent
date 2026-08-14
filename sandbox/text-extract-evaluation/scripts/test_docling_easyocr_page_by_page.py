import json
import time
from pathlib import Path

import pypdfium2 as pdfium
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import EasyOcrOptions, PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "samples" / "02-pdf-scanned-ocr-table_109-2025-QH15_thue-tncn.pdf"
OUT_MD = ROOT / "outputs" / "docling" / "_easyocr_vi_page_by_page.md"
OUT_LOG = ROOT / "outputs" / "docling" / "_easyocr_vi_page_by_page_timings.json"

num_pages = len(pdfium.PdfDocument(str(SRC)))
print(f"Document has {num_pages} pages", flush=True)

opts = PdfPipelineOptions()
opts.ocr_options = EasyOcrOptions(lang=["vi"], use_gpu=False)
# One converter instance reused across all pages -- the realistic "page-by-page
# chunking inside a long-running process" scenario, not a fresh process per page.
converter = DocumentConverter(
    format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
)

results = []
all_md = []
for page in range(1, num_pages + 1):
    t0 = time.perf_counter()
    entry = {"page": page}
    try:
        result = converter.convert(str(SRC), page_range=(page, page))
        md = result.document.export_to_markdown()
        elapsed = time.perf_counter() - t0
        entry.update({"status": "ok", "elapsed_sec": round(elapsed, 2), "md_chars": len(md)})
        all_md.append(f"<!-- page {page} -->\n{md}")
        print(f"  page {page}: OK {elapsed:.2f}s {len(md)} chars", flush=True)
    except Exception as e:
        elapsed = time.perf_counter() - t0
        entry.update({"status": "error", "elapsed_sec": round(elapsed, 2), "error": f"{type(e).__name__}: {e}"})
        print(f"  page {page}: ERROR after {elapsed:.2f}s: {type(e).__name__}: {e}", flush=True)
    results.append(entry)

OUT_MD.write_text("\n\n".join(all_md), encoding="utf-8")
OUT_LOG.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

ok = sum(1 for r in results if r["status"] == "ok")
total_chars = sum(r.get("md_chars", 0) for r in results)
total_time = sum(r["elapsed_sec"] for r in results)
print(f"\nDone. {ok}/{num_pages} pages OK, {total_chars} total chars, {total_time:.2f}s total.")
