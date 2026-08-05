# Báo cáo: Phase 0 — sửa lỗi trùng `document_node` path

**Ngày giờ báo cáo: 2026-08-05, 16:59 (UTC+7) / 09:59 UTC.**

> **Bản tiếng Việt.** Đây là bản dịch của [2026-08-05-phase0-duplicate-node-paths.md](2026-08-05-phase0-duplicate-node-paths.md) — bản tiếng Anh là bản gốc, ưu tiên tham chiếu bản đó khi hai bản có sai khác. Đánh số mục (§) khớp 1:1 với bản tiếng Anh.

**Trạng thái: một phần hoàn tất.** Phần code (sửa parser + backstop + test) đã xong và đã kiểm chứng. Phần backfill dữ liệu (re-scrape 636 văn bản bị ảnh hưởng) mới hoàn tất 70/636 (11%), dừng theo yêu cầu để báo cáo — xem §5 cho phần còn lại.

Đây là báo cáo cho Phase 0 của [../plan/opensearch-projector-plan.md](../plan/opensearch-projector-plan.md) — bước tiên quyết trước khi xây projector OpenSearch, vì `document_node` phải duy nhất theo `(document_id, path)` để `_id` của mỗi provision trong index có ý nghĩa. Chi tiết kỹ thuật đầy đủ (root cause, ví dụ, số liệu) đã được ghi vào [../monitoring/law-index-flagged-documents.md](../monitoring/law-index-flagged-documents.md) §12 — tài liệu này là bản tóm tắt tình hình cho việc ra quyết định tiếp theo, không lặp lại toàn bộ chi tiết.

---

## 1. Tóm tắt nhanh

| Hạng mục | Trạng thái |
| - | - |
| Sửa lỗi header phụ lục lặp lại (`document-node.parser.ts`) | ✅ Xong, có test hồi quy |
| Backstop chống trùng ordinal (áp dụng mọi loại node) | ✅ Xong, có test hồi quy |
| Test suite | ✅ 128/128 pass (25 test mới cho parser) |
| Ghi nhận log kỹ thuật (§12a/12b/12c) | ✅ Xong |
| Backfill 636 văn bản bị ảnh hưởng | 🟡 70/636 (11%) — **dừng giữa chừng theo yêu cầu** |
| Gate check tổng corpus (0 hàng trùng `(document_id, path, node_type)`) | 🟡 Giảm từ ~9.446 → 8.863 nhóm trùng, chưa đạt 0 |
| Nguyên nhân server crash lặp lại (§11 cũ) | ⚠️ Vẫn chưa chẩn đoán được, nhưng có thêm dữ liệu cụ thể |

---

## 2. Phần code — đã hoàn tất

Ba thay đổi trong `server/src/law-index/crawl/document-node.parser.ts`:

1. **Sửa lỗi header phụ lục lặp lại.** Khi một phụ lục có nhiều tiểu mục, mỗi tiểu mục lặp lại dòng header "Phụ lục N" — parser cũ mở một node mới mỗi lần gặp lại, khiến 21 tiểu mục của cùng một phụ lục bị tách thành 21 node trùng cùng path. Đã sửa: dòng lặp cùng số La Mã với node đang mở được gộp vào làm nội dung, không mở node mới.
2. **Backstop chống trùng ordinal**, áp dụng cho mọi loại node (Điều, Khoản, Điểm, Chương, Mục, Tiểu mục, Phụ lục): khi ordinal tính ra trùng với sibling đang có, tự động thêm hậu tố đếm (`1` → `1_2`) vào phần dùng để dựng path, giữ nguyên `label` hiển thị đúng như văn bản gốc.
3. Hai test mới trong `document-node.parser.spec.ts` xác nhận cả hai cơ chế trên hoạt động đúng, cộng test cho trường hợp phụ lục khác số La Mã vẫn mở node mới bình thường.

