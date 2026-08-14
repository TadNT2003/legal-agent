# pdf-inspector: báo cáo độ bền ở quy mô lớn

Phạm vi: **chỉ pdf-inspector**. Báo cáo thứ hai trong ba báo cáo theo từng công cụ cho
`extract-tool-resilience` (docling đã xong, markitdown tiếp theo — báo cáo này không
phải là so sánh giữa các công cụ). Kiểm chứng vai trò của pdf-inspector từ đánh giá trước
(`sandbox/text-extract-evaluation/REPORT.md`) — công cụ định tuyến/trích xuất chính cho
mọi thứ không cần OCR — trên một mẫu thử 100 tài liệu được phân tầng có chủ đích (80 tài
liệu phân loại số hóa/sạch, 20 tài liệu phân loại scan toàn bộ), lớn hơn và cân bằng hơn
52 lần thử ngẫu nhiên của đánh giá trước.

## Tóm tắt điều hành

**Độ tin cậy và hành vi định tuyến OCR mạnh y hệt như đánh giá trước đã phát hiện — 100/100
tài liệu được xử lý, không crash, và mọi tài liệu đã scan đều được định tuyến đúng thành
"cần OCR" mà không tạo ra nội dung giả.** Nhưng rủi ro bảng-biểu-báo-động-giả mà lần trước
chỉ coi là một lưu ý nhỏ (n=4, tương quan "4/4" với `is_complex_layout`) hóa ra là một vấn
đề lớn hơn nhiều ở quy mô thực: nó ảnh hưởng đến **khoảng một phần ba số tài liệu số hóa
sạch**, không phải là trường hợp hiếm gặp, và tín hiệu dự báo vốn có vẻ hoàn hảo ở n=4 lại
có ít nhất một trường hợp phản chứng đã xác nhận ở n=100.

| Phát hiện                                                  | Kết quả                                                                                                                                                                                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Độ tin cậy                                                | 100/100 xử lý thành công, 0 crash/lỗi                                                                                                                                                                            |
| Tốc độ                                                    | 17,7 giây cho 100 tài liệu (trung bình 0,177 giây/tài liệu); vẫn gần như miễn phí                                                                                                                         |
| Độ chính xác định tuyến OCR                           | 20/20 tài liệu đã scan đúng đắn cho ra đầu ra rỗng; 80/80 tài liệu sạch cho ra nội dung thật                                                                                                          |
| **Tỷ lệ báo động giả về bảng**                 | **22/71 tài liệu sạch duy nhất (31%)** tạo ra một pipe-table lộn xộn trên văn xuôi bình thường — kiểm tra trực tiếp 10 trường hợp, cả 10/10 đều xác nhận là báo động giả         |
| Tín hiệu dự báo`is_complex_layout`                     | Vẫn có ích về mặt xu hướng (21/22 tài liệu báo động giả có cờ này bật), nhưng không hoàn hảo: tìm thấy một trường hợp phản chứng đã xác nhận (cờ`False`, đầu ra vẫn lộn xộn) |
| Phát hiện về chất lượng dữ liệu trong kho ngữ liệu | 9 trong 100 file được lấy mẫu là bản sao giống hệt nhau về byte dưới hai mục khác nhau trong`laws/manifest.json` — một vấn đề thật sự của kho ngữ liệu, không phải lỗi lấy mẫu         |

## Thiết lập

**Mẫu thử:** 100 file PDF — 80 file phân loại "sạch" (văn bản số hóa, 0 trang cần OCR) +
20 file phân loại "scan toàn bộ" (100% trang cần OCR), trải đều theo kích thước file từ
toàn bộ kho khảo sát 721 PDF được xây dựng khi thiết lập sandbox. Xem
`samples/pdf-inspector_manifest.json`.

**Harness:** vòng lặp tuần tự đơn giản, gọi `pdf_inspector.process_pdf()` một lần cho mỗi
file, ghi lại trạng thái/thời gian/số trang/độ tin cậy/`is_complex_layout`/số trang cần
OCR/đầu ra markdown. Không cần chạy song song hay checkpoint — chi phí xử lý mỗi tài liệu
của pdf-inspector đủ nhỏ để toàn bộ 100 tài liệu chạy xong trong vài giây, không phải vài
giờ. Xem `scripts/run_pdf_inspector.py`.

