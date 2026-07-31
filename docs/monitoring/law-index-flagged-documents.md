# law-index: flagged documents log

**Status: manually maintained.** Nothing in `server/src/law-index/` writes to this file automatically — there is no automated flagging/logging mechanism in the codebase yet (see "Not yet automated" below). This is a running log of specific documents found to have scraping or `document_node` indexing problems during manual verification passes, kept so findings don't only live in chat history. Append to it (don't overwrite) whenever a future verification pass finds something new.

**Columns:**
- **Citation** — `document.citation_id`
- **Title** — `document.title`
- **Enacted** — `document.enacted_date`
- **Status** — `document.status` (validity) at time of flagging
- **Issue** — what's wrong
- **Resolution** — `Resolved` (with the fix and commit/change that landed it) or `Unresolved` (with what's needed)

---

## Resolved

### 1. Annex content swallowed — footer-drop logic didn't recognize non-"Phụ lục" annex labels

Found during the first 50-document `document_node` reindex (2026-07-30). An attached annex (a QCVN technical standard, a "Biểu số" report form) placed after the document's signature block was being silently dropped in full, because the footer-stripping logic only knew how to resume structured parsing on the literal word "Phụ lục".

**Fix:** generalized the footer-escape trigger (`ANNEX_RESTART_PATTERN` in `document-node.parser.ts`) to also recognize a re-stated Quốc hiệu header ("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM") or a standalone "Biểu số/Mẫu số/QCVN/TCVN `<code>`" title line. Regression tests added; both documents' `document_node` trees rebuilt from stored `fullText`.

| Citation | Title | Enacted | Status | Issue | Resolution |
|---|---|---|---|---|---|
| 46/2026/TT-BXD | Thông tư số 46/2026/TT-BXD Ban hành QCVN 01:2026/BXD Quy chuẩn kỹ thuật quốc gia về quy hoạch đô thị và nông thôn | 2026-06-30 | chua_co_hieu_luc | QCVN annex (~145KB) captured 0% — entirely dropped | Resolved — annex now captured at 96% |
| 102/2026/TT-BTC | Thông tư số 102/2026/TT-BTC Hướng dẫn một số nội dung về giám sát, kiểm tra, đánh giá, xếp loại, báo cáo và công khai thông tin trong quản lý và đầu tư vốn nhà nước tại doanh nghiệp | 2026-07-17 | con_hieu_luc | "Biểu số" report-form annexes captured 32% | Resolved — now captured at 75% |

### 2. Điều header missing punctuation — period-only regex matched nothing

Found while backfilling `document_node` for all Luật/Bộ luật documents (2026-07-31). Older "Luật sửa đổi, bổ sung" amendment laws (spanning 1962–2019 in this batch) write their Điều header without a period: bare `"Điều 1"` (heading on the next line), `"Điều 1: <heading>"` (colon), or `"Điều 1 <heading>"` (no punctuation at all). The parser's `DIEU_KHOAN_PATTERN` required a literal period, so these 17 documents produced zero `document_node` rows despite having real, parseable structure.

**Fix:** made the separator after the Điều number optional (`[.:]?` instead of a mandatory `.`) in `DIEU_KHOAN_PATTERN`. Regression tests added for all three punctuation variants; all 17 documents' trees rebuilt from stored `fullText`.

| Citation | Title | Enacted | Status | Resolution |
|---|---|---|---|---|
| 04/1998/QH10 | Luật Sửa đổi, bổ sung một số điều của Luật thuế xuất khẩu, thuế nhập khẩu số 04/1998/QH10 | 1998-05-20 | het_hieu_luc | Resolved — 37 nodes built |
| 06/1998/QH10 | Luật Sửa đổi, bổ sung một số điều của Luật Ngân sách Nhà nước số 06/1998/QH10 | 1998-05-20 | het_hieu_luc | Resolved — 112 nodes built |
| 10/1998/QH10 | Luật Sửa đổi, bổ sung một số điều của Luật Đất đai số 10/1998/QH10 | 1998-12-02 | het_hieu_luc | Resolved — 66 nodes built |
| 20/2000/QH10 | Luật Sửa đổi, bổ sung một số điều của Bộ luật Tố tụng hình sự số 20/2000/QH10 | 2000-06-09 | het_hieu_luc | Resolved — 103 nodes built |
| 26/2004/QH11 | Luật Sửa đổi, bổ sung một số điều của Luật Khiếu nại, tố cáo số 26/2004/QH11 | 2004-06-15 | het_hieu_luc | Resolved — 20 nodes built |
| 31/2013/QH13 | Luật Sửa đổi, bổ sung một số điều của Luật Thuế giá trị gia tăng số 13/2008/QH12 số 31/2013/QH13 | 2013-06-19 | het_hieu_luc | Resolved — 61 nodes built |
| 32/2013/QH13 | Luật Sửa đổi, bổ sung một số điều của Luật Thuế thu nhập doanh nghiệp số 32/2013/QH13 | 2013-06-19 | het_hieu_luc_mot_phan | Resolved — 95 nodes built |
| 36/2013/QH13 | Luật Sửa đổi, bổ sung một số điều của Luật Cư trú số 36/2013/QH13 | 2013-06-20 | con_hieu_luc | Resolved — 23 nodes built |
| 37/2013/QH13 | Luật Sửa đổi, bổ sung Điều 170 của Luật Doanh nghiệp số 37/2013/QH13 | 2013-06-20 | het_hieu_luc | Resolved — 2 nodes built |
| 41-LCT/HĐNN8 | Luật Sửa đổi, bổ sung một số điều của Luật Đầu tư nước ngoài tại Việt Nam số 41-LCT/HĐNN8 | 1990-06-30 | het_hieu_luc | Resolved — 2 nodes built |
| 45/LCT | Luật Sửa đổi và bổ sung Luật Nghĩa vụ quân sự số 45/LCT | 1965-04-10 | het_hieu_luc | Resolved — 5 nodes built |
| 46/2005/QH11 | Luật sửa đổi, bổ sung một số điều của Luật Khoáng sản số 46/2005/QH11 | 2005-06-14 | het_hieu_luc | Resolved — 74 nodes built |
| 50/LCT | Luật Sửa đổi và bổ sung Luật Nghĩa vụ quân sự số 50/LCT | 1962-10-26 | het_hieu_luc | Resolved — 9 nodes built |
| 56/2014/QH13 | Luật Sửa đổi, bổ sung một số điều của Luật Quốc tịch Việt Nam số 56/2014/QH13 | 2014-06-24 | het_hieu_luc_mot_phan | Resolved — 6 nodes built |
| 61/2014/QH13 | Luật Sửa đổi, bổ sung một số điều của Luật Hàng không dân dụng Việt Nam số 61/2014/QH13 | 2014-11-21 | het_hieu_luc_mot_phan | Resolved — 177 nodes built (see known limitation #4 below — this document's tree has a separate, unresolved shape issue) |
| 63/2010/QH12 | Luật Sửa đổi, bổ sung một số điều của Luật Bầu cử đại biểu Quốc hội và Luật Bầu cử đại biểu Hội đồng nhân dân số 63/2010/QH12 | 2010-11-24 | het_hieu_luc | Resolved — 137 nodes built |
| 72/2014/QH13 | Luật Sửa đổi, bổ sung một số điều của Luật Sĩ quan Quân đội nhân dân Việt Nam số 72/2014/QH13 | 2014-11-27 | het_hieu_luc_mot_phan | Resolved — 52 nodes built |

---

## Unresolved

### 3. Attributes-tab content leaked into `fullText` instead of real document body

Found during the same Luật/Bộ luật backfill (2026-07-31). These 6 documents' `document.rawSource.fullText` (305–440 characters) is the *attributes* table ("Số hiệu / Loại văn bản / Ngành / Ngày ban hành / ...") rather than the Nội dung tab's real body text — an upstream scrape-time bug, not a `document_node` parsing gap. There is no real body text stored to parse; `document_node` will stay empty for these until they're re-scraped from vbpl.vn.

**Needed:** re-run `POST /laws/index/crawl/url` against each of these 6 documents' `sourceUrl` (in `document.rawSource.sourceUrl`) and confirm the Nội dung tab actually renders before trusting the re-scrape; if it's a page-render timing issue in `VbplClientService`, that needs its own fix first.

| Citation | Title | Enacted | Status | fullText length |
|---|---|---|---|---|
| 35/2002/QH10 | Luật Sửa đổi, bổ sung một số điều của Bộ luật Lao động số 35/2002/QH10 | 2002-04-02 | het_hieu_luc | 362 |
| 50/2019/QH14 | Luật sửa đổi, bổ sung một số điều của Luật quản lý, sử dụng vũ khí, vật liệu nổ và công cụ hỗ trợ số 50/2019/QH14 | 2019-11-25 | het_hieu_luc | 411 |
| 52/2019/QH14 | Luật sửa đổi, bổ sung một số điều của Luật cán bộ, công chức và Luật viên chức số 52/2019/QH14 | 2019-11-25 | het_hieu_luc | 384 |
| 106/2016/QH13 | Luật Sửa đổi, bổ sung một số điều của Luật Thuế giá trị gia tăng, Luật Thuế tiêu thụ đặc biệt và Luật Quản lý thuế số 106/2016/QH13 | 2016-04-06 | het_hieu_luc | 440 |
| 105/2025/QH15 | Luật Giám định tư pháp số 105/2025/QH15 | 2025-12-05 | con_hieu_luc | 305 |
| 141/2025/QH15 | Luật Sửa đổi, bổ sung một số điều của Luật Quản lý nợ công số 141/2025/QH15 | 2025-12-10 | con_hieu_luc | 418 |

### 4. Quoted multi-item replacement text mis-nested as top-level siblings

Found while investigating item #2 above (2026-07-31) — a parser shape issue, not a per-document data problem, so it isn't a bounded checklist the way #1–3 are. When an amending Điều quotes a foreign document's replacement text that itself spans *multiple* numbered Khoản (e.g. a quoted `"Điều 8. ... 1. ... 2. ... 9. ..."` block), only the quoted block's *first* line carries a leading quote-mark character. That's the only signal the parser currently uses to keep quoted content from being read as real structure (see `document-node.parser.ts`'s handling of lines starting with `“`/`"`) — every subsequent quoted line has no such marker, so a quoted khoản-numbered item can be picked up by `KHOAN_PATTERN` and inserted as a new top-level sibling Khoản of the *amending* Điều, rather than staying nested inside the quoted block it actually belongs to.

**Confirmed example:** `61/2014/QH13`, Điều 1 (quotes a full replacement "Điều 8" from Luật Hàng không dân dụng, itself containing Khoản 1–9).

**Needed:** track quote-open/quote-close state across lines (open on a leading `“`/`"`, close on a trailing `”`/`"`) so everything inside a quoted span is treated as opaque text of the node that opened the quote, regardless of what it looks like structurally. Not attempted yet — likely affects other "Luật sửa đổi, bổ sung" documents beyond the one confirmed case, but the actual scope (how many) hasn't been surveyed.

---

## Not yet automated

Every entry above was found by ad-hoc SQL spot-checks (comparing `document.rawSource.fullText` length against total `document_node.text_content` length, then manually inspecting outliers) run manually after each reindex pass — there is no code in `server/src/law-index/` that detects or records these automatically. If this log is expected to stay current as new documents get synced, that detection needs to become a real step (e.g. a coverage-ratio check the sync flow runs and logs, or a periodic query against the corpus), not a habit of remembering to check by hand.
