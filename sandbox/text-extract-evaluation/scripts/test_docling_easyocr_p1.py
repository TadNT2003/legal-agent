import time
from pathlib import Path

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import EasyOcrOptions, PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "samples" / "02-pdf-scanned-ocr-table_109-2025-QH15_thue-tncn.pdf"
OUT = ROOT / "outputs" / "docling" / "_easyocr_vi_p1_test.md"

opts = PdfPipelineOptions()
opts.ocr_options = EasyOcrOptions(lang=["vi"], use_gpu=False)
converter = DocumentConverter(
    format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
)

t0 = time.perf_counter()
result = converter.convert(str(SRC), page_range=(1, 1))
md = result.document.export_to_markdown()
elapsed = time.perf_counter() - t0
OUT.write_text(md, encoding="utf-8")
print(f"docling+EasyOCR(vi) page 1 only: {elapsed:.2f}s, {len(md)} chars -> {OUT}")
