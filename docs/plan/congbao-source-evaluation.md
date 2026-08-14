# congbao.chinhphu.vn as a third source — reconnaissance

**Status: reconnaissance only, no implementation decision made.** This documents live findings from probing congbao.chinhphu.vn to evaluate it as a potential third source alongside `crawl/`'s vbpl.vn (primary) and vanban.chinhphu.vn (supplementary, see that module's own docs). Nothing in this repo has been built against this yet — no client, no parser, no module. Written down so the next person (or session) doesn't have to re-derive it.

First pass was curl-only (no browser); a second pass used a real browser (Playwright) plus the site's own minified JS bundle to resolve every "open question" the first pass left, most importantly the relations graph and the scanned-vs-digital question for pre-DOCX PDFs. Both passes' findings are merged below.

## Context

thuvienphapluat.vn was considered and ruled out — it's a private commercial legal-database company (not a government portal like vbpl.vn/vanban.chinhphu.vn), and it's gated behind Cloudflare bot detection + rate-limiting specifically to protect that commercial dataset. Circumventing that is out of scope for this project regardless of end use.

congbao.chinhphu.vn ("Công báo điện tử Nước CHXHCN Việt Nam") is the **official Gazette** — the canonical publication venue for Vietnamese legal documents, operated by the Government Office. Unlike thuvienphapluat.vn, its entire purpose is public dissemination of legal text, same category as vbpl.vn/vanban.chinhphu.vn. The motivating question was whether it could give better full-text quality than either existing source — see "Full-text extraction" below for why the answer is "sometimes."

## Site architecture

- **Not behind Cloudflare.** Main site serves via `openresty`; the file-download API (`g7.cdnchinhphu.vn`) serves via `Kestrel` (.NET). No CF-Ray headers, no JS challenge, no CAPTCHA encountered anywhere during this reconnaissance.
- **`robots.txt` is wide open**: `User-agent: *` / `Allow: /`.
- **No `sitemap.xml`** — requesting it 302-redirects to `/`.
- Every request made during this reconnaissance (home page, category listings, deep pagination, document detail pages, file downloads) resolved in 0.06s–0.4s via plain `curl` with no special headers beyond a User-Agent. No rate-limiting encountered — combined across both recon passes, on the order of ~60–70 requests were made (curl + Playwright), still not a real throughput test.
- **Two internal AJAX endpoints back the interactive search/filter UI** (found in `static.mediacdn.vn/CongBao/min/main-*.min.js`, confirmed live): `/api-searchvanban/c{orgId}/l{typeId}/d{?}/h{?}/{fromYear}-{toYear}/s{pageSize}/trang-{page}.htm` (document search — `c`=issuing-body id, `l`=document-type id, confirmed both independently filter correctly, e.g. `c26`=BỘ CÔNG AN; `d`/`h` exist in the URL but their effect wasn't conclusively determined — toggling `h0`..`h3` on a sample query produced no visible difference) and `/api-searchcongbao/{YYYY-MM}/e{topExcludeId}/trang-{page}.htm` (Gazette-issue-by-month search — `e` must match the page's own `data-topexcludeid` attribute, e.g. `e6` on `/cong-bao.htm`, or the endpoint silently returns an empty fragment). Both return raw HTML fragments (not JSON), work over plain GET, and need no special headers. **Neither is actually necessary** — see "Discovery sidesteps the search entirely" below, the plain category-listing pages already found are simpler and need no reverse-engineered params. Documented here only because they're a useful secondary/cross-check path (e.g. `api-searchcongbao` was how the archive-start-date boundary below was bisected).

## URL formats

**Document detail**: `/van-ban/{citation-slug}-{numeric-id}.htm`
Examples confirmed live: `/van-ban/luat-so-01-2026-qh16-469528.htm`, `/van-ban/nghi-dinh-so-108-2011-nd-cp-238.htm`. The trailing numeric id is congbao's own internal database id — **not derivable from the citation alone**, so a document's URL can only be discovered via the category-listing pages below, never constructed directly from a known citation.

