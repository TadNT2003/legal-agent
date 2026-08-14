"""
Reproducibility check: does the LaTeX-table / missing-table failure from
reasoning_effort:none recur consistently, and does clearer table-handling
instruction (native MD pipe-table for simple tables, HTML <table> with
colspan/rowspan for merged-cell tables) fix it? Raw HTTP, bypassing docling,
against page 6 (simple table, got LaTeX'd) and page 9 (merged-header table,
went missing) of 128-2020-QH14, 3 attempts each.
"""

import base64
import os
from io import BytesIO
from pathlib import Path

import pypdfium2 as pdfium
import requests

SANDBOX = Path(__file__).resolve().parents[1]
for line in (SANDBOX / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ[k] = v

VLM_BASE_URL = os.environ["VLM_BASE_URL"]
VLM_API_KEY = os.environ["VLM_API_KEY"]
VLM_MODEL = os.environ["VLM_MODEL"]
DOC = SANDBOX / "samples" / "docling" / "128-2020-QH14_ve-du-toan-ngan-sach-nha-nuoc-nam-2021.pdf"

PROMPT = (
    "Convert this scanned Vietnamese legal document page to Markdown. "
    "Preserve all Vietnamese diacritics exactly. "
    "Preserve reading order top-to-bottom, left-to-right. "
    "Output only the Markdown, no commentary.\n\n"
    "For tables:\n"
    "- If a table has no merged or spanning cells, represent it as a native "
    "Markdown pipe-table (| cell | cell |), preserving every row label and "
    "cell value.\n"
    "- If a table has merged or spanning cells (e.g. a header cell spanning "
    "multiple columns or rows), represent it as an HTML <table> element with "
    "proper colspan/rowspan attributes instead of a Markdown pipe-table.\n"
    "- Never use LaTeX or any other table syntax."
)

pdf = pdfium.PdfDocument(str(DOC))


def render_b64(page_no):
    page = pdf[page_no - 1]
    bitmap = page.render(scale=2.0)
    pil_image = bitmap.to_pil().convert("RGB")
    buf = BytesIO()
    pil_image.save(buf, format="PNG")
    page.close()
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def call(page_no, image_b64):
    payload = {
        "model": VLM_MODEL,
        "max_tokens": 8192,
        "temperature": 0.0,
        "reasoning_effort": "none",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
                    {"type": "text", "text": PROMPT},
                ],
            }
        ],
    }
    for retry in range(3):
        try:
            r = requests.post(
                f"{VLM_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {VLM_API_KEY}", "Content-Type": "application/json"},
                json=payload,
                timeout=240,
            )
            body = r.json()
            return body.get("choices", [{}])[0].get("message", {}).get("content") or ""
        except requests.exceptions.ReadTimeout:
            print(f"    (timeout, retry {retry+1}/3)")
    return "__TIMEOUT__"


for page_no in [6, 9]:
    print(f"\n{'='*20} page {page_no} {'='*20}")
    image_b64 = render_b64(page_no)
    for attempt in range(1, 4):
        content = call(page_no, image_b64)
        has_pipe_table = "|" in content and "---" in content
        has_html_table = "<table" in content.lower()
        has_latex = "\\begin{tabular}" in content or "\\hline" in content
        print(f"  attempt {attempt}: len={len(content)}  pipe_table={has_pipe_table}  html_table={has_html_table}  latex={has_latex}")
        out_path = SANDBOX / "scripts" / f"_repro_p{page_no}_a{attempt}.md"
        out_path.write_text(content, encoding="utf-8")
