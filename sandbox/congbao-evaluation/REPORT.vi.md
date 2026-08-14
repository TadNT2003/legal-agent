# congbao.chinhphu.vn + pdf-inspector: báo cáo khả thi trích xuất

Phạm vi: một công cụ trích xuất văn bản PDF nhẹ (pdf-inspector) có đủ dùng cho toàn bộ
kho lưu trữ PDF của congbao hay không, như `docs/plan/congbao-source-evaluation.md`
(repo chính) đã kết luận từ việc kiểm tra thủ công một tài liệu duy nhất? Báo cáo này
kiểm chứng lại kết luận đó trên một bộ 200 tài liệu được lấy mẫu ngẫu nhiên, độc lập,
trải khắp toàn bộ kho lưu trữ từ khoảng 2010 đến 2026.

## Tóm tắt điều hành

**Kết luận cốt lõi vẫn đúng, nhưng có những ngoại lệ thật sự, nay đã được định lượng.**
200/200 file PDF được xử lý mà không crash. 77,5% tài liệu là văn bản số hóa gốc 100%,
không cần OCR chút nào. Nhưng có hai điều mà việc kiểm tra một tài liệu duy nhất trước
đây không thể phát hiện ra: một số lượng nhỏ tài liệu (2/200, ~1%) thực sự là ảnh scan
toàn phần dù nằm trong kho lưu trữ "PDF số hóa", và một lỗi mã hóa font riêng biệt (ánh
xạ Unicode bị hỏng đối với một số ký tự có dấu tiếng Việt, không liên quan đến việc scan)
âm thầm làm hỏng văn bản ở 33/200 tài liệu — nghiêm trọng ở 2 tài liệu, không đáng kể ở
31 tài liệu còn lại. Cả hai lỗi này đều là thuộc tính có thật của các file PDF cụ thể trên
congbao, không phải lỗi thu thập dữ liệu — mọi tài liệu đều đã được xác minh độc lập là
đúng theo số hiệu văn bản (ký hiệu) trong bước kiểm chứng của Eval-01.

| Phát hiện | Kết quả |
| --- | --- |
| Độ tin cậy | 200/200 xử lý thành công, 0 crash/lỗi, tổng 23,65 giây (trung bình 0,118 giây/tài liệu) |
| Văn bản số hóa gốc hoàn toàn (0 trang cần OCR) | 155/200 (77,5%) |
| Có một số trang cần OCR | 43/200 (21,5%), chiếm 4,65% trong tổng số 4.131 trang |
| Scan toàn bộ (100% số trang) | 2/200 (1%) — một ngoại lệ thật sự đối với giả định "kho PDF của congbao không bao giờ là ảnh scan" |
| **Văn bản bị hỏng** (CMap ToUnicode của font bị lỗi, không liên quan đến scan) | 33/200 (16,5%) có *một số* dấu hiệu hỏng; chỉ 2/200 (1%) hỏng nghiêm trọng (>1% số ký tự) |
| Tỷ lệ báo động giả về bảng (`has_table`) | 49% được gắn cờ; kiểm tra trực tiếp cho thấy là một hỗn hợp thật (không phải chủ yếu là báo động giả, khác với kho ngữ liệu `laws/`) |

## Thiết lập

**Mẫu thử:** 200 file PDF từ Eval-01 — số hiệu văn bản ngẫu nhiên, mỗi file ứng với một
lượt chọn ngẫu nhiên có trọng số (loại văn bản, ngày mục tiêu), trải từ 2010-2026, được
tải về bằng phương pháp tra cứu số hiệu văn bản kiểu tìm kiếm nhị phân (xem
`docs/plan/congbao-source-evaluation.md`). Cả 200 tài liệu đều đã được xác minh độc lập
là đúng tài liệu mà số hiệu ghi nhận trong đó thể hiện (xem `verify_citation_match.py`
của Eval-01, đạt 200/200 sau khi sửa lại chính công cụ kiểm tra qua ba lần lặp) — vì vậy
mọi phát hiện ở đây là thuộc tính của bản thân các file PDF, không phải hiện tượng tải
nhầm tài liệu.

**Bộ khung kiểm thử (harness):** `scripts/eval02_run_pdf_inspector.py` — gọi
`pdf_inspector.process_pdf()` một lần cho mỗi file, ghi lại các trường giống với
`sandbox/extract-tool-resilience/scripts/run_pdf_inspector.py` để có thể so sánh được
(status, thời gian xử lý, số trang, confidence, `is_complex_layout`,
`has_encoding_issues`, số trang cần OCR, độ dài markdown, `has_table`), cộng thêm ngữ
cảnh riêng của congbao lấy từ manifest của Eval-01 (số hiệu văn bản, loại văn bản, ngày
ban hành). `scripts/analyze_eval02.py` là bước phân tích sau đó (phân bố nhu cầu OCR +
việc rà soát lỗi hỏng văn bản bên dưới — lỗi hỏng văn bản không phải là thứ pdf-inspector
tự báo cáo, xem phần tiếp theo để biết lý do).