There is also a **second, two-id URL form** for the same document: `/van-ban/{citation-slug}-{docId}/{issueInstanceId}.htm`, e.g. `/van-ban/nghi-dinh-so-302-2026-nd-cp-470222/67590.htm` alongside the canonical single-id `/van-ban/nghi-dinh-so-302-2026-nd-cp-470222.htm`. The single-id URL's own "Nằm trong các Công báo" (appears in these Gazette issues) box links to this two-id form — one per Gazette issue the document was published/reprinted in (a document that spans multiple issues, e.g. a long Nghị định split across "157+158" and "159+160", gets one instance id per issue). Both forms render the same document; **canonicalize on the single, first (document-level) id** when persisting, not the per-issue instance id.

**Category listing (discovery)**: `/van-ban-dang-cong-bao/{category-slug}.htm` (page 1), `/van-ban-dang-cong-bao/{category-slug}/trang-{N}.htm` (page N). Two independent category families, both enumerated on the home page's nav:

- **By document type** — slug suffix `l{id}` ("loại"): `luat-l13` (Luật), `nghi-dinh-l1` (Nghị định), `quyet-dinh-l2` (Quyết định), `thong-tu-l3` (Thông tư), `nghi-quyet-l6`, `phap-lenh-l14`, `hien-phap-l26`, `lenh-l12`, plus many non-legal administrative types (`cong-van-l9`, `giay-moi-l49`, `bao-cao-l34`, …) that would need filtering out for a legal corpus, mirroring how `law-tier-classifier.ts` already scopes to relevant types.
- **By issuing body** — slug suffix `c{id}` ("cơ quan"): `chinh-phu-c1`, `quoc-hoi-c31`, `bo-tu-phap-c15`, `thu-tuong-chinh-phu-c2`, `chu-tich-nuoc-c12`, etc.
- Since every document has exactly one type, walking type categories alone is sufficient for full coverage — issuing-body categories are redundant for discovery purposes (useful only as a cross-check or an alternative filter).
- Total page count is exposed as a plain JS variable on page 1 (`totalPageSodo`) — fully predictable pagination, no probing needed. Confirmed live: `luat-l13` → 34 pages (~14 items/page, ~470 Luật); `nghi-dinh-l1` → 265 pages (~3,700+ Nghị định). Pagination itself is JS-*rendered* (`renderBasePagination` builds the page-link markup client-side from `data-pagging="/van-ban-dang-cong-bao/luat-l13/trang-{0}.htm"` + `totalPageSodo`), but the underlying `trang-{N}.htm` URLs work via plain GET regardless — confirmed by fetching `trang-2.htm` and `trang-265.htm` directly with curl, no JS execution involved.

**Issue archive** (secondary path, not explored beyond confirming the URL shape): `/cong-bao/{issue-slug}-{id}.htm`, e.g. `/cong-bao/cong-bao-so-469-ngay-13-08-2026-47401.htm`. Each numbered, dated Gazette issue presumably lists every document published that day — a chronological alternative to the type-category browse, untested for how far back it goes or whether it's more complete.

## Discovery sidesteps the search entirely

The category-listing system above is a completely separate code path from whatever backs congbao's citation-search feature (the one reported as "horrendously slow") — confirmed by both shallow (page 2) and deep (page 265 of 265) pagination requests responding just as fast as page 1. A scraper never needs to touch the search UI: walk every document-type category once to build a local citation→URL index (matching this project's existing "Postgres as source of truth" posture), then all future citation lookups are local queries. Periodic re-crawls only need each category's first page or two to catch newly-published documents.

## Full-text extraction

**The document body is not server-rendered text.** `div.content--main` contains `<div id="pdf-wrapper" class="pdf-wrapper isconvert"><div id="pdf-container">` populated client-side by `pdf.min.js` (Mozilla PDF.js, loaded from `static.mediacdn.vn/CongBao/js/pdf.min.js`) rendering the source PDF directly. There is no pre-extracted text anywhere in the raw HTML — same fundamental shape as vanban.chinhphu.vn (PDF-based), not vbpl.vn (server-rendered HTML text).

**But documents also expose a direct Word-family download**, alongside the signed PDF, as a plain `<a href>`/`data-file` attribute in the raw HTML (no JS needed to find it, confirmed present in the server-rendered response fetched via plain `curl` — not JS-injected):

