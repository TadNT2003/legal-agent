"""
Whole-document plain-text transcription test: send all pages of the test
document in ONE chat completion request (multi-image message) instead of
docling's per-page architecture, so the model sees the document as one
continuous flow instead of N independent pages with no shared context.
Targets the two concrete failure modes found in the per-page attempt:
two-column letterhead blending and page-number digits fusing onto
adjacent text across page boundaries. Bypasses docling entirely — this is
a raw HTTP request, output goes straight to plain text for the real
parseDocumentBody() parser, not through DoclingDocument.
"""

import base64
import os
import time
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
OUT = SANDBOX / "outputs" / "docling" / "VLM" / (DOC.stem + "_wholedoc_plaintext.txt")

PROMPT = (
    "Transcribe this entire scanned Vietnamese legal document as one "
    "continuous plain text, exactly as if you selected all the text across "
    "every page and copied it. You are given all pages of the document, in "
    "order, as separate images — treat them as one continuous document, "
    "not as separate independent pages. Preserve all Vietnamese diacritics "
    "exactly.\n\n"
    "Preserve the document's own natural line breaks — each distinct "
    "line/paragraph in the source (the issuing body, the citation number, "
    "each Điều/Khoản/Điểm, each ordinary paragraph) should be its own line "
    "in your output, exactly where it breaks in the source. Do not merge "
    "separate lines together, and do not add extra line breaks in the "
    "middle of one continuous sentence.\n\n"
    "Two specific things to get right, since this document has both:\n"
    "1. The first page's letterhead has two columns side by side (e.g. "
    "\"QUỐC HỘI\" / issuing body on the left, \"CỘNG HÒA XÃ HỘI CHỦ NGHĨA "
    "VIỆT NAM\" / national motto on the right, with the citation number "
    "and date-place line below each). Transcribe each column as its own "
    "separate line — read down the left column first, then down the right "
    "column — never merge text from the left and right columns onto the "
    "same output line.\n"
    "2. Each page has a printed page number (a bare digit) near the top or "
    "bottom margin. This is a page-layout artifact, not part of the "
    "document's actual text — omit it entirely from your output. Do not "
    "let it get fused onto the start or end of an adjacent line of real "
    "content, and do not let a sentence, Khoản, or Điều that continues "
    "across a page boundary get broken or have anything inserted into it — "
    "join it back into one continuous, uninterrupted line or paragraph "
    "exactly as if the page break had never happened.\n\n"
    "Do not use any Markdown syntax (no #, no **bold**, no *italic*, no - "
    "or 1. list markers beyond what's already numbered in the source) and "
    "no HTML tags anywhere in the text. Do not apply bold, italic, or "
    "underline formatting even if the source shows it that way.\n\n"
    "The one exception is tables: represent a table with no merged cells "
    "as a plain <table>/<tr>/<td> HTML table, and use colspan/rowspan "
    "attributes for any cell that visually spans multiple rows or "
    "columns. Preserve every row label and cell value exactly. Never use "
    "LaTeX or Markdown table syntax.\n\n"
    "Output only the transcribed content, in page order, as one "
    "continuous document. Do not wrap the output in a code fence. Do not "
    "add any commentary before or after it, and do not mention pages or "
    "page numbers in your output."
)

pdf = pdfium.PdfDocument(str(DOC))
num_pages = len(pdf)
print(f"Rendering {num_pages} pages...", flush=True)

image_blocks = []
for i in range(num_pages):
    page = pdf[i]
    bitmap = page.render(scale=2.0)
    pil_image = bitmap.to_pil().convert("RGB")
    buf = BytesIO()
    pil_image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    image_blocks.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
    page.close()

payload = {
    "model": VLM_MODEL,
    "max_tokens": 24000,
    "temperature": 0.0,
    "reasoning_effort": "none",
    "messages": [
        {
            "role": "user",
            "content": image_blocks + [{"type": "text", "text": PROMPT}],
        }
    ],
}

print(f"Sending {num_pages} images in one request to {VLM_MODEL}...", flush=True)
t0 = time.perf_counter()
r = requests.post(
    f"{VLM_BASE_URL}/chat/completions",
    headers={"Authorization": f"Bearer {VLM_API_KEY}", "Content-Type": "application/json"},
    json=payload,
    timeout=600,
)
elapsed = time.perf_counter() - t0
body = r.json()
if "choices" not in body:
    print(f"ERROR response after {elapsed:.1f}s: {body}", flush=True)
else:
    content = body["choices"][0]["message"].get("content") or ""
    finish_reason = body["choices"][0].get("finish_reason")
    usage = body.get("usage")
    OUT.write_text(content, encoding="utf-8")
    print(f"Done in {elapsed:.1f}s. finish_reason={finish_reason} usage={usage}", flush=True)
    print(f"{len(content)} chars written to {OUT}", flush=True)
