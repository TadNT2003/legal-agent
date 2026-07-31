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

### 5. Citation collision — documents can never coexist under a shared/reused vbpl.vn citation

Found while rechecking vbpl.vn for Luật/Bộ luật coverage gaps (2026-08-01). Compared the full Luật (562) + Bộ luật (16) count on vbpl.vn's trung-ương corpus against what's in Postgres and found a 74-document gap (70 Luật + 4 Bộ luật). Diffing by vbpl.vn's internal document id (not by citation string — see the methodology note below) narrowed this to exactly **69 documents that are structurally blocked from ever being stored**, plus 5 that turned out not to be a real gap at all (vbpl.vn serves the same already-indexed law under a second URL — harmless, no action needed).

**Root cause:** `document.citation_id` is `UNIQUE`, and `document.repository.ts`'s `upsertDocument` looks up "is this document already synced?" purely by matching `citation_id`. That's correct when a citation is a real, unique identifier — but vbpl.vn's older corpus (entirely pre-1998 in this batch) has two ways a citation is *not* unique:

- **"Không số" ("no number")** — every pre-Đổi Mới law that predates Vietnam's modern `{số}/{năm}/{loại}-{cơ quan}` citation scheme is recorded on vbpl.vn with the literal citation string "Không số". 67 distinct real laws (1959–1997) share this one string. Only whichever one was synced *last* survives — every earlier sync of a different "Không số" law gets its row silently overwritten (title, dates, `raw_source`, and cascaded `document_node` tree all replaced) by the next one, because `upsertDocument` can't tell them apart. `Luật Cải cách ruộng đất` (1953) occupied the slot at time of discovery.
- **Reused batch instrument numbers** — at least 2 more cases where vbpl.vn assigned the *same* citation to two genuinely different laws passed in the same legislative batch: `270B-NQ/HĐNN8` (held "Luật Thuế Tiêu thụ đặc biệt", 1990; blocked "Luật Thuế Doanh thu") and `3-LCT/HĐNN7` (held "Luật Tổ chức Tòa án nhân dân", 1981; blocked "Luật Tổ chức Viện kiểm sát nhân dân").

**Methodology note:** the crawl-search endpoint's response text is mojibake for any citation/title containing non-ASCII characters (confirmed: real UTF-8 bytes decoded as Windows-1252 somewhere in `VbplClientService.searchDocuments`'s response handling — Playwright's `Response.text()` likely trusted a wrong/missing charset from vbpl.vn's Server Action response). This corrupted an initial citation-string-based diff badly enough to produce ~20 false "missing" entries (documents already correctly stored, just compared against their own mangled citation). Recomputed the diff using the ASCII-only internal id embedded in `sourceUrl` (immune to the encoding bug) instead, which is what the 74/69 figures above are based on. The mojibake itself is a distinct bug worth fixing in `VbplClientService`/`vbpl.parser.ts`'s search-response handling (affects the live `crawl/search` endpoint's output for any caller), but is not itself a reason any document failed to index — flagged here only because it's the reason this investigation needed a second pass.

**Validity status verified for all 69 (2026-08-01)** via vbpl.vn's own `Tình trạng hiệu lực` field, against the assumption that all colliding documents are dead law with no bearing on current legal Q&A — **66 confirmed "Hết hiệu lực toàn bộ" (fully expired)**, including both reused-citation cases, but **3 of the "Không số" group are still "Còn hiệu lực" (currently in force)**: `Luật Bảo vệ sức khỏe nhân dân` (1989, id 25506), `Luật Thuế sử dụng đất nông nghiệp` (1993, id 10803), `Luật Bầu cử Đại biểu Quốc hội` (1997, id 8611). Those 3 were pulled out and fixed individually — see §6 below — since permanently excluding *live* law is a correctness problem, not a scope decision, even though the 66 genuinely-expired ones are.

