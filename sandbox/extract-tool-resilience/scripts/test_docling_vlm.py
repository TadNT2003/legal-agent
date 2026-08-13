"""
Ephemeral one-document test of docling's VlmPipeline against a remote
OpenAI-compatible VLM endpoint (config in ../.env), as an alternative to the
RapidOCR/EasyOCR layout-then-OCR pipeline used throughout the rest of this
evaluation. Not part of the checkpointed harness — single document, no retry.
"""

import os
import time
from pathlib import Path

SANDBOX = Path(__file__).resolve().parents[1]

# minimal .env loader (avoid adding a new dependency for one script)
for line in (SANDBOX / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ[k] = v

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import VlmPipelineOptions
from docling.datamodel.pipeline_options_vlm_model import ApiVlmOptions, ResponseFormat
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.pipeline.vlm_pipeline import VlmPipeline

VLM_BASE_URL = os.environ["VLM_BASE_URL"]
VLM_API_KEY = os.environ["VLM_API_KEY"]
VLM_MODEL = os.environ["VLM_MODEL"]

DOC = SANDBOX / "samples" / "docling" / "128-2020-QH14_ve-du-toan-ngan-sach-nha-nuoc-nam-2021.pdf"
OUT_DIR = SANDBOX / "outputs" / "docling" / "VLM"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT = OUT_DIR / (DOC.stem + "_plaintext.txt")

api_options = ApiVlmOptions(
    url=f"{VLM_BASE_URL}/chat/completions",
    headers={"Authorization": f"Bearer {VLM_API_KEY}"},
    params={"model": VLM_MODEL, "max_tokens": 8192, "reasoning_effort": "none"},
    prompt=(
        "Transcribe this scanned Vietnamese legal document page as plain "
        "text, exactly as if you selected all the text on the page and "
        "copied it. Preserve all Vietnamese diacritics exactly. Preserve "
        "reading order top-to-bottom, left-to-right.\n\n"
        "Preserve the document's own natural line breaks — each distinct "
        "line/paragraph in the source (the issuing body, the citation "
        "number, each Điều/Khoản/Điểm, each ordinary paragraph) should be "
        "its own line in your output, exactly where it breaks in the "
        "source. Do not merge separate lines together, and do not add "
        "extra line breaks in the middle of one continuous sentence.\n\n"
        "Do not use any Markdown syntax (no #, no **bold**, no *italic*, "
        "no - or 1. list markers) and no HTML tags anywhere in the text. "
        "Do not apply bold, italic, or underline formatting even if the "
        "source shows it that way. Output plain text only, with nothing "
        "added and nothing tagged.\n\n"
        "The one exception is tables: represent a table with no merged "
        "cells as a plain <table>/<tr>/<td> HTML table, and use colspan/"
        "rowspan attributes for any cell that visually spans multiple rows "
        "or columns. Preserve every row label and cell value exactly. "
        "Never use LaTeX or Markdown table syntax.\n\n"
        "Output only the transcribed content. Do not wrap the output in a "
        "code fence. Do not add any commentary before or after it."
    ),
    response_format=ResponseFormat.MARKDOWN,
    timeout=240.0,
    concurrency=2,
    scale=2.0,
)

pipeline_options = VlmPipelineOptions(vlm_options=api_options, enable_remote_services=True)
converter = DocumentConverter(
    format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_cls=VlmPipeline, pipeline_options=pipeline_options)
    }
)

print(f"Converting {DOC.name} via VLM ({VLM_MODEL} @ {VLM_BASE_URL})...", flush=True)
t0 = time.perf_counter()
result = converter.convert(str(DOC))
elapsed = time.perf_counter() - t0
print(f"status: {result.status}", flush=True)
text = result.document.export_to_text(traverse_pictures=True)

OUT.write_text(text, encoding="utf-8")
print(f"Done in {elapsed:.1f}s. {len(text)} chars written to {OUT}", flush=True)
