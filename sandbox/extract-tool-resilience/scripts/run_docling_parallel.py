"""
docling + EasyOCR(vi) page-by-page resilience test, 50 table-heavy scanned
PDFs, split into 5 checkpointed chunks of 10 documents and processed by a
4-worker process pool (one worker free at a time given host RAM headroom).

Checkpointing: each chunk writes its own outputs/docling/_chunk{N}_timings.json,
appended after every single page. Re-running this script skips any (doc, page)
already recorded as done in that chunk's checkpoint file, so a crashed or
killed chunk resumes instead of restarting from page 1.
"""

import json
import os
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

ROOT = Path(__file__).resolve().parents[3]
SANDBOX = Path(__file__).resolve().parents[1]
SAMPLES = SANDBOX / "samples" / "docling"
OUT = SANDBOX / "outputs" / "docling"
OUT.mkdir(parents=True, exist_ok=True)

NUM_CHUNKS = 5
MAX_WORKERS = 3
MAX_RETRY_PASSES = 8


def build_chunks():
    manifest = json.loads((SANDBOX / "samples" / "docling_manifest.json").read_text(encoding="utf-8"))
    # round-robin by rank (manifest is already sorted by table_score desc) so
    # each chunk gets a mix of heavy/light docs instead of all-heavy-then-all-light
    chunks = [[] for _ in range(NUM_CHUNKS)]
    for i, entry in enumerate(manifest):
        chunks[i % NUM_CHUNKS].append(entry)
    return chunks


def load_checkpoint(chunk_id: int) -> dict:
    ckpt_path = OUT / f"_chunk{chunk_id}_timings.json"
    if ckpt_path.exists():
        return json.loads(ckpt_path.read_text(encoding="utf-8"))
    return {}


def save_checkpoint(chunk_id: int, data: dict):
    ckpt_path = OUT / f"_chunk{chunk_id}_timings.json"
    ckpt_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def process_chunk(chunk_id: int, docs: list) -> str:
    import pypdfium2 as pdfium
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import EasyOcrOptions, PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    opts = PdfPipelineOptions()
    opts.ocr_options = EasyOcrOptions(lang=["vi"], use_gpu=False)
    converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})

    checkpoint = load_checkpoint(chunk_id)
    log_lines = [f"[chunk {chunk_id}] starting, {len(docs)} docs assigned"]

    for entry in docs:
        filename = entry["filename"]
        src = SAMPLES / filename
        doc_key = filename
        doc_ckpt = checkpoint.setdefault(doc_key, {"citation": entry["citation"], "num_pages": entry["num_pages"], "pages": {}})

        num_pages = len(pdfium.PdfDocument(str(src)))
        md_parts = []
        for page in range(1, num_pages + 1):
            page_key = str(page)
            if page_key in doc_ckpt["pages"] and doc_ckpt["pages"][page_key].get("status") == "ok":
                md_parts.append(doc_ckpt["pages"][page_key].get("markdown", ""))
                continue
            t0 = time.perf_counter()
            try:
                result = converter.convert(str(src), page_range=(page, page))
                md = result.document.export_to_markdown()
                elapsed = time.perf_counter() - t0
                doc_ckpt["pages"][page_key] = {
                    "status": "ok",
                    "elapsed_sec": round(elapsed, 2),
                    "chars": len(md),
                    "markdown": md,
                }
                md_parts.append(md)
            except Exception as e:
                elapsed = time.perf_counter() - t0
                doc_ckpt["pages"][page_key] = {
                    "status": "error",
                    "elapsed_sec": round(elapsed, 2),
                    "error": f"{type(e).__name__}: {e}",
                }
            save_checkpoint(chunk_id, checkpoint)

        combined = "\n\n---\n\n".join(md_parts)
        (OUT / (Path(filename).stem + ".md")).write_text(combined, encoding="utf-8")
        ok_pages = sum(1 for p in doc_ckpt["pages"].values() if p.get("status") == "ok")
        log_lines.append(f"[chunk {chunk_id}] {filename}: {ok_pages}/{num_pages} pages ok")

    log_lines.append(f"[chunk {chunk_id}] DONE")
    return "\n".join(log_lines)


def chunk_is_complete(chunk_id: int, docs: list) -> bool:
    checkpoint = load_checkpoint(chunk_id)
    for entry in docs:
        doc_ckpt = checkpoint.get(entry["filename"])
        if doc_ckpt is None:
            return False
        done = sum(1 for p in doc_ckpt["pages"].values() if p.get("status") in ("ok", "error"))
        if done < entry["num_pages"]:
            return False
    return True


if __name__ == "__main__":
    chunks = build_chunks()
    print(f"Built {len(chunks)} chunks: {[len(c) for c in chunks]} docs each", flush=True)

    t_start = time.perf_counter()
    for attempt in range(1, MAX_RETRY_PASSES + 1):
        pending = [i for i in range(NUM_CHUNKS) if not chunk_is_complete(i, chunks[i])]
        if not pending:
            print(f"\nAll chunks complete after {attempt - 1} pass(es), {time.perf_counter()-t_start:.1f}s total", flush=True)
            break

        print(f"\n=== Pass {attempt}: {len(pending)} chunk(s) pending: {pending} (workers={MAX_WORKERS}) ===", flush=True)
        with ProcessPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(process_chunk, i, chunks[i]): i for i in pending}
            try:
                for future in as_completed(futures):
                    chunk_id = futures[future]
                    try:
                        result = future.result()
                        print(result, flush=True)
                    except Exception as e:
                        print(f"[chunk {chunk_id}] FAILED this pass: {type(e).__name__}: {e}", flush=True)
            except Exception as e:
                print(f"[pass {attempt}] pool-level failure: {type(e).__name__}: {e}", flush=True)
        time.sleep(5)
    else:
        still_pending = [i for i in range(NUM_CHUNKS) if not chunk_is_complete(i, chunks[i])]
        print(f"\nGave up after {MAX_RETRY_PASSES} passes. Still incomplete: {still_pending}", flush=True)
