"""
Shared helpers for scraping congbao.chinhphu.vn without its search bar.

Discovery method (see docs/plan/congbao-source-evaluation.md in the main repo
for the full write-up): the plain, server-rendered type-category listing pages
(/van-ban-dang-cong-bao/{type-slug}-l{id}/trang-{N}.htm) are strictly sorted
newest -> oldest by "Ngay ban hanh", and expose their own total page count
(`totalPageSodo`) on page 1. Neither the visible search bar nor the site's own
AJAX search endpoints support filtering/searching by date or citation, so a
citation is located by binary-searching these listing pages on their visible
issue date, then scanning the landed page for the target citation string.
Each listing item already embeds its own PDF/DOCX download link (tokenized,
short-lived), so no second fetch to the document detail page is needed.
"""
from __future__ import annotations

import random
import re
import ssl
import time
from dataclasses import dataclass
from datetime import date, timedelta
from html import unescape
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import certifi
import requests
from bs4 import BeautifulSoup

BASE = "https://congbao.chinhphu.vn"
HEADERS = {"User-Agent": "Mozilla/5.0 (legal-agent congbao-evaluation sandbox; contact: internal research use)"}

# g7.cdnchinhphu.vn (the file-download gateway every PDF/DOCX link on congbao
# resolves through) serves only its leaf certificate, no intermediate -- confirmed
# via `openssl s_client -showcerts` (1 cert in the chain). Browsers/curl silently
# recover via AIA fetching (RFC 5280 Authority Information Access -- fetching the
# missing intermediate from the CA-issuer URL embedded in the leaf cert); Python's
# ssl/certifi verification doesn't do that by default, so plain `requests` calls
# fail closed with CERTIFICATE_VERIFY_FAILED. Fix: fetch that one intermediate
# once (its AIA URL, read via `openssl x509 -text`, is
# http://secure.globalsign.com/cacert/gsrsaovsslca2018.crt -- GlobalSign's own
# public repository, DER-encoded) and append it to a local copy of certifi's
# bundle, so verification is still a real chain check, just supplied with what
# the server should have sent itself.
_GLOBALSIGN_INTERMEDIATE_URL = "http://secure.globalsign.com/cacert/gsrsaovsslca2018.crt"
_CA_BUNDLE_PATH = Path(__file__).resolve().parent / "ca_bundle.pem"


def ensure_ca_bundle() -> str:
    """Build (once, cached on disk) certifi's bundle + the GlobalSign intermediate
    g7.cdnchinhphu.vn omits. Returns the bundle path for requests(verify=...)."""
    if _CA_BUNDLE_PATH.exists():
        return str(_CA_BUNDLE_PATH)
    der_resp = requests.get(_GLOBALSIGN_INTERMEDIATE_URL, timeout=20)
    der_resp.raise_for_status()
    intermediate_pem = ssl.DER_cert_to_PEM_cert(der_resp.content)
    base_bundle = Path(certifi.where()).read_text(encoding="utf-8")
    _CA_BUNDLE_PATH.write_text(base_bundle + "\n" + intermediate_pem, encoding="utf-8")
    return str(_CA_BUNDLE_PATH)

# QPPL-relevant type categories only (mirrors server/src/utils/tier-definitions.ts's
# tiers 1-9, minus tier 4 which crawl/ deliberately excludes) -- excludes the ~35
# administrative/noise type slugs also present on congbao (giay-moi, phieu-gui,
# bao-cao, ...) that don't belong in a legal-text corpus.
TYPE_SLUGS = [
    "hien-phap-l26",  # Hien phap
    "luat-l13",  # Luat (QH)
    "nghi-quyet-l6",  # Nghi quyet (QH or CP -- congbao doesn't split by issuer)
    "phap-lenh-l14",  # Phap lenh (UBTVQH)
    "nghi-quyet-lien-tich-l28",  # Nghi quyet lien tich
    "nghi-dinh-l1",  # Nghi dinh (CP)
    "quyet-dinh-l2",  # Quyet dinh (TTg and others)
    "thong-tu-l3",  # Thong tu (bo nganh)
    "thong-tu-lien-tich-l5",  # Thong tu lien tich
    "van-ban-hop-nhat-l7",  # Van ban hop nhat (consolidated text)
]

REQUEST_DELAY_SEC = 0.25  # be a polite citizen; site showed no rate-limiting in recon but no need to hammer it
_TOTAL_PAGE_RE = re.compile(r"totalPageSodo\s*=\s*(\d+)")
_DATE_RE = re.compile(r"\[Ban hành:\s*(\d{2})/(\d{2})/(\d{4})\]")
_CITATION_RE = re.compile(r"Ký hiệu:\s*(.+)", re.UNICODE)


