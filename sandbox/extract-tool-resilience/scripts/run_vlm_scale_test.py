"""
Scale test for the VLM plain-text approach across the same 50-document
sample used for the docling+EasyOCR evaluation. Runs true per-page
requests (CHUNK_SIZE=1) — see the comment above PROMPT for why this
reverted from an earlier whole-document/chunked design; per-page output is
concatenated in page order to form each document's full text.

Checkpointed at the (document, page) level in _vlm_scale_checkpoint.json
so a crash/timeout only costs the in-flight page, not the whole run — same
lesson learned from the docling+EasyOCR parallel run earlier in this
evaluation. Retries transient network errors with backoff. Runs a small
number of documents concurrently (their internal pages are sequential).
"""

import base64
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from threading import Lock

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

SAMPLES = SANDBOX / "samples" / "docling"
OUT_DIR = SANDBOX / "outputs" / "VLM"
OUT_DIR.mkdir(parents=True, exist_ok=True)
CHECKPOINT_PATH = OUT_DIR / "_vlm_scale_checkpoint.json"

CHUNK_SIZE = 1  # true per-page — see comment above the PROMPT for why
MAX_WORKERS = 2
MAX_RETRIES = 3
REQUEST_TIMEOUT = 600

# Per-page again, not whole-document/chunked: the earlier switch to
# multi-page requests was driven by two problems, but only one of them
# actually needed it. The two-column-letterhead merge was a within-page
# reading-order issue, fixed by the explicit column instruction below,
# nothing to do with seeing other pages. The page-number-fusion issue is a
# genuine cross-page problem (a single page has no way to know a sentence
# continues onto the next one) — going back to per-page means we can no
# longer literally rejoin a split sentence, so a Khoản/sentence that spans
# a real page break will get an extra line break at the seam once the
# per-page outputs are concatenated. That's a real, accepted trade-off, but
# a much smaller one than what motivated the switch in the first place
# (structural-tag inconsistency across independent page requests, which is
# moot now that this prompt asks for plain text with no tags at all) — and
# it doesn't break parseDocumentBody()'s structure recognition, since a
# stray internal newline inside one Khoản's text doesn't stop it from
# being recognized or close it early. Per-page also directly fixes the
# gateway's 300s timeout problem, since a single-page request is far
# smaller than even a 6-page chunk.
PROMPT = (
    "Transcribe this scanned Vietnamese legal document page as plain "
    "text, exactly as if you selected all the text on the page and copied "
    "it. Preserve all Vietnamese diacritics exactly.\n\n"
    "Preserve the page's own natural line breaks — each distinct "
    "line/paragraph on the page (the issuing body, the citation number, "
    "each Điều/Khoản/Điểm, each ordinary paragraph) should be its own line "
    "in your output, exactly where it breaks on the page. Do not merge "
    "separate lines together, and do not add extra line breaks in the "
    "middle of one continuous sentence.\n\n"
    "Two specific things to get right, since this page may have either:\n"
    "1. A letterhead with two columns side by side (e.g. \"QUỐC HỘI\" / "
    "issuing body on the left, \"CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\" / "
    "national motto on the right, with the citation number and date-place "
    "line below each). Transcribe each column as its own separate line — "
    "read down the left column first, then down the right column — never "
    "merge text from the left and right columns onto the same output line.\n"
    "2. A printed page number (a bare digit) near the top or bottom "
    "margin. This is a page-layout artifact, not part of the document's "
    "actual text — omit it entirely from your output. Do not let it get "
    "fused onto the start or end of an adjacent line of real content. If "
    "the page's first or last line is a sentence, Khoản, or Điều that's "
    "visibly cut off (continuing from the previous page or onto the next "
    "one), transcribe exactly what's on this page and stop there — don't "
    "try to complete or guess the missing part, and don't insert anything "
    "in its place.\n\n"
    "Do not use any Markdown syntax (no #, no **bold**, no *italic*, no - "
    "or 1. list markers beyond what's already numbered in the source) and "
    "no HTML tags anywhere in the text. Do not apply bold, italic, or "
    "underline formatting even if the source shows it that way.\n\n"
    "The one exception is tables: represent a table with no merged cells "
    "as a plain <table>/<tr>/<td> HTML table, and use colspan/rowspan "
    "attributes for any cell that visually spans multiple rows or "
    "columns. Preserve every row label and cell value exactly. Never use "
    "LaTeX or Markdown table syntax.\n\n"
    "Output only the transcribed content. Do not wrap the output in a "
    "code fence. Do not add any commentary before or after it, and do not "
    "mention the page or page number in your output."
)

checkpoint_lock = Lock()