**Decision (2026-08-01): the remaining 66 confirmed-expired documents are out of scope for this corpus — won't fix.** Rationale: (1) direct precedent — `server/src/law/` already made this exact call for the same "Không số" pattern, for the same reason (see the `d441189` commit message: "ignore those laws completely because they're now irrelevant to the current legal system"); (2) the real fix (loosening/replacing the `citation_id UNIQUE` constraint) has to be re-validated against every citation-keyed lookup in `document.repository.ts` — reference resolution, forward-reference healing, consolidation matching — a disproportionate cost for content with no bearing on "what does current law say," this system's stated purpose; (3) it's a small, now fully-enumerated, and *documented* boundary rather than a silent gap — revisit if the corpus's scope ever grows to include historical/repealed-law research.

| Internal id | Citation | Title | Enacted | Currently occupying that citation |
|---|---|---|---|---|
| 887 | Không số | Luật Hôn nhân và gia đình | 1959-12-29 | Luật Cải cách ruộng đất (1953) |
| 888 | Không số | Luật Bầu cử Đại biểu Quốc hội | 1959-12-31 | Luật Cải cách ruộng đất (1953) |
| 886 | Không số | Luật Nghĩa vụ quân sự | 1960-04-15 | Luật Cải cách ruộng đất (1953) |
| 884 | Không số | Luật Tổ chức Hội đồng Chính phủ | 1960-07-14 | Luật Cải cách ruộng đất (1953) |
| 883 | Không số | Luật Tổ chức Quốc hội | 1960-07-14 | Luật Cải cách ruộng đất (1953) |
| 882 | Không số | Luật Tổ chức Tòa án nhân dân | 1960-07-14 | Luật Cải cách ruộng đất (1953) |
| 1533 | Không số | Luật Bầu cử Đại biểu Quốc hội | 1980-12-18 | Luật Cải cách ruộng đất (1953) |
| 4090 | 3-LCT/HĐNN7 | Luật Tổ chức Viện kiểm sát nhân dân | 1981-07-04 | Luật Tổ chức Tòa án nhân dân (id 4091, same citation) |
| 3871 | Không số | Luật Nghĩa vụ quân sự | 1981-12-30 | Luật Cải cách ruộng đất (1953) |
| 3637 | Không số | Luật Tổ chức Hội đồng nhân dân và Uỷ ban nhân dân | 1983-06-30 | Luật Cải cách ruộng đất (1953) |
| 3483 | Không số | Luật Bầu cử đại biểu Hội đồng nhân dân | 1983-12-26 | Luật Cải cách ruộng đất (1953) |
| 3274 | Không số | Bộ luật Hình sự | 1985-06-27 | Luật Cải cách ruộng đất (1953) |
| 2798 | Không số | Luật Hôn nhân và gia đình | 1986-12-29 | Luật Cải cách ruộng đất (1953) |
| 2565 | Không số | Luật Đầu tư nước ngoài tại Việt Nam | 1987-12-29 | Luật Cải cách ruộng đất (1953) |
| 2566 | Không số | Luật Đất đai | 1987-12-29 | Luật Cải cách ruộng đất (1953) |
| 2564 | Không số | Luật Thuế xuất khẩu, thuế nhập khẩu hàng mậu dịch | 1987-12-29 | Luật Cải cách ruộng đất (1953) |
| 2558 | Không số | Luật Quốc tịch Việt Nam | 1988-06-28 | Luật Cải cách ruộng đất (1953) |
| 2559 | Không số | Bộ luật Tố tụng hình sự | 1988-06-28 | Luật Cải cách ruộng đất (1953) |
| 2325 | Không số | Luật Sửa đổi, bổ sung Luật Tổ chức Tòa án nhân dân | 1988-12-22 | Luật Cải cách ruộng đất (1953) |
| 2324 | Không số | Luật Sửa đổi, bổ sung Luật Tổ chức Viện kiểm sát nhân dân | 1988-12-22 | Luật Cải cách ruộng đất (1953) |
| 2064 | 270B-NQ/HĐNN8 | Luật Thuế Doanh thu | 1990-06-30 | Luật Thuế Tiêu thụ đặc biệt (id 2062, same citation) |
| 1816 | Không số | Luật Doanh nghiệp tư nhân | 1990-12-21 | Luật Cải cách ruộng đất (1953) |
| 1814 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật về Sỹ quan Quân đội nhân dân Việt Nam | 1990-12-21 | Luật Cải cách ruộng đất (1953) |
| 1817 | Không số | Luật Công ty | 1990-12-21 | Luật Cải cách ruộng đất (1953) |
| 1815 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Nghĩa vụ quân sự | 1990-12-21 | Luật Cải cách ruộng đất (1953) |
| 11596 | Không số | Luật Bảo vệ, chăm sóc và giáo dục trẻ em | 1991-08-12 | Luật Cải cách ruộng đất (1953) |
| 11593 | Không số | Luật Bảo vệ và phát triển rừng | 1991-08-12 | Luật Cải cách ruộng đất (1953) |
| 11595 | Không số | Luật Phổ cập giáo dục tiểu học | 1991-08-12 | Luật Cải cách ruộng đất (1953) |
| 11594 | Không số | Luật Sửa đổi, bổ sung một số điều của Bộ luật Hình sự | 1991-08-12 | Luật Cải cách ruộng đất (1953) |
| 11226 | Không số | Luật Tổ chức Chính phủ | 1992-09-30 | Luật Cải cách ruộng đất (1953) |
| 11225 | Không số | Luật Tổ chức Tòa án nhân dân | 1992-10-06 | Luật Cải cách ruộng đất (1953) |
| 11224 | Không số | Luật Tổ chức Viện kiểm sát nhân dân | 1992-10-08 | Luật Cải cách ruộng đất (1953) |
| 10821 | Không số | Luật Sửa đổi, bổ sung một số điều của Bộ luật Tố tụng hình sự | 1992-12-22 | Luật Cải cách ruộng đất (1953) |
| 10822 | Không số | Luật Sửa đổi, bổ sung một số điều của Bộ luật Hình sự | 1992-12-22 | Luật Cải cách ruộng đất (1953) |
| 10820 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Đầu tư nước ngoài tại Việt Nam | 1992-12-23 | Luật Cải cách ruộng đất (1953) |
| 10805 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Xuất khẩu, thuế Nhập khẩu | 1993-07-05 | Luật Cải cách ruộng đất (1953) |
| 10806 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Tiêu thụ đặc biệt | 1993-07-05 | Luật Cải cách ruộng đất (1953) |
| 10808 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Doanh thu | 1993-07-05 | Luật Cải cách ruộng đất (1953) |
| 10807 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Lợi tức | 1993-07-06 | Luật Cải cách ruộng đất (1953) |
| 10804 | Không số | Luật Xuất bản | 1993-07-07 | Luật Cải cách ruộng đất (1953) |
| 10802 | Không số | Luật Đất đai | 1993-07-14 | Luật Cải cách ruộng đất (1953) |
| 10435 | Không số | Luật Bảo vệ môi trường | 1993-12-27 | Luật Cải cách ruộng đất (1953) |
| 10433 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Tổ chức Tòa án nhân dân | 1993-12-28 | Luật Cải cách ruộng đất (1953) |
| 10434 | Không số | Luật Phá sản doanh nghiệp | 1993-12-30 | Luật Cải cách ruộng đất (1953) |
| 10426 | Không số | Luật Bầu cử đại biểu Hội đồng nhân dân | 1994-06-21 | Luật Cải cách ruộng đất (1953) |
| 10420 | Không số | Luật Tổ chức Hội đồng nhân dân và Uỷ ban nhân dân | 1994-06-21 | Luật Cải cách ruộng đất (1953) |
| 10422 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Nghĩa vụ quân sự | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10421 | Không số | Luật Thuế Chuyển quyền sử dụng đất | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10423 | Không số | Luật Sửa đổi một số điều của Luật Doanh nghiệp tư nhân | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10425 | Không số | Luật Khuyến khích đầu tư trong nước | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10424 | Không số | Luật Sửa đổi một số điều của Luật Công ty | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10427 | Không số | Bộ luật Lao động | 1994-06-23 | Luật Cải cách ruộng đất (1953) |
| 9954 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Hàng không dân dụng Việt Nam | 1995-04-20 | Luật Cải cách ruộng đất (1953) |
| 9955 | Không số | Luật Doanh nghiệp Nhà nước | 1995-04-20 | Luật Cải cách ruộng đất (1953) |
| 9702 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Tổ chức Tòa án nhân dân | 1995-10-28 | Luật Cải cách ruộng đất (1953) |
| 9684 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Tiêu thụ đặc biệt | 1995-10-28 | Luật Cải cách ruộng đất (1953) |
| 9703 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Doanh thu | 1995-10-28 | Luật Cải cách ruộng đất (1953) |
| 9683 | Không số | Bộ luật Dân sự | 1995-10-28 | Luật Cải cách ruộng đất (1953) |
| 9414 | Không số | Luật Hợp tác xã | 1996-03-20 | Luật Cải cách ruộng đất (1953) |
| 9413 | Không số | Luật Khoáng sản | 1996-03-20 | Luật Cải cách ruộng đất (1953) |
| 9412 | Không số | Luật Ngân sách Nhà nước | 1996-03-20 | Luật Cải cách ruộng đất (1953) |
| 9028 | Không số | Luật Ban hành Văn bản quy phạm pháp luật | 1996-11-12 | Luật Cải cách ruộng đất (1953) |
| 8532 | Không số | Luật Thương mại | 1997-05-10 | Luật Cải cách ruộng đất (1953) |
| 8533 | Không số | Luật Sửa đổi, bổ sung một số điều của Bộ luật Hình sự | 1997-05-10 | Luật Cải cách ruộng đất (1953) |
| 8535 | Không số | Luật Thuế thu nhập doanh nghiệp | 1997-05-10 | Luật Cải cách ruộng đất (1953) |
| 8534 | Không số | Luật Thuế giá trị gia tăng | 1997-05-10 | Luật Cải cách ruộng đất (1953) |

