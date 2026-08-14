"""
Sanity check for Eval-01: does each downloaded PDF actually correspond to the
citation recorded for it in manifest.json? Catches any mismatch between a
listing item's citation and the download link scraped alongside it.

Two content patterns make a naive "is the exact citation substring in the
extracted text" check unreliable on its own (confirmed by inspecting raw
extraction output, not assumed):
  - Van ban hop nhat (VBHN, consolidated-text) documents structurally never
    print their own VBHN catalog number in the body -- the body only cites the
    *original* instrument being consolidated (e.g. "Thong tu so 21/2013/TT-...").
    Verify these by subject-keyword overlap between the manifest title and the
    PDF body instead of by citation string.
  - Thong tu lien tich (multi-issuer joint circulars) headers are two-column
    (issuing bodies + citation on the left, place/date on the right); when the
    citation itself is long enough to wrap to a second line, the right column's
    date text sits on the same row as the wrap point and lands in the middle of
    it under naive whitespace stripping -- confirmed on a real sample even with
    pdfplumber's layout=True. Verify these with an in-order/nearby token match
    instead of an exact contiguous substring match.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pdfplumber

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "samples"
manifest = json.loads((SAMPLES / "manifest.json").read_text(encoding="utf-8"))

WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)  # letters/digits, drops punctuation/whitespace as separators


def tokens(s: str) -> list[str]:
    return [t.upper() for t in WORD_RE.findall(s)]


def citation_regex(citation: str, max_gap_chars: int = 60) -> re.Pattern:
    """Build a regex that matches the citation's segments (split on the same
    punctuation the citation itself uses) in order, each separated by up to
    max_gap_chars of *anything* (DOTALL) -- tolerates a mid-citation line wrap
    with a two-column header's date text landing in the gap, without the
    ambiguity of matching common short tokens (e.g. "01") out of context that
    a plain token-by-token search has (regex backtracking explores all
    candidate start positions properly; a hand-rolled forward-only scan doesn't)."""
    # also split on "&" -- congbao's own listing pages are inconsistent about
    # whether "BNNPTNT" (Bo Nong nghiep va Phat trien nong thon) is abbreviated
    # plain or as "BNN&PTNT" in a joint-circular citation; confirmed both forms
    # for the same ministry, sometimes disagreeing between the listing page and
    # the PDF body for the *same* document -- a real congbao data inconsistency,
    # not a scrape error, so don't let it block a match either way.
    segments = [s for s in re.split(r"[\/\-&]", citation) if s.strip()]
    parts = [re.escape(seg.strip()) for seg in segments]
    pattern = (r".{0,%d}?" % max_gap_chars).join(parts)
    return re.compile(pattern, re.IGNORECASE | re.DOTALL)


def citation_in_text(citation: str, text: str) -> bool:
    return citation_regex(citation).search(text) is not None


def extract_text(pdf_path: Path, n_pages: int = 6) -> str:
    with pdfplumber.open(pdf_path) as pdf:
        return "\n".join((p.extract_text() or "") for p in pdf.pages[:n_pages])


def title_keyword_overlap(title: str, text: str, min_hits: int = 3) -> bool:
    # Vietnamese function words too generic to count as evidence
    stop = {"SO", "SỐ", "CỦA", "VÀ", "VỀ", "MỘT", "CÁC", "THEO", "TẠI", "CHO", "TRONG", "ĐƯỢC",
            "VĂN", "BẢN", "HỢP", "NHẤT", "SỬA", "ĐỔI", "BỔ", "SUNG", "QUY", "ĐỊNH", "NGÀY", "THÁNG", "NĂM"}
    title_words = [w for w in tokens(title) if len(w) > 2 and w not in stop and not w.isdigit()]
    text_words = set(tokens(text))
    hits = sum(1 for w in title_words if w in text_words)
    return hits >= min(min_hits, max(1, len(title_words) // 2))


results = []
for entry in manifest:
    pdf_path = SAMPLES / entry["filename"]
    citation = entry["citation"]
    try:
        text = extract_text(pdf_path)
    except Exception as e:
        results.append({"filename": entry["filename"], "citation": citation, "status": "extract_error", "error": str(e)})
        continue
    text = text.replace("&", "")  # the "BNN&PTNT" vs "BNNPTNT" inconsistency runs both directions --
    # some documents' own body text has the "&" even where the recorded citation doesn't; strip
    # it from the searched text too rather than only from the citation being searched for.

    if citation_in_text(citation, text):
        results.append({"filename": entry["filename"], "citation": citation, "status": "match_citation"})
        continue

    if entry["type_slug"] == "van-ban-hop-nhat-l7":
        if title_keyword_overlap(entry["title"], text):
            results.append({"filename": entry["filename"], "citation": citation, "status": "match_title_subject (VBHN, citation not expected in body)"})
            continue

    results.append({"filename": entry["filename"], "citation": citation, "status": "NO_MATCH", "title": entry["title"]})

ok = [r for r in results if r["status"].startswith("match")]
bad = [r for r in results if not r["status"].startswith("match")]
print(f"Checked {len(results)} PDFs: {len(ok)} match, {len(bad)} still unresolved.")
for r in bad:
    print(f"  [{r['status']}] {r['filename']}  citation={r['citation']!r}  {r.get('title','')} {r.get('error','')}")

(SAMPLES / "citation_match_check.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
