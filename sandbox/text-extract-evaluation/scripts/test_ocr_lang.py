from pathlib import Path

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "samples" / "02-pdf-scanned-ocr-table_109-2025-QH15_thue-tncn.pdf"

for lang in (["chinese"], ["latin"], ["en"]):
    opts = PdfPipelineOptions()
    opts.ocr_options = RapidOcrOptions(lang=lang)
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
    )
    result = converter.convert(str(SRC), page_range=(1, 1))
    md = result.document.export_to_markdown()
    out = ROOT / "outputs" / "docling" / f"_lang_test_{lang[0]}.md"
    out.write_text(md, encoding="utf-8")
    print(f"=== lang={lang} -> {out.name} ({len(md)} chars) ===")