### 6. Fix for the still-valid documents pulled out of §5, now a permanent mechanism

The 3 documents identified in §5 as "Còn hiệu lực" (still in force) were first fixed individually (2026-08-01) with a one-off script, rather than accepted into the §5 out-of-scope decision, since permanently excluding currently-valid law is a correctness gap, not a scope boundary. `Luật Cải cách ruộng đất` (id 1105) — the original occupant of bare "Không số", also confirmed "Còn hiệu lực" live on a follow-up check — got the same treatment for consistency, renamed from bare `Không số` to `Không số (vbpl-1105)`.

**This is no longer a one-off fix — it's now a permanent mechanism in `document.repository.ts`'s `upsertDocument`** (2026-08-01), so future crawls handle this automatically instead of needing another manual intervention:

- A document is recognized as a re-sync of itself by matching `rawSource.sourceUrl`, not citation — citation alone can't tell two "Không số" documents apart, and vbpl.vn always reports the bare citation on every scrape regardless of what disambiguated form a document was previously stored under.
- If a different document already occupies the citation (a real collision): documents that are **not** "còn hiệu lực" are skipped entirely (`upsertDocument` returns `{ documentId: null, skippedReason }`, surfaced through `syncDocument`/`syncAll` the same way the existing scope-mismatch skip already is) rather than silently overwriting whatever's there. Documents that **are** "còn hiệu lực" get disambiguated by appending vbpl.vn's own internal document id (`extractVbplInternalId`, `vbpl.parser.ts`) to the citation — `"<citation> (vbpl-<id>)"` — and inserted as their own row.
- Verified live end-to-end (2026-08-01): re-sync-recognizes-itself (both a normally-synced and a manually-SQL-renamed document), the skip path (`3-LCT/HĐNN7`'s expired collision, id 4090 vs the existing id 4091 occupant), and the disambiguate path (a synthetic collision against a real never-before-seen document, cleaned up after). Unit tests added for `extractVbplInternalId`; no repository-level test added, matching this module's existing no-DB-mocking precedent (§ "Not yet automated" below) — verified against live Postgres instead.

| Citation (as stored) | Title | Enacted | Status | Resolution |
|---|---|---|---|---|
| Không số (vbpl-1105) | Luật Cải cách ruộng đất | 1953-12-04 | con_hieu_luc | Resolved — renamed for consistency; original occupant, never actually lost |
| Không số (vbpl-25506) | Luật Bảo vệ sức khỏe nhân dân | 1989-06-30 | con_hieu_luc | Resolved — 66 nodes built |
| Không số (vbpl-10803) | Luật Thuế sử dụng đất nông nghiệp | 1993-07-10 | con_hieu_luc | Resolved — 80 nodes built |
| Không số (vbpl-8611) | Luật Bầu cử Đại biểu Quốc hội | 1997-04-15 | con_hieu_luc | Resolved — 117 nodes built |

| Internal id | Citation | Title | Enacted | Currently occupying that citation |
|---|---|---|---|---|
| 887 | Không số | Luật Hôn nhân và gia đình | 1959-12-29 | Luật Cải cách ruộng đất (1953) |
| 888 | Không số | Luật Bầu cử Đại biểu Quốc hội | 1959-12-31 | Luật Cải cách ruộng đất (1953) |
| 886 | Không số | Luật Nghĩa vụ quân sự | 1960-04-15 | Luật Cải cách ruộng đất (1953) |
| 884 | Không số | Luật Tổ chức Hội đồng Chính phủ | 1960-07-14 | Luật Cải cách ruộng đất (1953) |
| 883 | Không số | Luật Tổ chức Quốc hội | 1960-07-14 | Luật Cải cách ruộng đất (1953) |
| 882 | Không số | Luật Tổ chức Tòa án nhân dân | 1960-07-14 | Luật Cải cách ruộng đất (1953) |
| 1533 | Không số | Luật Bầu cử Đại biểu Quốc hội | 1980-12-18 | Luật Cải cách ruộng đất (1953) |
| 4090 | 3-LCT/HĐNN7 | Luật Tổ chức Viện kiểm sát nhân dân | 1981-07-04 | Luật Tổ chức Tòa án nhân dân (id 4091, same citation) |
| 3871 | Không số | Luật Nghĩa vụ quân sự | 1981-12-30 | Luật Cải cách ruộng đất (1953) |
| 3637 | Không số | Luật Tổ chức Hội đồng nhân dân và Uỷ ban nhân dân | 1983-06-30 | Luật Cải cách ruộng đất (1953) |
| 3483 | Không số | Luật Bầu cử đại biểu Hội đồng nhân dân | 1983-12-26 | Luật Cải cách ruộng đất (1953) |
| 3274 | Không số | Bộ luật Hình sự | 1985-06-27 | Luật Cải cách ruộng đất (1953) |
| 2798 | Không số | Luật Hôn nhân và gia đình | 1986-12-29 | Luật Cải cách ruộng đất (1953) |
| 2565 | Không số | Luật Đầu tư nước ngoài tại Việt Nam | 1987-12-29 | Luật Cải cách ruộng đất (1953) |
| 2566 | Không số | Luật Đất đai | 1987-12-29 | Luật Cải cách ruộng đất (1953) |
| 2564 | Không số | Luật Thuế xuất khẩu, thuế nhập khẩu hàng mậu dịch | 1987-12-29 | Luật Cải cách ruộng đất (1953) |
| 2558 | Không số | Luật Quốc tịch Việt Nam | 1988-06-28 | Luật Cải cách ruộng đất (1953) |
| 2559 | Không số | Bộ luật Tố tụng hình sự | 1988-06-28 | Luật Cải cách ruộng đất (1953) |
| 2325 | Không số | Luật Sửa đổi, bổ sung Luật Tổ chức Tòa án nhân dân | 1988-12-22 | Luật Cải cách ruộng đất (1953) |
| 2324 | Không số | Luật Sửa đổi, bổ sung Luật Tổ chức Viện kiểm sát nhân dân | 1988-12-22 | Luật Cải cách ruộng đất (1953) |
| 25506 | Không số | Luật Bảo vệ sức khỏe nhân dân | 1989-06-30 | Luật Cải cách ruộng đất (1953) |
| 2064 | 270B-NQ/HĐNN8 | Luật Thuế Doanh thu | 1990-06-30 | Luật Thuế Tiêu thụ đặc biệt (id 2062, same citation) |
| 1816 | Không số | Luật Doanh nghiệp tư nhân | 1990-12-21 | Luật Cải cách ruộng đất (1953) |
| 1814 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật về Sỹ quan Quân đội nhân dân Việt Nam | 1990-12-21 | Luật Cải cách ruộng đất (1953) |
| 1817 | Không số | Luật Công ty | 1990-12-21 | Luật Cải cách ruộng đất (1953) |
| 1815 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Nghĩa vụ quân sự | 1990-12-21 | Luật Cải cách ruộng đất (1953) |
| 11596 | Không số | Luật Bảo vệ, chăm sóc và giáo dục trẻ em | 1991-08-12 | Luật Cải cách ruộng đất (1953) |
| 11593 | Không số | Luật Bảo vệ và phát triển rừng | 1991-08-12 | Luật Cải cách ruộng đất (1953) |
| 11595 | Không số | Luật Phổ cập giáo dục tiểu học | 1991-08-12 | Luật Cải cách ruộng đất (1953) |
| 11594 | Không số | Luật Sửa đổi, bổ sung một số điều của Bộ luật Hình sự | 1991-08-12 | Luật Cải cách ruộng đất (1953) |
| 11226 | Không số | Luật Tổ chức Chính phủ | 1992-09-30 | Luật Cải cách ruộng đất (1953) |
| 11225 | Không số | Luật Tổ chức Tòa án nhân dân | 1992-10-06 | Luật Cải cách ruộng đất (1953) |
| 11224 | Không số | Luật Tổ chức Viện kiểm sát nhân dân | 1992-10-08 | Luật Cải cách ruộng đất (1953) |
| 10821 | Không số | Luật Sửa đổi, bổ sung một số điều của Bộ luật Tố tụng hình sự | 1992-12-22 | Luật Cải cách ruộng đất (1953) |
| 10822 | Không số | Luật Sửa đổi, bổ sung một số điều của Bộ luật Hình sự | 1992-12-22 | Luật Cải cách ruộng đất (1953) |
| 10820 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Đầu tư nước ngoài tại Việt Nam | 1992-12-23 | Luật Cải cách ruộng đất (1953) |
| 10805 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Xuất khẩu, thuế Nhập khẩu | 1993-07-05 | Luật Cải cách ruộng đất (1953) |
| 10806 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Tiêu thụ đặc biệt | 1993-07-05 | Luật Cải cách ruộng đất (1953) |
| 10808 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Doanh thu | 1993-07-05 | Luật Cải cách ruộng đất (1953) |
| 10807 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Lợi tức | 1993-07-06 | Luật Cải cách ruộng đất (1953) |
| 10804 | Không số | Luật Xuất bản | 1993-07-07 | Luật Cải cách ruộng đất (1953) |
| 10803 | Không số | Luật Thuế sử dụng đất nông nghiệp | 1993-07-10 | Luật Cải cách ruộng đất (1953) |
| 10802 | Không số | Luật Đất đai | 1993-07-14 | Luật Cải cách ruộng đất (1953) |
| 10435 | Không số | Luật Bảo vệ môi trường | 1993-12-27 | Luật Cải cách ruộng đất (1953) |
| 10433 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Tổ chức Tòa án nhân dân | 1993-12-28 | Luật Cải cách ruộng đất (1953) |
| 10434 | Không số | Luật Phá sản doanh nghiệp | 1993-12-30 | Luật Cải cách ruộng đất (1953) |
| 10426 | Không số | Luật Bầu cử đại biểu Hội đồng nhân dân | 1994-06-21 | Luật Cải cách ruộng đất (1953) |
| 10420 | Không số | Luật Tổ chức Hội đồng nhân dân và Uỷ ban nhân dân | 1994-06-21 | Luật Cải cách ruộng đất (1953) |
| 10422 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Nghĩa vụ quân sự | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10421 | Không số | Luật Thuế Chuyển quyền sử dụng đất | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10423 | Không số | Luật Sửa đổi một số điều của Luật Doanh nghiệp tư nhân | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10425 | Không số | Luật Khuyến khích đầu tư trong nước | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10424 | Không số | Luật Sửa đổi một số điều của Luật Công ty | 1994-06-22 | Luật Cải cách ruộng đất (1953) |
| 10427 | Không số | Bộ luật Lao động | 1994-06-23 | Luật Cải cách ruộng đất (1953) |
| 9954 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Hàng không dân dụng Việt Nam | 1995-04-20 | Luật Cải cách ruộng đất (1953) |
| 9955 | Không số | Luật Doanh nghiệp Nhà nước | 1995-04-20 | Luật Cải cách ruộng đất (1953) |
| 9702 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Tổ chức Tòa án nhân dân | 1995-10-28 | Luật Cải cách ruộng đất (1953) |
| 9684 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Tiêu thụ đặc biệt | 1995-10-28 | Luật Cải cách ruộng đất (1953) |
| 9703 | Không số | Luật Sửa đổi, bổ sung một số điều của Luật Thuế Doanh thu | 1995-10-28 | Luật Cải cách ruộng đất (1953) |
| 9683 | Không số | Bộ luật Dân sự | 1995-10-28 | Luật Cải cách ruộng đất (1953) |
| 9414 | Không số | Luật Hợp tác xã | 1996-03-20 | Luật Cải cách ruộng đất (1953) |
| 9413 | Không số | Luật Khoáng sản | 1996-03-20 | Luật Cải cách ruộng đất (1953) |
| 9412 | Không số | Luật Ngân sách Nhà nước | 1996-03-20 | Luật Cải cách ruộng đất (1953) |
| 9028 | Không số | Luật Ban hành Văn bản quy phạm pháp luật | 1996-11-12 | Luật Cải cách ruộng đất (1953) |
| 8611 | Không số | Luật Bầu cử Đại biểu Quốc hội | 1997-04-15 | Luật Cải cách ruộng đất (1953) |
| 8532 | Không số | Luật Thương mại | 1997-05-10 | Luật Cải cách ruộng đất (1953) |
| 8533 | Không số | Luật Sửa đổi, bổ sung một số điều của Bộ luật Hình sự | 1997-05-10 | Luật Cải cách ruộng đất (1953) |
| 8535 | Không số | Luật Thuế thu nhập doanh nghiệp | 1997-05-10 | Luật Cải cách ruộng đất (1953) |
| 8534 | Không số | Luật Thuế giá trị gia tăng | 1997-05-10 | Luật Cải cách ruộng đất (1953) |

---

## Not yet automated

Every entry above was found by ad-hoc SQL spot-checks (comparing `document.rawSource.fullText` length against total `document_node.text_content` length, then manually inspecting outliers) run manually after each reindex pass — there is no code in `server/src/law-index/` that detects or records these automatically. If this log is expected to stay current as new documents get synced, that detection needs to become a real step (e.g. a coverage-ratio check the sync flow runs and logs, or a periodic query against the corpus), not a habit of remembering to check by hand.
