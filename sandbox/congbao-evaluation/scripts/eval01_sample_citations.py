"""
Eval-01: sample ~200 random, real citations spread across congbao.chinhphu.vn's
archive (~2010 -> today), locate each via the binary-search-on-listing-pages
method (no search bar, no browser -- see congbao_lib.py's module docstring),
and download its PDF into samples/.

Resumable: re-running skips citations already present in samples/manifest.json.
"""
from __future__ import annotations

import json
import random
import re
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path

# Windows consoles often default to a legacy codepage (cp1252) that can't print
# Vietnamese diacritics -- reconfigure stdout to UTF-8 (Python 3.7+) so progress
# logging never crashes the run; data files are already written as UTF-8 regardless.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
import congbao_lib as cb

ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = ROOT / "samples"
MANIFEST_PATH = SAMPLES_DIR / "manifest.json"
SKIPPED_PATH = SAMPLES_DIR / "skipped.json"

TARGET_COUNT = 200
ARCHIVE_START = date(2010, 1, 1)  # congbao's digitized archive starts ~Dec 2010; a few weeks of
# slack on the early side just means those draws re-roll into "no items on this page" and retry
ARCHIVE_END = date.today()
MAX_TOTAL_ATTEMPTS = TARGET_COUNT * 6  # generous retry budget for duplicate draws / thin pages


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return text or "doc"


def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def save_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def main() -> None:
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = load_json(MANIFEST_PATH, [])
    skipped: list[dict] = load_json(SKIPPED_PATH, [])
    seen_urls = {m["detail_url"] for m in manifest}

    print("Fetching total page counts per type category...")
    type_pages: dict[str, int] = {}
    for slug in cb.TYPE_SLUGS:
        try:
            total = cb.get_total_pages(slug)
        except Exception as e:
            print(f"  {slug}: FAILED ({e}) -- excluded from sampling")
            continue
        type_pages[slug] = total
        print(f"  {slug}: {total} pages")

    weighted_types = [(slug, pages) for slug, pages in type_pages.items() if pages > 0]
    if not weighted_types:
        raise SystemExit("No usable type categories -- aborting")

    attempts = 0
    t_start = time.perf_counter()
    while len(manifest) < TARGET_COUNT and attempts < MAX_TOTAL_ATTEMPTS:
        attempts += 1
        slug = random.choices(
            [s for s, _ in weighted_types],
            weights=[p for _, p in weighted_types],
            k=1,
        )[0]
        total_pages = type_pages[slug]
        target = cb.random_target_date(ARCHIVE_START, ARCHIVE_END)

        try:
            page_no, items = cb.binary_search_page(slug, total_pages, target)
        except Exception as e:
            skipped.append({"reason": f"binary_search_error: {e}", "type_slug": slug, "target_date": str(target)})
            continue

        candidates = [it for it in items if it.detail_url not in seen_urls and it.pdf_url]
        if not candidates:
            skipped.append({
                "reason": "no_new_candidates_on_landed_page",
                "type_slug": slug, "target_date": str(target), "page": page_no,
                "items_on_page": len(items),
            })
            continue

        chosen = random.choice(candidates)
        seen_urls.add(chosen.detail_url)

        doc_slug = slugify(chosen.detail_url.rsplit("/", 1)[-1].removesuffix(".htm"))
        filename = f"{doc_slug}.pdf"
        dest = SAMPLES_DIR / filename

        entry = {
            "citation": chosen.citation,
            "title": chosen.title,
            "type_slug": slug,
            "issued_date": str(chosen.issued_date) if chosen.issued_date else None,
            "detail_url": chosen.detail_url,
            "pdf_url": chosen.pdf_url,
            "pdf_source_filename": chosen.pdf_filename,
            "landed_page": page_no,
            "target_date": str(target),
            "filename": filename,
        }
        try:
            size = cb.download_pdf(chosen.pdf_url, dest)
            entry["status"] = "ok"
            entry["size_bytes"] = size
        except Exception as e:
            entry["status"] = "download_failed"
            entry["error"] = f"{type(e).__name__}: {e}"
            skipped.append(entry)
            seen_urls.discard(chosen.detail_url)  # allow a different draw to retry this slot; don't burn it permanently
            continue

        manifest.append(entry)
        save_json(MANIFEST_PATH, manifest)
        save_json(SKIPPED_PATH, skipped)
        print(f"[{len(manifest)}/{TARGET_COUNT}] {entry['citation']} ({entry['issued_date']}, {slug}) -> {filename} ({size} bytes)")

    save_json(MANIFEST_PATH, manifest)
    save_json(SKIPPED_PATH, skipped)
    elapsed = time.perf_counter() - t_start
    print(f"\nDone. {len(manifest)}/{TARGET_COUNT} downloaded in {attempts} attempts, {elapsed:.1f}s.")
    if len(manifest) < TARGET_COUNT:
        print(f"WARNING: only reached {len(manifest)} — see {SKIPPED_PATH.name} for why attempts were skipped.")

    years = sorted({int(m["issued_date"][:4]) for m in manifest if m.get("issued_date")})
    if years:
        print(f"Year range covered: {years[0]}-{years[-1]}")
    type_counts: dict[str, int] = {}
    for m in manifest:
        type_counts[m["type_slug"]] = type_counts.get(m["type_slug"], 0) + 1
    print("Per-type counts:", type_counts)


if __name__ == "__main__":
    main()
