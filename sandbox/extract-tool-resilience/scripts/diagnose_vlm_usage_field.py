"""
Diagnose why the VLM gateway's response is missing usage.completion_tokens for
some pages (1-5) but not others (6-9) on 128-2020-QH14. Bypasses docling
entirely and POSTs directly to the gateway, printing the raw JSON usage block
for each page so the actual response shape is visible, not just docling's
post-validation error.
"""

import base64
import json
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
    "Preserve all Vietnamese diacritics exactly. Reproduce tables as "
    "Markdown pipe-tables, preserving every row label and cell value. "
    "Preserve reading order top-to-bottom, left-to-right. "
    "Output only the Markdown, no commentary."
)

pdf = pdfium.PdfDocument(str(DOC))

for page_no in range(1, 10):
    page = pdf[page_no - 1]
    bitmap = page.render(scale=2.0)
    pil_image = bitmap.to_pil().convert("RGB")
    buf = BytesIO()
    pil_image.save(buf, format="PNG")
    image_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    payload = {
        "model": VLM_MODEL,
        "max_tokens": 4096,
        "temperature": 0.0,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_base64}"}},
                    {"type": "text", "text": PROMPT},
                ],
            }
        ],
    }
    r = requests.post(
        f"{VLM_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {VLM_API_KEY}", "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    body = r.json()
    usage = body.get("usage")
    finish_reason = body.get("choices", [{}])[0].get("finish_reason")
    content_len = len(body.get("choices", [{}])[0].get("message", {}).get("content") or "")
    print(f"page {page_no}: HTTP {r.status_code}  finish_reason={finish_reason}  content_len={content_len}  usage={usage}")
    page.close()