def load_checkpoint() -> dict:
    if CHECKPOINT_PATH.exists():
        return json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))
    return {}


def save_checkpoint_chunk(stem: str, chunk_idx: int, text: str):
    with checkpoint_lock:
        checkpoint = load_checkpoint()
        checkpoint.setdefault(stem, {})[str(chunk_idx)] = text
        CHECKPOINT_PATH.write_text(json.dumps(checkpoint, ensure_ascii=False), encoding="utf-8")


def render_page_b64(pdf, page_no: int) -> str:
    page = pdf[page_no]
    bitmap = page.render(scale=2.0)
    pil_image = bitmap.to_pil().convert("RGB")
    buf = BytesIO()
    pil_image.save(buf, format="PNG")
    page.close()
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _safe_error_summary(body: dict) -> str:
    # The gateway's error responses can echo back parts of the original
    # request (which contains our base64-encoded page images) inside
    # `extra_fields`/`raw_request` — never stringify the whole body, or a
    # single timeout balloons the log by several MB. Pull out just the
    # human-readable bits.
    err = body.get("error")
    if isinstance(err, dict):
        return f"{err.get('type', '?')}: {err.get('message', '?')}"
    return f"{type(err).__name__ if err is not None else 'unknown'} (keys: {list(body.keys())})"


def call_vlm(image_b64_list: list) -> str:
    image_blocks = [{"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}} for b64 in image_b64_list]
    payload = {
        "model": VLM_MODEL,
        "max_tokens": 24000,
        "temperature": 0.0,
        "reasoning_effort": "none",
        "messages": [{"role": "user", "content": image_blocks + [{"type": "text", "text": PROMPT}]}],
    }
    last_err_summary = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.post(
                f"{VLM_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {VLM_API_KEY}", "Content-Type": "application/json"},
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            body = r.json()
            if "choices" not in body:
                raise RuntimeError(_safe_error_summary(body))
            return body["choices"][0]["message"].get("content") or ""
        except Exception as e:
            # Bound to 300 chars regardless of exception type — some
            # requests exceptions embed the full PreparedRequest (headers +
            # body, i.e. our images again) in their own __str__.
            last_err_summary = f"{type(e).__name__}: {str(e)[:300]}"
            print(f"    attempt {attempt}/{MAX_RETRIES} failed: {last_err_summary}", flush=True)
            time.sleep(5 * attempt)
    raise RuntimeError(f"all {MAX_RETRIES} attempts failed, last: {last_err_summary}")


def process_document(entry: dict) -> str:
    filename = entry["filename"]
    stem = Path(filename).stem
    out_path = OUT_DIR / f"{stem}.txt"
    if out_path.exists():
        return f"[{stem}] already done, skipping"

    src = SAMPLES / filename
    pdf = pdfium.PdfDocument(str(src))
    num_pages = len(pdf)
    num_chunks = (num_pages + CHUNK_SIZE - 1) // CHUNK_SIZE

    checkpoint = load_checkpoint()
    existing_chunks = checkpoint.get(stem, {})

    chunk_texts = []
    t0 = time.perf_counter()
    for chunk_idx in range(num_chunks):
        if str(chunk_idx) in existing_chunks:
            chunk_texts.append(existing_chunks[str(chunk_idx)])
            continue
        start = chunk_idx * CHUNK_SIZE
        end = min(start + CHUNK_SIZE, num_pages)
        images = [render_page_b64(pdf, p) for p in range(start, end)]
        text = call_vlm(images)
        chunk_texts.append(text)
        save_checkpoint_chunk(stem, chunk_idx, text)

    full_text = "\n\n".join(chunk_texts)
    out_path.write_text(full_text, encoding="utf-8")
    elapsed = time.perf_counter() - t0
    return f"[{stem}] {num_pages}p, {num_chunks} chunk(s), {len(full_text)} chars, {elapsed:.1f}s"


if __name__ == "__main__":
    manifest = json.loads((SANDBOX / "samples" / "docling_manifest.json").read_text(encoding="utf-8"))
    manifest.sort(key=lambda e: e["num_pages"])

    print(f"Processing {len(manifest)} documents, {sum(e['num_pages'] for e in manifest)} total pages, {MAX_WORKERS} workers", flush=True)
    t_start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_document, entry): entry["filename"] for entry in manifest}
        for future in as_completed(futures):
            filename = futures[future]
            try:
                result = future.result()
                print(result, flush=True)
            except Exception as e:
                print(f"[{filename}] FAILED: {type(e).__name__}: {e}", flush=True)

    print(f"\nAll done in {time.perf_counter()-t_start:.1f}s", flush=True)