- Signed PDF: `https://congbaocdn.chinhphu.vn/{path}/{id}-{hash}_v1_{hash2}_signed.pdf` (recent docs) or a stable, non-tokenized `https://congbaocdn.chinhphu.vn/CongBaoCP/CongBao/{year}/{month}/{issueId}/{fileId}-{n}-{issueNumbers}.pdf` (archive docs, e.g. 2020) — both ultimately proxied through the same tokenized gateway when linked from a document page: `https://g7.cdnchinhphu.vn/api/download/stream?Url={opaque-token}&file_name={path}.pdf`.
- Word-family (when present): same gateway, `&file_name={path}.docx` (current) or `&file_name={path}.doc` (legacy binary Word, older archive years — see cutoff below). **Both `.doc` and `.docx` need to be handled**, not just `.docx`.
- The `Url={opaque-token}` value is a short-lived signed token generated per page-render — **it cannot be guessed or cached from a citation alone**; each document/listing page must be re-fetched to get a fresh token before downloading.

Verified live on Luật số 01/2026/QH16 ("Tiếp cận thông tin") and Nghị định 302/2026/NĐ-CP: the DOCX link resolves to a real, valid `application/vnd.openxmlformats-officedocument.wordprocessingml.document` file (fetched, unzipped, `word/document.xml` present and parseable). Extracted text is clean, structured Chương/Điều/Khoản/Điểm prose matching `document-node.parser.ts`'s expected shape almost exactly, no OCR artifacts — it's the literal authoring Word document, not a scan. This needs **zero VLM/OCR** to extract, just OOXML parsing (e.g. `mammoth` in Node) — a meaningfully cheaper and more reliable path than the docling/VLM pipeline vanban.chinhphu.vn's `DOCUMENT_TEXT_EXTRACTOR` is waiting on (see `server/src/crawl/document-text-extractor.ts`).