## Phát hiện

### Độ tin cậy và định tuyến OCR: không đổi so với đánh giá trước, nay ở quy mô gấp 5 lần

100/100 tài liệu được xử lý mà không hề crash hay lỗi ngoại lệ nào. Toàn bộ 20 tài liệu
đã phân loại trước là scan toàn bộ đều cho ra **chính xác zero** ký tự đầu ra markdown —
pdf-inspector nhận diện đúng rằng nó không thể trích xuất văn bản thật và trả về rỗng thay
vì bịa ra nội dung, đúng hành vi "nhận diện đúng cần OCR, không thử trích xuất" mà đánh
giá trước đã phát hiện. Toàn bộ 80 tài liệu sạch đều cho ra nội dung thật, không tầm
thường (1.584 đến 201.150 ký tự). Đây là một xác nhận rõ ràng, không phải phát hiện mới —
nhưng nay được củng cố bởi 100 lần thử thay vì 52, với tỷ lệ chia đôi có chủ đích thay vì
ngẫu nhiên.

### Một phát hiện về chất lượng dữ liệu trong kho ngữ liệu, độc lập với bản thân pdf-inspector

9 trong 100 file được lấy mẫu hóa ra là **bản sao giống hệt nhau về byte** (đã xác minh
bằng MD5) nằm dưới hai mục khác nhau trong `laws/manifest.json` với các slug tự sinh hơi
khác nhau (ví dụ `31-2024-QH15_luat-dat-dai-1.pdf` và `31-2024-QH15_luat-dat-dai.pdf`,
khớp MD5 100%). Điều này có nghĩa mẫu "sạch" 80 tài liệu thực ra chỉ có 71 tài liệu duy
nhất, không phải 80 — việc lấy mẫu trải đều theo kích thước không có cách nào biết được
hai mục trong manifest trỏ đến cùng một nội dung. Đây không phải lỗi lấy mẫu (bản khảo sát
đã xử lý đúng chúng như các dòng riêng biệt, khớp với manifest); đây là một khoảng trống
thật sự trong kho ngữ liệu `laws/`, nhiều khả năng là các lần tải trùng lặp vào những ngày
khác nhau rồi rơi vào các slug tự sinh khác nhau. Đáng để ghi chú lại cho ai phụ trách
`server/src/law/download` — manifest của dự án hiện chưa loại trùng theo nội dung, chỉ
theo bất kỳ khóa nào mà quá trình crawl tự gán. Mọi tỷ lệ phần trăm bên dưới đều được báo
cáo trên 71 tài liệu duy nhất, không phải 80 slot thô.

### Báo động giả về bảng: vấn đề lớn hơn những gì mẫu nhỏ của đánh giá trước gợi ý

Đánh giá trước đã ghi nhận đây là một rủi ro thật nhưng hẹp: trên 4 tài liệu sạch được
kiểm tra riêng cho vấn đề này, 2 tài liệu có bảng lộn xộn và cả hai đều có
`is_complex_layout: true`; 2 tài liệu còn lại không có cả hai dấu hiệu. Ở quy mô này, bức
tranh kém rõ ràng hơn và đáng lo ngại hơn:

- **22 trong 71 tài liệu sạch duy nhất (31%)** tạo ra một pipe-table markdown
  (`has_table: true`).
- Kiểm tra trực tiếp 10 trong số đó so với nguồn — **10/10 đều là báo động giả**: văn
  xuôi pháp lý bình thường (các khoản `Điều`/`Khoản` nhiều câu) bị tách rời một cách tùy
  tiện vào các ô bảng, trong mọi trường hợp, không phải dữ liệu bảng thật. Một ví dụ tách
  cả một từ giữa chừng âm tiết: `"...229 Kinh doanh d|ịch vụ lưu trữ|"` — từ `"dịch"` bị
  cắt thành `"d"` và `"ịch"` qua ranh giới ô. Một ví dụ khác gói hơn 1.400 ký tự văn bản
  pháp luật liên tục — nhiều câu hoàn chỉnh — vào một hàng 5 cột duy nhất.