Chi tiết kỹ thuật đầy đủ, gồm phân tích hai nguyên nhân sâu hơn không sửa trong lần này (dữ liệu bảng biểu bị đọc nhầm thành Khoản; văn bản trích dẫn mang theo đánh số riêng — mở rộng phạm vi của mục 7 đã ghi trước đó): xem §12 trong [law-index-flagged-documents.md](../monitoring/law-index-flagged-documents.md#12-duplicate-document_node-paths--phase-0-of-the-opensearch-projector-plan-three-distinct-causes).

---

## 3. Backfill — tiến độ thực tế

**70/636 văn bản** (11%) đã được re-scrape qua `PUT /laws/index/crawl/batch?force=true` và xác nhận **sạch 0 trùng lặp** bằng gate check theo `sourceUrl`:

- 20 văn bản smoke-test ban đầu (stability check).
- 50 văn bản của lô 1/13.

**566 văn bản còn lại** (12 lô, `rbatch_001` đến `rbatch_012`, mỗi lô 50 văn bản, đã cắt sẵn) chưa được xử lý. Gate check tổng toàn corpus hiện tại: **8.863 nhóm trùng** (giảm từ baseline ~9.446 trước Phase 0 — phần giảm lớn hơn tỷ lệ 70/636 vì một số văn bản trong 70 này có số lượng trùng lặp rất lớn, ví dụ một văn bản có tới 186 nhóm trùng do race condition — xem §4).

Với tốc độ quan sát được (~35–45 phút/lô 50 văn bản khi chạy đúng quy trình, cộng thời gian xử lý các trường hợp race condition phát sinh), **ước tính còn ~9–11 giờ xử lý tuần tự** cho 12 lô còn lại.

---

## 4. Phát hiện quan trọng nhất: race condition thật trong `syncNodes()`

Trong lúc chạy backfill, mỗi lần server tự khởi động lại giữa chừng batch (xem §5), văn bản đang xử lý dở tại thời điểm đó bị chèn **toàn bộ cây node hai lần** — kể cả node cấp Chương/Điều, không chỉ Khoản/Điểm. Đã xác nhận 3 trường hợp cụ thể (`104/2026/NĐ-CP` — 186 nhóm/372 node; `31/2008/NQ-CP` — 33 nhóm/302 node; `29/NQ-CP` — 2 nhóm/4 node).

**Đây không phải lỗi trong bản fix parser vừa làm** — đã kiểm chứng bằng cách phân biệt hai dấu hiệu: lỗi parser sẽ để lại hậu tố `_2` trên ordinal (do backstop mục 2 xử lý), còn race condition thì hai bản ghi có ordinal **giống hệt nhau** (hai lệnh gọi độc lập, mỗi lệnh tự đánh số đúng trong phạm vi lệnh của nó, nhưng không biết về lệnh kia). Cả 3 trường hợp đều thuộc dạng thứ hai.

**Nguyên nhân:** `syncNodes()` (`document-node.repository.ts`) xóa toàn bộ node cũ rồi chèn lại, không có transaction bọc quanh, không có khóa chống hai lệnh gọi đồng thời cho cùng `documentId`. Nếu hai request `force=true` cho cùng văn bản chồng lấn thời gian (chính xác là điều đã xảy ra khi client timeout rồi tôi retry trong lúc server vẫn đang xử lý request cũ), lệnh xóa của request thứ hai có thể chạy trước khi lệnh chèn của request thứ nhất hoàn tất, rồi cả hai vòng chèn tiếp tục độc lập — kết quả là hai bản sao đầy đủ.

**Đã xử lý triệu chứng, chưa sửa gốc.** Mỗi trường hợp được sync lại riêng lẻ (đảm bảo không chồng lấn) và xác nhận về 0 trùng lặp. Sửa tận gốc cần thêm khóa/transaction ở `syncNodes()` — chưa làm, ghi nhận là việc cần làm riêng, không thuộc phạm vi Phase 0.

---

## 5. Vấn đề hạ tầng phát hiện trong lúc chạy

Không liên quan trực tiếp đến logic Phase 0, nhưng ảnh hưởng lớn đến tốc độ và độ tin cậy của backfill — đã ghi đầy đủ vào [law-index-flagged-documents.md](../monitoring/law-index-flagged-documents.md) (cập nhật §11, thêm ghi chú trong §12):

1. **Timeout client sai cấu hình.** `AbortSignal` không ghi đè được `headersTimeout` mặc định 300s của `undici` — khiến batch dài (>5 phút) luôn báo lỗi phía client dù server vẫn đang xử lý bình thường. Đã sửa bằng cách chuyển hẳn sang module lõi `node:http`.
2. **`nest --watch` theo dõi toàn bộ thư mục `server/`, không chỉ `src/`.** Việc tạo file scratch trong `server/` có thể kích hoạt recompile giữa batch. Đã chuyển toàn bộ file tạm ra khỏi `server/`.
3. **Dừng task không giết được tiến trình server thật** — `nest --watch` fork tiến trình con có thể sống sót qua việc dừng lệnh cha, phải tìm đúng PID qua `Get-NetTCPConnection -LocalPort 3000` và kill thủ công.
4. **Server tự crash và khởi động lại 3 lần trong phiên hôm nay** (PID đổi liên tiếp: `35944` → `31376` → `4560`). Đây là lần tái diễn của lỗi đã ghi ở §11 trước đó (chưa chẩn đoán được nguyên nhân gốc), nhưng lần này có thêm dữ liệu cụ thể hơn — bao gồm chính là nguyên nhân trực tiếp gây ra 3 trường hợp race condition ở §4.
5. Công cụ dò trình duyệt Playwright còn sống ban đầu lọc sai tên tiến trình (Playwright bản này dùng `chrome-headless-shell.exe`, không phải `chrome.exe`), gây báo động giả — đã sửa.

---

## 6. Khuyến nghị cho bước tiếp theo

1. **Trước khi tiếp tục 12 lô còn lại**, cân nhắc: có nên dừng lại điều tra nguyên nhân crash server (mục 4 ở trên) trước, hay chấp nhận quy trình hiện tại (chạy lô → gate-check riêng lô đó → tự chữa văn bản dính race → sang lô tiếp) và tiếp tục?
2. **Sửa tận gốc race condition ở `syncNodes()`** (khóa hoặc transaction theo `documentId`) nên làm sớm, độc lập với Phase 0 — càng nhiều lô chạy mà chưa sửa, càng nhiều lần phải chữa tay.
3. Ước tính **~9–11 giờ** cho 12 lô còn lại nếu tiếp tục tuần tự thủ công như hiện tại — có thể cân nhắc chạy như một tác vụ nền dài hơi, ít cần giám sát trực tiếp mỗi bước, một khi quy trình gate-check-và-tự-chữa đã được xác nhận ổn định qua lô 1.