## Phát hiện

### Độ tin cậy: ổn định, nhất quán với đánh giá trước

200/200 tài liệu được xử lý mà không hề crash hay lỗi, tổng cộng 23,65 giây. Tốc độ mỗi
tài liệu tương đương với phát hiện trước đó của `extract-tool-resilience` trên kho ngữ
liệu `laws/` (0,118 giây/tài liệu ở đây so với 0,177 giây/tài liệu ở đó).

### Nhu cầu OCR là có thật nhưng nhỏ — và KHÔNG đơn giản là "tài liệu cũ thì bị scan"

155/200 tài liệu (77,5%) không có trang nào cần OCR — văn bản số hóa gốc hoàn toàn,
xác nhận đúng hình dạng chung mà lần kiểm tra một tài liệu trước đây đã thấy. Nhưng
45/200 tài liệu có *ít nhất một* trang cần OCR, và điều quan trọng là **hiện tượng này
không bám sát ranh giới trước-DOCX 2010-2016** mà lần khảo sát trước dùng làm chỉ dấu
gần đúng cho "có thể không phải văn bản số hóa" — các tài liệu cần OCR một phần xuất
hiện muộn tới tận 2023-2025 (`quyet-dinh-so-1386-qd-ttg-40510.pdf`, 9/95 trang;
`nghi-quyet-so-99-nq-cp-39788.pdf`, 5/14 trang), không chỉ ở phần cũ của kho lưu trữ.
Nguyên nhân khả dĩ nhất, chưa được xác minh độc lập ở đây: các phụ lục/đính kèm được
scan riêng lẻ (một công văn có chữ ký được đóng dấu, một bản đồ scan, một phụ lục lấy
từ nguồn bên ngoài) được nhúng vào một tài liệu mà phần còn lại vẫn được đánh máy hoàn
chỉnh, thay vì cả tài liệu bị scan.

**2 tài liệu được phân loại là scan toàn bộ (100% số trang)**:
`thong-tu-so-04-2020-tt-btttt-30810.pdf` và `thong-tu-so-79-2022-tt-bqp-38213.pdf`.
Đây là một ngoại lệ trực tiếp, cụ thể đối với giả định "kho PDF của congbao không bao
giờ là ảnh scan" — hiếm gặp (1%), nhưng có thật, và cả hai đều nằm trong giai đoạn được
cho là an toàn vì đã có DOCX (2020, 2022), nên riêng yếu tố niên đại không phải là chỉ
báo đáng tin cậy để biết tài liệu nào cần OCR.

### Một phát hiện riêng biệt, bất ngờ: lỗi mã hóa font làm hỏng văn bản ở một số tài liệu — độc lập với việc scan

Đây không phải là điều mà cờ `has_encoding_issues` của chính pdf-inspector luôn phát
hiện được — đã kiểm tra trực tiếp trên 3 tài liệu được gắn cờ này và cả 3 đều sạch
(xem phần "Files" bên dưới để biết công cụ rà soát). Phát hiện này thay vào đó đến từ
việc đọc trực tiếp đầu ra markdown của pdf-inspector cho tài liệu "scan toàn bộ"
`thong-tu-so-04-2020-tt-btttt-30810.pdf` và nhận thấy văn bản bị hỏng có hệ thống
(`"Số"` → `"S<KÝ TỰ THAY THẾ>"`, `"Bộ"` → `"B<KÝ TỰ THAY THẾ>"`) dù chính tài liệu này
**không có ảnh nhúng nào và có 111 tham chiếu font** — tức là xét theo định nghĩa, đây
không phải là ảnh scan. Đã đối chiếu trực tiếp với kết quả trích xuất của `pdfplumber`
trên cùng file PDF đó (độc lập với pdf-inspector), và thấy cùng một lỗi dưới dạng tham
chiếu glyph không ánh xạ được kiểu `(cid:1237)` — xác nhận đây là thuộc tính có thật của
font nhúng trong PDF (một bảng CMap `/ToUnicode` không đầy đủ đối với một số ký tự tiếng
Việt có dấu ghép), không phải hiện tượng do một trong hai công cụ trích xuất gây ra.