- 21 trong 22 tài liệu báo động giả có `is_complex_layout: true`, khớp với tín hiệu dự
  báo của đánh giá trước. Nhưng **một trường hợp phản chứng đã xác nhận** đã phá vỡ mối
  tương quan tưởng như hoàn hảo đó: `33-2024-QH15` (Luật Lưu trữ) tạo ra cùng kiểu bảng
  lộn xộn (`"...229 Kinh doanh d|ịch vụ lưu trữ|"`, ví dụ ở trên) với
  `is_complex_layout: false`. Ở n=4 tín hiệu này trông hoàn hảo; ở n=71 nó là một tín hiệu
  mạnh, không phải một cổng chặn đáng tin cậy.
- Không tìm thấy bảng nào thực sự đúng trong số 10 trường hợp kiểm tra trực tiếp — mẫu
  này không đưa ra bằng chứng tích cực nào cho thấy khả năng phát hiện bảng của
  pdf-inspector từng hoạt động đúng trên hình dạng tài liệu thực tế của kho ngữ liệu này
  (chủ yếu là văn xuôi pháp lý một cột, thỉnh thoảng có khối tiêu đề hai cột), chỉ có bằng
  chứng về cách nó thất bại.

Nhận định thực tế: đây không phải là trường hợp biên có thể chặn bằng một cờ boolean rồi
bỏ qua — gần như cứ 3 tài liệu số hóa "sạch" thì có 1 tài liệu hiển thị một bảng giả ở đâu
đó trong nó, và tín hiệu dự báo hiện có bắt được phần lớn nhưng không phải tất cả các
trường hợp.

### Tốc độ: vẫn gần như miễn phí

17,7 giây cho 100 tài liệu (trung bình 0,177 giây/tài liệu, khoảng dao động cá nhân từ
0,0097 đến 4,41 giây). Khớp với "dưới 100ms, lên đến khoảng 0,23 giây khi tạo markdown
thật" của đánh giá trước — các tài liệu chậm nhất ở đây là các file lớn hàng trăm trang,
vẫn không đáng kể so với bất kỳ giải pháp thay thế nào dựa trên OCR.

## Kết luận

Giá trị cốt lõi của pdf-inspector từ đánh giá trước vẫn nguyên vẹn và nay có bằng chứng
tốt hơn: nó nhanh, không bao giờ crash, và từ chối đúng đắn việc bịa ra nội dung trên đầu
vào đã scan thay vì đoán mò. Nó vẫn là công cụ định tuyến mặc định đúng đắn cho mọi thứ
không cần OCR.

Nhưng tỷ lệ báo động giả về bảng là một chi phí thật sự, nay đã được định lượng rõ ràng,
của việc tin tưởng vô điều kiện vào đầu ra markdown của nó: khoảng một phần ba tài liệu số
hóa sạch trong kho ngữ liệu này có ít nhất một chỗ mà văn xuôi liên tục bị hiển thị sai
thành một bảng lộn xộn. Biện pháp giảm thiểu của đánh giá trước — chặn theo
`is_complex_layout`, đưa các tài liệu bị gắn cờ đi kiểm tra chéo — vẫn đúng về mặt xu
hướng (21/22 trường hợp có cờ này bật), nhưng trường hợp phản chứng tìm thấy ở đây có
nghĩa là nó không phải là một cổng chặn hoàn chỉnh tự thân. Với quy mô của vấn đề
(~31%, không phải vài trường hợp biên lẻ tẻ), đây không còn là một việc phụ nhỏ nữa — nó
đủ trung tâm đối với độ tin cậy thực tế của công cụ trên kho ngữ liệu này để cần một
heuristic phát hiện tốt hơn, hoặc coi mọi bảng do `pdf_inspector` tạo ra là chưa được kiểm
chứng theo mặc định, bất kể cờ `is_complex_layout`, cho đến khi tìm được một tín hiệu
mạnh hơn.

## Files

- `samples/pdf-inspector/`, `samples/pdf-inspector_manifest.json` — mẫu 100 tài liệu (80
  slot sạch / 20 slot scan, 71/20 tài liệu duy nhất sau khi loại trùng) và metadata trạng
  thái scan của chúng
- `outputs/pdf-inspector/*.md` — markdown đầu ra của từng tài liệu
- `outputs/pdf-inspector/_timings.json` — trạng thái/thời gian/cờ theo từng tài liệu
  (nguồn của mọi con số trong báo cáo này)
- `scripts/run_pdf_inspector.py` — harness đánh giá