def _get(url: str) -> requests.Response:
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    time.sleep(REQUEST_DELAY_SEC)
    return resp


def type_listing_url(type_slug: str, page: int) -> str:
    if page == 1:
        return f"{BASE}/van-ban-dang-cong-bao/{type_slug}.htm"
    return f"{BASE}/van-ban-dang-cong-bao/{type_slug}/trang-{page}.htm"


def get_total_pages(type_slug: str) -> int:
    html = _get(type_listing_url(type_slug, 1)).text
    m = _TOTAL_PAGE_RE.search(html)
    return int(m.group(1)) if m else 1


@dataclass
class ListingItem:
    citation: str
    title: str
    detail_url: str
    issued_date: Optional[date]
    pdf_url: Optional[str]
    pdf_filename: Optional[str]


def _parse_item(block) -> Optional[ListingItem]:
    text = block.get_text("\n", strip=True)
    cm = _CITATION_RE.search(text)
    if not cm:
        return None
    citation = unescape(cm.group(1).strip())

    dm = _DATE_RE.search(text)
    issued = None
    if dm:
        day, month, year = (int(x) for x in dm.groups())
        try:
            issued = date(year, month, day)
        except ValueError:
            issued = None

    sapo = block.select_one("a.sapo")
    detail_url = urljoin(BASE, sapo["href"]) if sapo and sapo.get("href") else ""
    title = unescape(sapo.get("title", sapo.get_text(strip=True))) if sapo else ""

    pdf_url = pdf_filename = None
    for a in block.select("div.lstdowload a[href]"):
        href = a.get("href", "")
        data_file = a.get("data-file", "")
        if href.lower().endswith(".pdf") or data_file.lower().endswith(".pdf"):
            pdf_url = unescape(href)
            pdf_filename = unescape(data_file) or None
            break

    if not detail_url:
        return None
    return ListingItem(citation, title, detail_url, issued, pdf_url, pdf_filename)


def parse_listing_page(html: str) -> list[ListingItem]:
    # congbao has two distinct listing templates that share the same inner item
    # markup (Ky hieu span, .lstdowload, a.sapo, [Ban hanh: ...]): org-category /
    # AJAX-search-result pages use div.item-newspaper, type-category ("So do van
    # ban") pages use div.item--vb. Match both so this parser works on either.
    soup = BeautifulSoup(html, "lxml")
    blocks = soup.select("div.item-newspaper") or soup.select("div.item--vb")
    items = []
    for block in blocks:
        item = _parse_item(block)
        if item:
            items.append(item)
    return items


def page_first_date(type_slug: str, page: int) -> Optional[date]:
    html = _get(type_listing_url(type_slug, page)).text
    items = parse_listing_page(html)
    return items[0].issued_date if items else None


def binary_search_page(type_slug: str, total_pages: int, target: date, max_probes: int = 12) -> tuple[int, list[ListingItem]]:
    """Return (landed_page, items_on_that_page). Pages are newest(1) -> oldest(total_pages)."""
    lo, hi = 1, total_pages
    last_page, last_items = 1, []
    probes = 0
    while lo <= hi and probes < max_probes:
        mid = (lo + hi) // 2
        html = _get(type_listing_url(type_slug, mid)).text
        items = parse_listing_page(html)
        probes += 1
        if not items:
            # empty page (shouldn't normally happen within [1,total_pages]) -- narrow conservatively
            hi = mid - 1
            continue
        last_page, last_items = mid, items
        page_date = items[0].issued_date
        if page_date is None:
            hi = mid - 1
            continue
        if page_date > target:
            lo = mid + 1
        elif page_date < target:
            hi = mid - 1
        else:
            return mid, items
    return last_page, last_items


def random_target_date(start: date, end: date) -> date:
    span = (end - start).days
    return start + timedelta(days=random.randint(0, span))


def download_pdf(url: str, dest_path) -> int:
    verify = ensure_ca_bundle() if url.startswith("https://g7.cdnchinhphu.vn") else True
    resp = requests.get(url, headers=HEADERS, timeout=60, verify=verify)
    resp.raise_for_status()
    content = resp.content
    if not content.startswith(b"%PDF"):
        raise ValueError(f"downloaded content is not a PDF (starts with {content[:16]!r})")
    dest_path.write_bytes(content)
    time.sleep(REQUEST_DELAY_SEC)
    return len(content)