Một biểu hiện thứ hai của cùng nguyên nhân gốc, khó nhận ra hơn, được phát hiện khi kiểm
tra ngẫu nhiên đầu ra bảng biểu: `nghi-quyet-so-229-nq-cp-45810.pdf` hiển thị "KHÁC"
thành "KH¡C" — không phải ký tự thay thế do thiếu ánh xạ, mà là một ký tự **sai** (U+00A1
"¡" thấp hơn đúng 0x20 so với U+00C1 "Á" đúng). Một mục CMap bị sai thay vì bị thiếu sẽ
tạo ra một ký tự trông có vẻ hợp lý nhưng không chính xác, thay vì một dấu hiệu lỗi rõ
ràng — đây là biến thể nguy hiểm hơn, vì không có gì trong kết quả đầu ra báo hiệu "chỗ
này có thể sai".

Rà soát toàn bộ 200 file đầu ra markdown để tìm cả hai dấu hiệu này
(`scripts/analyze_eval02.py`):

- **33/200 (16,5%)** có ít nhất một lần xuất hiện của một trong hai dấu hiệu.
- Mức độ nghiêm trọng phân bố rõ rệt theo hai cực, không trải đều:
  - **2/200 (1%)** bị hỏng nghiêm trọng — lần lượt 12,8% và 2,4% tổng số ký tự
    (`thong-tu-so-04-2020-tt-btttt-30810.pdf` và
    `thong-tu-so-34-2015-tt-btnmt-16336.pdf`). Cả hai tài liệu này cũng chính là hai
    tài liệu có nhiều trang cần OCR nhất, cho thấy cùng một vấn đề font/hiển thị gốc
    biểu hiện ra cả hai triệu chứng cùng lúc ở những tài liệu bị ảnh hưởng nặng nhất.
  - **31/200 (15,5%)** chỉ có lỗi hỏng ở mức dấu vết — thường là 1-80 ký tự lạc trong
    hàng chục nghìn ký tự, thấp hơn hẳn 0,3% và phần lớn dưới 0,05%. Về mặt thực tế là
    không đáng kể đối với mục đích xây dựng kho ngữ liệu/truy hồi, nhưng không phải là
    zero, và nhóm lỗi này sẽ vô hình trước bất kỳ phép kiểm tra nào (như chính việc xác
    minh số hiệu văn bản của Eval-01) chỉ xét đến số hiệu văn bản, vì số hiệu văn bản
    là ASCII thuần và không bao giờ chạm vào lỗi ánh xạ dấu tiếng Việt.
- **167/200 (83,5%)** không có dấu hiệu hỏng nào thuộc hai loại trên.

### Báo động giả về bảng biểu: rủi ro có thật, nhưng không chiếm ưu thế trên kho ngữ liệu này

49% tài liệu tạo ra bảng markdown (`has_table`), cao hơn hẳn mức 31% mà đánh giá
`extract-tool-resilience` trước đây tìm thấy trên kho ngữ liệu `laws/`. Đã kiểm tra thủ
công 8 tài liệu `has_table` ngẫu nhiên, cộng thêm 2 tài liệu khác phát hiện được một
cách tình cờ trong lúc điều tra các phát hiện khác:

- **2 bảng đúng thật sự** — một danh sách phụ lục tỉnh/thành theo vùng có thật
  (`van-ban-hop-nhat-so-01-vbhn-bnv-28945.pdf`) và một kế hoạch nhiệm vụ/cơ quan/thời
  gian có thật (`quyet-dinh-so-225-qd-ttg-19068.pdf`), cả hai đều có các hàng còn
  nguyên vẹn, canh đúng cột.
- **2 bảng đúng một phần** — nội dung dạng bảng có thật (một biểu thuế nhập khẩu, một
  biểu phí trạm thu phí) với đúng bảng được *nhận diện*, nhưng ranh giới ô bị xáo trộn
  nặng đến mức mất liên kết hàng/cột (giá tiền và loại phương tiện bị lẫn sang ô sai).
- **1 bảng nội dung khuôn mẫu (boilerplate)**, hiển thị đúng — phần chân trang liên hệ
  của "Văn phòng Chính phủ" xuất hiện ở cuối mọi số Công báo (chỉ 3/98 tài liệu
  `has_table` là do riêng phần này gây ra, nên nó không phải nguyên nhân chính khiến
  tỷ lệ `has_table` tăng cao).
- **3 báo động giả rõ ràng** — văn xuôi thông thường (một khoản trong Điều, một mục
  trong danh sách chương trình thi đua) bị chia cắt tùy tiện thành các ô bảng giả, cùng
  kiểu lỗi mà đánh giá trước đã mô tả trên kho ngữ liệu `laws/`.

