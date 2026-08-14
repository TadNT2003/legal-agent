"""
Cheap table-likelihood triage for scanned PDFs, used to shortlist the 50
table-heavy candidates for the docling+EasyOCR page-by-page test without
paying full OCR cost (17-28s/page) on the whole 597-doc scanned pool first.

Renders each page to a grayscale image via pdfium, isolates long horizontal
and vertical ruled lines via morphological open (the standard OpenCV
table-grid-detection trick), and scores the page by how many line
intersections it has. Vietnamese legal-document tables in this corpus are
ruled (bordered), not borderless, so this is a reasonable proxy — it will
under-count borderless tables, which is a known limitation, not a bug.
"""

import json
import time
from pathlib import Path

import cv2
import numpy as np
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[3]
SANDBOX = Path(__file__).resolve().parents[1]

RENDER_DPI = 150
SCALE = RENDER_DPI / 72


def page_table_score(pil_image) -> dict:
    img = np.array(pil_image.convert("L"))
    # binarize (invert so ink = white, matches morphology convention)
    bw = cv2.adaptiveThreshold(
        img, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 25, 15
    )
    h, w = bw.shape
    horiz_len = max(20, w // 30)
    vert_len = max(20, h // 30)

    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (horiz_len, 1))
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vert_len))

    horiz_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, horiz_kernel, iterations=1)
    vert_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, vert_kernel, iterations=1)

    grid = cv2.bitwise_and(horiz_lines, vert_lines)
    intersections = cv2.countNonZero(grid)

    # count distinct horizontal line segments (rows with a long run of ink)
    horiz_rows = np.count_nonzero(np.sum(horiz_lines > 0, axis=1) > horiz_len)
    vert_cols = np.count_nonzero(np.sum(vert_lines > 0, axis=0) > vert_len)

    return {
        "intersections": int(intersections),
        "horiz_lines": int(horiz_rows),
        "vert_lines": int(vert_cols),
    }


def score_pdf(path: Path, max_pages: int = None) -> dict:
    pdf = pdfium.PdfDocument(str(path))
    n = len(pdf)
    pages_to_check = range(n) if max_pages is None else range(min(n, max_pages))
    page_scores = []
    for i in pages_to_check:
        page = pdf[i]
        bitmap = page.render(scale=SCALE)
        pil_image = bitmap.to_pil()
        s = page_table_score(pil_image)
        s["page"] = i + 1
        page_scores.append(s)
        page.close()
    pdf.close()
    best = max(page_scores, key=lambda s: s["intersections"]) if page_scores else None
    total_intersections = sum(s["intersections"] for s in page_scores)
    pages_with_grid = sum(1 for s in page_scores if s["intersections"] > 30)
    return {
        "num_pages": n,
        "pages_checked": len(page_scores),
        "total_intersections": total_intersections,
        "pages_with_grid": pages_with_grid,
        "best_page": best,
    }


if __name__ == "__main__":
    import sys

    census = json.loads((SANDBOX / "census_pdfs.json").read_text(encoding="utf-8"))
    scanned = [d for d in census if d["status"] == "ok" and d["scan_status"] == "fully_scanned"]

    n = int(sys.argv[1]) if len(sys.argv) > 1 else len(scanned)
    out_name = sys.argv[2] if len(sys.argv) > 2 else "_table_triage_full.json"
    subset = scanned[:n]

    print(f"Table-triage run on {len(subset)} scanned docs (max 40 pages each)", flush=True)
    results = []
    t0 = time.perf_counter()
    for i, d in enumerate(subset, 1):
        path = ROOT / d["path"]
        try:
            t1 = time.perf_counter()
            r = score_pdf(path, max_pages=40)
            elapsed = time.perf_counter() - t1
            r.update({"citation": d["citation"], "title": d["title"], "path": d["path"], "elapsed_sec": round(elapsed, 2)})
            results.append(r)
        except Exception as e:
            results.append({"citation": d["citation"], "title": d["title"], "path": d["path"], "error": f"{type(e).__name__}: {e}"})
        if i % 25 == 0 or i == len(subset):
            print(f"  {i}/{len(subset)} done ({time.perf_counter()-t0:.1f}s elapsed)", flush=True)

    print(f"\nTotal elapsed: {time.perf_counter()-t0:.1f}s for {len(subset)} docs")

    out_path = SANDBOX / "scripts" / out_name
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Written to {out_path}")

    ok = [r for r in results if "error" not in r]
    ok.sort(key=lambda r: r["total_intersections"], reverse=True)
    print("\nTop 15 candidates by total_intersections:")
    for r in ok[:15]:
        print(f"  {r['total_intersections']:6d}  {r['citation']}")