**DOCX/DOC-coverage cutoff — now bisected, not just two data points.** Sampled one document per Gazette issue across 2010, 2014, 2016, 2017, 2018, 2019, 2020, 2026 (issue → document → checked its own top-level download links, not the unrelated "related documents" sidebar, which surfaces recent docs regardless of which document page you're on and will give a false positive if not excluded):

| Sample doc | Gazette issue date | PDF | DOC/DOCX |
| --- | --- | --- | --- |
| Thông tư 200/2010/TT-BTC | 30/12/2010 | ✓ | ✗ |
| Nghị định 58/2014/NĐ-CP | 30/06/2014 | ✓ | ✗ |
| Thông tư 59/2015/TT-BLĐTBXH | 31/01/2016 | ✓ | ✗ |
| Nghị định 75/2017/NĐ-CP | 30/06/2017 | ✓ | ✓ (`.doc`) |
| Nghị định 155/2017/NĐ-CP | 31/01/2018 | ✓ | ✓ (`.doc`) |
| Thông tư 14/2017/TT-BKHCN | 30/06/2018 | ✓ | ✓ (`.doc`) |
| Thông tư 22/2018/TT-BLĐTBXH | 31/01/2019 | ✓ | ✓ (`.doc`) |
| Thông tư 25/2019/TT-BTNMT | 31/01/2020 | ✓ | ✓ (`.doc`) |
| Nghị định 302/2026/NĐ-CP | 01/08/2026 | ✓ | ✓ (`.docx`) |

**The rollout happened between January 2016 and June 2017.** Before that window: PDF-only. After it: PDF + Word-family, `.doc` (legacy binary) through at least early 2020, transitioning to `.docx` (OOXML) by 2026 — the exact `.doc`→`.docx` switchover point wasn't bisected further since either is a solved extraction problem (`mammoth` handles `.docx`; a `.doc`-capable library or LibreOffice headless conversion handles the rest), unlike the PDF-only tail.

**The PDF-only tail (2010–~2016) is still not a scan — it's a genuine digital-text PDF, no OCR needed.** This is the one place the first pass's assumption ("Older documents without a DOCX would need the same OCR/docling pipeline as vanban.chinhphu.vn") turned out to be wrong. Downloaded the Nghị định 58/2014/NĐ-CP PDF directly (402KB, 10 pages) and inspected its raw object structure: 86 `/Font` references vs. only 2 `/Subtype/Image` objects across the whole 10-page document, `FlateDecode`-compressed content streams, zero `DCTDecode`/`CCITTFaxDecode` (the codecs a scanned-and-rasterized page would use). A genuine scan would show ~1 image object per page and few-to-no fonts; this shows the opposite. **Practical implication: the entire archive back to ~Dec 2010 is extractable via plain PDF text extraction (e.g. `pdf-parse`/`pdfjs-dist` server-side, the same library already vendored client-side as `pdf.min.js`) with no VLM/OCR step at all** — DOCX/DOC when available is still the cleaner, structurally-labeled path (matches `document-node.parser.ts`'s Chương/Điều/Khoản/Điểm expectations directly), but its absence pre-2017 is not the hard OCR blocker it looked like on the first pass.

## Relations — resolved: real and populated, not vestigial

The document detail page's "Lược đồ" tab opens a modal (`.popup__detail--luocdo`, confirmed via a real browser — this is not present in the raw HTML `curl` sees, so the first pass's "empty/hidden, likely AJAX-populated" guess was on the right track) listing **11 relation categories** (a coarser taxonomy than vbpl.vn's 13 concepts × inbound/outbound = 26, but overlapping in kind): Văn bản căn cứ / Văn bản căn cứ văn bản này, Văn bản sửa đổi bổ sung-đính chính / bị sửa đổi bổ sung-được đính chính, Văn bản thay thế/bãi bỏ/hủy bỏ/đình chỉ (and its "một phần" partial variant) in both directions, Văn bản dẫn chiếu, Văn bản hướng dẫn / được hướng dẫn.

Confirmed **populated with real, clickable, resolving links** — not just counts — on Nghị định 58/2014/NĐ-CP (Bộ Nội vụ's function/structure decree): `Văn bản bị thay thế/bãi bỏ/hủy bỏ/đình chỉ [1]` → links to Nghị định 34/2017/NĐ-CP, the actual later decree that reorganized Bộ Nội vụ; `Văn bản căn cứ [1]` → links to a legal-basis document. This is a genuine relationship graph, not the permanent gap vanban.chinhphu.vn has.

**Caveat: coverage on very recent documents is thin or lagging.** Nghị định 302/2026/NĐ-CP, issued the same day as this check (01/08/2026), showed `[0]` on all 11 categories — including "Văn bản căn cứ", which would be expected to be non-zero for a Nghị định implementing a Luật. Unknown whether this is a linkage-latency issue (relations populate some time after initial publication) or genuinely sparse coverage for certain document/category combinations. Not enough samples yet to characterize how reliable this is at the time a document first appears vs. months/years later.

## Validity-status field — resolved: no explicit field, but derivable

The "Thuộc tính" (attributes) tab/modal exposes: Loại văn bản, Số ký hiệu, Cơ quan ban hành, Ngày ban hành, Trích yếu, Người ký, Ngày hiệu lực, Công báo (issue number). **No `Tình trạng hiệu lực` (còn hiệu lực / hết hiệu lực / hết hiệu lực một phần) field like vbpl.vn's** — this remains a real gap versus vbpl.vn as a primary source. It's partially derivable, though: a non-zero "Văn bản bị thay thế/bãi bỏ/hủy bỏ/đình chỉ" count in the Lược đồ panel (above) is a signal the document is no longer (fully) in force — but that's an inference from relation counts, not a first-class status field, and inherits the same recency-lag caveat.

## How this compares to the two existing sources

| | vbpl.vn (primary) | vanban.chinhphu.vn (supplementary) | congbao.chinhphu.vn |
| --- | --- | --- | --- |
| Full text | Server-rendered HTML | None (PDF/DOC/RTF attachments only, `indexScope: metadata_only`) | PDF (real text layer, whole archive) + DOCX/DOC (≈2017–now) |
| OCR/VLM needed? | No | Yes, not yet built | **No, for either era** |
| Relationship graph | Yes, 13×2 concepts, primary source of `document_reference` | **None, ever, by design** | Yes, 11 categories, populated but recency may lag |
| Validity status | Explicit `Tình trạng hiệu lực` field | None | None (derivable from relation counts only) |
| Archive depth | Back to pre-1976 for some tiers | Unscoped by date | **~Dec 2010 onward only** |
| Access | Playwright (Next.js SPA) | Plain HTTP (cheerio) | **Plain HTTP, no browser needed at all** |
| Search | AJAX filters + mojibake bug on diacritics | Own search form | Plain paginated category-listing GETs; search UI exists but is never needed |

**Bottom line for the two questions this doc exists to answer:** congbao cannot replace vbpl.vn as primary — the archive-depth gap (~15 years vs. pre-1976) and the missing validity-status field are both structural, not scraping problems. But as a *third* source, or as a straight upgrade over vanban.chinhphu.vn's supplementary role, it looks strong: it closes both of vanban.chinhphu.vn's permanent, explicitly-documented gaps (`server/src/crawl/` Architecture notes: zero `document_reference` rows ever, and `indexScope: metadata_only` pending a not-yet-built OCR/VLM tool) — congbao offers real relations (with the recency caveat above) and needs no OCR/VLM at all, for the entire archive. No implementation decision is made here; that's a separate call for whoever picks this up next.

## Decision: source hierarchy is vbpl.vn → congbao.chinhphu.vn → vanban.chinhphu.vn

congbao is promoted above vanban.chinhphu.vn as the first fallback when vbpl.vn's search returns nothing (`FallbackSearchService`), with vanban.chinhphu.vn kept as the second, last-resort fallback rather than removed. Reasoning: congbao gives strictly better extraction (no OCR, ever) and a real relations graph, so it should be tried first — but its ~Dec-2010 archive start (bisected above) is a hard wall vanban.chinhphu.vn doesn't share. vanban.chinhphu.vn's own corpus reaches much further back — it's what the `law-index` backfill used to recover dozens of pre-1976 "Không số"-citation documents (`docs/monitoring/law-index-flagged-documents.md` §9) — so anything vbpl.vn misses that predates congbao's archive still needs vanban.chinhphu.vn as the last resort. Net effect: three-tier fallback, not a swap.

## Extraction method per source, now that congbao is in the mix

vbpl.vn: full text parsed straight from its server-rendered page. vanban.chinhphu.vn: download + docling (OCR/VLM), because it offers no server-rendered text and no text-layer PDF, only attachments. **congbao needs neither approach** — confirmed by actually extracting text, not just inspecting PDF object structure:

- `pdftotext -enc UTF-8` (poppler) on the 2014 sample gave clean, fully-formed Vietnamese sentences for the substantive body text — but **garbled stylized header lines**: `"THỦ TƯ_Ớ__N_G__C__H_Í_NH PHỦ"` and `"Đ__ộ_c_l_ậ_p_-_T__ự_d__o_-_H__ạ_n_h_p__h_ú_c"` on the 2010 sample. This isn't a font-encoding/Unicode problem (the body text right below it extracts perfectly) — it's poppler's layout-reconstruction heuristic misreading a letter-spaced/underlined title line as individual positioned glyphs.
- The same PDF run through **`pdf-parse` (which wraps `pdfjs-dist` — the exact library `pdf.min.js` already ships client-side on congbao itself)** extracted those same header lines cleanly: `"THỦ TƯỚNG CHÍNH PHỦ"` and `"CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM / Độc lập - Tự do - Hạnh phúc"`, with the underline decoration correctly separated out as its own `__________` run instead of interleaving into the letters.

**Recommendation: `pdf-parse`/`pdfjs-dist` for the PDF-only tail (~2010–2016), not poppler** — a lightweight extractor is sufficient as the user's question assumed, but the specific tool matters; pick the pdf.js-based one, which also avoids adding a native poppler binary dependency to a Node/TypeScript codebase. For ~2017-onward documents, don't even reach for a PDF tool — parse the DOCX (`mammoth`) or DOC directly; that's cleaner than any PDF text reconstruction, matching `document-node.parser.ts`'s Chương/Điều/Khoản/Điểm structure more directly than reconstructed PDF line breaks would. Bonus: every sampled PDF's first line is machine-readable digital-signature metadata (`"Ký bởi: ... Cơ quan: Văn phòng Chính phủ Thời gian ký: ..."`) — free signer/sign-timestamp extraction with no extra parsing step, comparable to the signer metadata `crawl/`'s chinhphu extractor already pulls from vanban.chinhphu.vn by other means.

## Cross-source dedup keys, with congbao added

Existing scheme (vbpl.vn ↔ vanban.chinhphu.vn): citation number, issuing year, issuing body. **congbao slots into the same three-key scheme without forcing a change** — all three are present and, in samples checked this pass, clean:

- **Citation** (`Ký hiệu`, e.g. `302/2026/NĐ-CP`, `93/QĐ-BCĐPTCNBD`): present on every document, server-rendered as proper UTF-8 HTML entities in raw `curl` output — no sign of the mojibake bug confirmed on vbpl.vn's own search endpoint (`VbplClientService.searchDocuments`, CLAUDE.md). This is the strongest key of the three, and per Luật Ban hành văn bản QPPL it's the legally-mandated unique identifier — but **not every citation embeds a year** (`93/QĐ-BCĐPTCNBD` has no `/YYYY/` segment, common for ad-hoc-body Quyết định where numbering resets per body rather than per year), so citation alone can't always be parsed for year — don't rely on regex-extracting the year from the citation string itself.
- **Issuing year**: not a dropdown/enum field on congbao — derive it from `Ngày ban hành` (full issue date, present on every document via the "Thuộc tính" panel), the same way it'd need to be derived for any citation lacking an embedded year. Always available, just requires taking the date field's year rather than assuming it's in the citation.
- **Issuing body** (`Cơ quan ban hành`): present both as the org-category filter (congbao's own internal `c{id}` numbering, e.g. `c26` = BỘ CÔNG AN) and as a plain string in "Thuộc tính". congbao's `c{id}` values are its own scheme, uncorrelated with vbpl.vn's or vanban.chinhphu.vn's internal org ids — **match on the uppercase Vietnamese name string, not on any source's numeric id**, consistent with how vbpl.vn↔vanban.chinhphu.vn matching already has to work (`ChinhPhuSearchService.resolveOrgId`'s note about one body listed under two different ids elsewhere). Name-string equality wasn't cross-checked against vbpl.vn's/vanban.chinhphu.vn's exact org-name strings this pass — worth a spot-check before relying on exact-match rather than fuzzy-match.
- The "Không số" (no-citation-number) collision problem that motivated the `sourceUrl`-not-citation dedup rule for vbpl.vn/vanban.chinhphu.vn backfills is a **pre-1976 problem, and congbao's archive doesn't reach before ~Dec 2010** — so this specific known failure mode shouldn't recur when matching against congbao. Still match on the same three-key tuple for consistency with the existing scheme, not because congbao is expected to need it.

## Citation → document URL lookup, without the search bar

Neither congbao's own search bar nor the two AJAX endpoints support a citation/text-query parameter at all — they're both pure category browsers. Worse, **`/api-searchvanban/`'s `l` (type) and date-range params turned out to be non-functional, not just `d`/`h`** — confirmed by requesting `c1/l1` (CHÍNH PHỦ + Nghị định) and `c1/l2` (CHÍNH PHỦ + Quyết định) back to back: identical results, all Nghị định, both times. Only `c` (issuing body) actually filters on that endpoint. This corrects the earlier assumption in this doc that `l` was reliable there — it isn't; type-based filtering only works via the plain category-listing pages below, not the AJAX endpoint.

**The plain type-category listing pages *do* filter correctly by type, and are sorted strictly newest→oldest by `Ngày ban hành`** — confirmed navigable this way: `/van-ban-dang-cong-bao/{type-slug}-l{id}.htm` (page 1) / `.../trang-{N}.htm` (page N), with the type→`l{id}` slug entirely enumerable from the plain homepage HTML (no JS, no guessing):

```text
nghi-dinh-l1, quyet-dinh-l2, thong-tu-l3, chi-thi-l4, thong-tu-lien-tich-l5,
nghi-quyet-l6, van-ban-hop-nhat-l7, thong-bao-l8, cong-van-l9, sao-luc-l11,
lenh-l12, luat-l13, phap-lenh-l14, ke-hoach-l15, cong-dien-l20, huong-dan-l21,
dinh-chinh-l18, hien-phap-l26, nghi-quyet-lien-tich-l28, quy-che-l36,
quy-dinh-l37, thong-cao-l38, chuong-trinh-l39, phuong-an-l40, de-an-l41,
du-an-l42, bien-ban-l43, to-trinh-l44, hop-dong-l45, ban-ghi-nho-l46,
ban-thoa-thuan-l47, giay-uy-quyen-l48, giay-moi-l49, giay-gioi-thieu-l50,
giay-nghi-phep-l51, phieu-gui-l52, phieu-chuyen-l53, phieu-bao-l54,
thu-cong-l55, ket-luan-l64, sao-y-l65, sac-lenh-l66, sat-luat-l67,
thong-tu-lien-bo-l68, cong-van-dieu-hanh-l69, chua-duoc-phan-loai-l70,
dieu-hanh-l71, ke-hoach-tham-dinh-l72
```

(matches the noise-filtering concern already flagged in "Open questions" below — only a subset of these, roughly matching `law-tier-classifier.ts`'s existing tier scope, are relevant to the legal corpus).

**Since neither axis exposes a working date filter, use binary search over the sorted pages instead — validated end to end:**

1. Parse the citation for its type abbreviation (`NĐ-CP` → Nghị định → `l1`) and, if embedded, its year (most citations have it; ad-hoc-numbered ones like `93/QĐ-BCĐPTCNBD` don't — see the dedup-keys section above).
2. `GET /van-ban-dang-cong-bao/{type-slug}-l{id}.htm` for `totalPageSodo` (page-count upper bound) and page 1's date (upper bound of the date range).
3. Binary search on the visible `[Ban hành: DD/MM/YYYY]` of each candidate page's first item against the target date (or just target year, coarser but still narrows fast) — `O(log N)` requests.
4. Once converged, linear-scan the citation string (`Ký hiệu: {number}/{year}/{TYPE}`) across a small window (±2 pages, since same-day publication volume can spill across a page boundary) to find the exact match, then read its `data-url="https://congbao.chinhphu.vn/van-ban/...htm"` attribute right next to it.

**Live-tested this exact procedure** looking up Nghị định 58/2014/NĐ-CP (issued 16/06/2014) inside `nghi-dinh-l1`'s 265 pages: converged to page 211 in 8 requests (`133→199→232→215→207→211→213→212`), found the citation on page 211, resolved to `https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-58-2014-nd-cp-5062.htm` on the 9th. **9 plain HTTP GETs, no browser, to resolve a 12-year-old citation** — versus the horrendously slow UI search, and versus a worst-case 265-page linear walk.

**Fallback for citations without an embedded year** (ad-hoc-numbered types, e.g. some Quyết định): binary search doesn't apply without a date to search on. Two options, neither validated yet: (a) if the issuing body is known, use `/van-ban-dang-cong-bao/{org-slug}-c{id}.htm` instead of the type category — smaller category, same binary-search approach if that listing is also date-sorted (not confirmed, but likely, since the AJAX `c`-filtered results looked date-ordered too); (b) accept a bounded linear walk, since ad-hoc-numbered categories tend to be low-volume compared to `nghi-dinh-l1`'s ~3,700.

## Open questions (not yet investigated)

- **Relation-graph latency/coverage.** How long after publication do relations populate, and is `[0]` ever a genuine "no relations" answer vs. "not linked yet"? Needs a time-series sample (same document checked at multiple ages) rather than more one-off snapshots.
- **`d`/`h` params on `/api-searchvanban/`.** Not conclusively identified (see "Site architecture" above) — moot for scraping (the plain category pages don't need them) but would matter if someone later wants server-side date/status filtering instead of filtering client-side after a full category walk.
- **ToS.** robots.txt is open and this is an official government Gazette (not reviewed for an explicit terms-of-use page beyond that).
- **Rate-limiting under real load.** ~60–70 exploratory requests across two passes, still not a throughput test; a real crawl (hundreds/thousands of category pages + document pages) has not been tested and could behave differently.
- **Non-Trung-ương / non-QPPL noise in type categories.** First pass already flagged this (`cong-van-l9`, `giay-moi-l49`, `bao-cao-l34`, etc. would need filtering, mirroring `law-tier-classifier.ts`'s existing scoping) — not re-examined this pass.