Khác với kết quả "10/10 xác nhận báo động giả" của đánh giá trước, mẫu nhỏ này cho thấy
tỷ lệ `has_table` cao hơn của congbao ít nhất một phần được giải thích bởi việc kho ngữ
liệu này thực sự chứa nhiều nội dung dạng bảng thật hơn (biểu phí, danh sách phụ lục, kế
hoạch dự án là phổ biến trong các phụ lục của Nghị định/Thông tư/Quyết định) — chứ không
hoàn toàn là do tỷ lệ báo động giả tệ hơn. Cỡ mẫu ở đây (10) còn quá nhỏ để đưa ra một
con số đáng tin cậy cho tỷ lệ đúng/sai; nên xem đây là gợi ý về xu hướng, chưa phải kết
luận chắc chắn.

## Kết luận

Kết luận ban đầu rút ra từ một tài liệu duy nhất — "một công cụ trích xuất nhẹ, không
cần docling/OCR, là đủ dùng cho congbao" — vẫn đứng vững khi đối chiếu với một mẫu ngẫu
nhiên đúng nghĩa, nhưng hai lưu ý giờ đã có con số thật thay vì chỉ là suy đoán lý
thuyết:

1. **~1% tài liệu thực sự là ảnh scan** và cần cùng một đường xử lý OCR mà các tài liệu
   của vanban.chinhphu.vn đã cần. Con số này không hề nhỏ ở bất kỳ quy mô kho ngữ liệu
   thực tế nào, và niên đại (trước/sau ranh giới có DOCX) không dự đoán đáng tin cậy
   tài liệu nào sẽ rơi vào nhóm này.
2. **Một lỗi mã hóa font, không liên quan đến việc scan, âm thầm làm hỏng một tỷ lệ
   đáng kể tài liệu (16,5% có dấu hiệu, 1% hỏng nghiêm trọng).** Đây có thể coi là phát
   hiện quan trọng hơn: nó vô hình trước một phép kiểm tra đúng-sai chỉ dựa vào số hiệu
   văn bản (vì số hiệu văn bản là ASCII nên không chạm lỗi này), không được cờ
   `has_encoding_issues` của chính pdf-inspector gắn cờ một cách đáng tin cậy, và biến
   thể tệ hơn của nó (thay thế ký tự sai nhưng trông hợp lý) không tạo ra bất kỳ dấu
   hiệu lỗi nào có thể nhìn thấy trong kết quả đầu ra. Bất kỳ pipeline nào xây dựng dựa
   trên trích xuất văn bản PDF thuần cho congbao đều nên tự rà soát đầu ra của mình để
   tìm loại lỗi này thay vì tin vào sự im lặng — cách rà soát của `analyze_eval02.py`
   (tìm U+FFFD, tham chiếu `(cid:N)` trần trụi, và các ký tự Latin-1 Supplement lạc
   loài nằm ngoài tập nhỏ chữ cái tiếng Việt hợp lệ) là một điểm khởi đầu hợp lý.

Báo động giả về bảng biểu vẫn là một vấn đề có thật nhưng có vẻ nhỏ hơn trên kho ngữ liệu
này so với `laws/`, dựa trên một lần kiểm tra mẫu nhỏ — đáng để lấy một mẫu lớn hơn,
chuyên biệt hơn trước khi tin tưởng vô điều kiện vào các bảng do `pdf_inspector` tạo ra,
cùng một lưu ý mà đánh giá trước đã nêu ra.

## Files

- `samples/*.pdf`, `samples/manifest.json` — bộ mẫu 200 tài liệu từ Eval-01
- `samples/citation_match_check.json` — bước xác minh độc lập tính đúng đắn theo số hiệu
  văn bản của Eval-01 (200/200), xác lập rằng các phát hiện ở đây là thuộc tính của bản
  thân các file PDF, không phải do tải nhầm tài liệu
- `outputs/*.md` — đầu ra markdown của pdf-inspector cho từng tài liệu
- `outputs/_timings.json` — trạng thái/thời gian/cờ của từng tài liệu từ lượt chạy
  pdf-inspector
- `outputs/analysis_summary.json`, `outputs/corruption_detail.json` — phần phân tích
  OCR và lỗi hỏng văn bản mà báo cáo này dựa vào
- `scripts/eval02_run_pdf_inspector.py` — bộ khung đánh giá
- `scripts/analyze_eval02.py` — phân tích phân bố OCR và rà soát lỗi hỏng văn bản
