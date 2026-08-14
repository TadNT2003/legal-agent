# Đánh giá công cụ trích xuất văn bản: docling vs. markitdown vs. pdf-inspector vs. MinerU

Đánh giá các công cụ này với vai trò ứng viên chuyển đổi PDF/DOCX/RTF/DOC → Markdown cho pipeline dự
phòng chinhphu.vn+OCR (dùng khi một citation bị thiếu trên vbpl.vn). Nhánh: `evaluate/document-parser`.
56 tài liệu thật từ `laws/` đã được chạy qua bốn công cụ — riêng docling được chạy qua ba cấu hình OCR
khác nhau — với kết quả được gộp thành một bộ dữ liệu cho mỗi công cụ/cấu hình bên dưới.

## Tóm tắt điều hành

**Kiến trúc được khuyến nghị:** pdf-inspector làm công cụ định tuyến/trích xuất chính cho mọi thứ không
cần OCR, markitdown làm công cụ chính chỉ cho `.docx`, và docling + EasyOCR(`lang='vi'`) chạy theo từng
trang làm phương án OCR dự phòng. Lý do đầy đủ nằm trong phần Khuyến nghị bên dưới.

| Mục | Vai trò | OCR tiếng Việt | Độ tin cậy | Tốc độ (chỉ CPU) |
|---|---|---|---|---|
| **pdf-inspector** | Được khuyến nghị làm công cụ chính cho mọi thứ không cần OCR | Không áp dụng — không bao giờ thực hiện OCR | Không lỗi nào trong 52 lượt thử | ~miễn phí (<100ms) |
| **markitdown** | Được khuyến nghị làm công cụ chính chỉ cho `.docx` | Không áp dụng — không bao giờ thực hiện OCR | Không crash trong 56 lượt thử, nhưng có hai kiểu lỗi âm thầm (xem Vấn đề) | Nhanh khi nó thực sự làm gì đó |
| **MinerU** | Không được khuyến nghị — đáng tin cậy, nhưng không thể sửa OCR tiếng Việt vì lý do kiến trúc | Hỏng, không có hướng sửa (enum ngôn ngữ cố định, không thể hoán đổi OCR engine) | 14/14 (100%) hoàn tất, không crash | Chậm nhất trong các công cụ có khả năng OCR, gấp 2–5× docling |
| **docling (mặc định, RapidOCR)** | Không được khuyến nghị dùng riêng — nhanh nhưng âm thầm không đáng tin cậy | Hỏng (RapidOCR không có tiếng Việt trong danh sách ngôn ngữ; đã thử chinese/latin/en, đều thất bại) | 5/14 (36%) tài liệu xử lý được có mất nội dung; 3/14 (21%) mất trên 50%, một cách âm thầm | Nhanh khi sạch, biến động rất lớn khi không |
| **docling + EasyOCR(vi), cả tài liệu một lượt** | Ngõ cụt trong lần kiểm thử này | **Đã sửa** — dấu đúng | Crash (`std::bad_alloc`) trên tài liệu đầy đủ duy nhất đã kiểm thử | Không áp dụng — chưa từng hoàn tất |
| **docling + EasyOCR(vi), theo từng trang** | **Phương án OCR dự phòng được khuyến nghị** | **Đã sửa** — dấu đúng, nhưng còn một lỗi thứ tự từ riêng biệt chưa xử lý | Hoàn tất 295/295 trang trên 11 tài liệu, không crash nào — kể cả trên cả hai tài liệu từng crash dưới docling mặc định | Chậm hơn docling mặc định khoảng 2,8 lần tính chung (biến động nhiều theo tài liệu — xem Chỉ số) |

**Kết luận chính:** không mục nào trong sáu mục là một chiến thắng sạch sẽ, không cần bàn cãi. Kho dữ
liệu mà pipeline này thực sự phải xử lý là PDF tiếng Việt dạng scan chiếm trên 92% (xem Vấn đề), nên
tiêu chí quyết định là "cái này có cho ra văn bản tiếng Việt đúng và thực sự hoàn tất hay không" — và
chỉ một cấu hình đã kiểm thử vượt qua được cả hai ngưỡng đó: docling với EasyOCR thay cho backend
RapidOCR mặc định, chạy từng trang một. Nó chậm và vẫn còn một lỗi mở (thứ tự từ, không phải độ chính
xác ký tự), nhưng đây là cấu hình duy nhất không bị loại thẳng. pdf-inspector và markitdown không hề
cạnh tranh cho vai trò đó — chúng là con đường mặc định đúng đắn cho phần tài liệu (nhỏ hơn, nhưng có
thật) không cần OCR ngay từ đầu. MinerU là engine OCR đáng tin cậy nhất khi dùng cấu hình mặc định, và
dù vậy vẫn là một ngõ cụt, vì nó không thể nhận cách khắc phục duy nhất thực sự quan trọng ở đây.

## Thiết lập

**venv chính (`.venv/`, Python 3.14.4, gốc repo):**

- `docling`, `torch` (bản CPU), `pdfminer.six` — đã cài sẵn.
- `markitdown` được nâng cấp lên 0.1.7, chỉ giới hạn extras `[pdf,docx]`. `markitdown[all]==0.1.7`
  hiện đang **bị hỏng trên PyPI** — nó ghim `youtube-transcript-api~=1.0.0`, mà không có bản phát hành
  nào trong đúng dải đó tồn tại (các phiên bản đã công bố nhảy từ 0.6.2 → 1.2.3). Cài `[all]` sẽ thất
  bại hoàn toàn; chỉ nên cài đúng những extras thực sự cần.
- `pdf-inspector` 0.2.7 — cài sạch, không vấn đề gì (wheel PyO3/Rust, `cp38-abi3`, không phụ thuộc
  phiên bản Python cụ thể — là công cụ duy nhất trong bốn công cụ cài được trên Python 3.14 mà không có
  lưu ý nào).
- `easyocr` 1.7.2 — cài sạch; đã xác nhận `'vi'` là một ngôn ngữ được hỗ trợ thật
  (`easyocr.config.all_lang_list`).

**venv thứ hai (`sandbox/text-extract-evaluation/.venv-mineru/`, Python 3.12.1):** `mineru` giới hạn ở
`Requires-Python >=3.10,<3.14`, nên hoàn toàn không cài được vào venv 3.14 chính (pip báo lỗi ngay lập
tức và rõ ràng). Đã dùng `py -0p` để tìm bản cài Python 3.12 sẵn có (`C:\Python312`) và tạo một venv
riêng ở đó. Đã cài `mineru[core]` 3.4.4.

**Cả docling và MinerU đều chỉ chạy trên CPU.** Máy này có RTX 3060 (6GB VRAM, driver 596.36,
CUDA 13.2), nhưng `pip install torch` trên nền tảng/index này lại trả về bản wheel chỉ-chạy-CPU
(`torch-2.13.0+cpu`) ở *cả hai* venv — muốn dùng GPU cần một bước cài đặt tường minh trỏ vào index CUDA
(`--index-url https://download.pytorch.org/whl/cu...`) mà đường cài đặt mặc định của cả hai công cụ
đều không tự thiết lập. Toàn bộ số liệu thời gian trong báo cáo này đều chỉ chạy CPU.

**Vướng mắc riêng của docling:** pipeline mặc định gọi `torch.compile` (TorchInductor), việc này cần
một trình biên dịch C++ của MSVC (`cl.exe`) — không có sẵn trên máy này, và nó lỗi cứng
(`InvalidCxxCompiler`) thay vì tự động chuyển sang phương án khác. Đã khắc phục bằng
`TORCHDYNAMO_DISABLE=1` (ép chạy ở chế độ eager). Nếu không có biến môi trường đó, docling hoàn toàn
không chạy được trên một máy Windows mới không cài Visual Studio Build Tools.

## Mẫu thử nghiệm

**Tổng cộng 56 tài liệu, không trùng lặp.** Một bộ 6 tài liệu ban đầu được chọn thủ công để đa dạng
định dạng (PDF/DOCX/RTF/DOC); một bộ 50 tài liệu sau đó được lấy mẫu riêng để kiểm tra chiều sâu định
dạng PDF (vì PDF là định dạng mà tài liệu mới thực sự xuất hiện), phân tầng theo tier/năm/kích thước và
loại trừ 6 tài liệu đầu.

| | Số lượng |
|---|---|
| Bộ đa dạng định dạng | 6 — 2 PDF, 2 `.doc` cũ, 1 `.rtf`, 1 `.docx` |
| Bộ phân tầng PDF | 50 |
| **Tổng cộng** | **56** |
| Các tier xuất hiện | `01-hien-phap`, `02-luat-nghi-quyet-quoc-hoi`, `03-phap-lenh-nghi-quyet-ubtvqh` |
| Khoảng năm (bộ phân tầng) | 2005–2026 |
| Khoảng kích thước (bộ phân tầng) | 33KB – 21,5MB |
| Được mang tiếp vào đợt kiểm thử chuyên sâu các cấu hình OCR của docling/MinerU | 11 trong số 50 mẫu phân tầng, cộng thêm 1 trong số 6 mẫu ban đầu (được dùng lại xuyên suốt mọi bài kiểm thử EasyOCR/theo từng trang — tài liệu đơn lẻ được phân tích sâu nhất trong toàn bộ đợt đánh giá này) |

### Bộ đa dạng định dạng (6 tài liệu)

| # | Tài liệu | Định dạng | Tình trạng scan | Ghi chú |
|---|---|---|---|---|
| 01 | 48/2024/QH15 (Luật Thuế GTGT) | PDF, 20 trang | Văn bản digital sạch (đã xác nhận qua `pypdfium2`) | |
| 02 | 109/2025/QH15 (Luật Thuế TNCN) | PDF, 15 trang | Scan hoàn toàn (đã xác nhận qua `pypdfium2`) | Được dùng lại cho mọi bài kiểm thử docling+EasyOCR (cả tài liệu một lượt và theo từng trang) |
| 03 | 57/2010/QH12 (Luật Thuế BVMT) | `.doc` cũ | Không áp dụng | |
| 04 | 01/2002/QH11 (Luật Ngân sách) | `.doc` cũ | Không áp dụng | |
| 05 | Hiến pháp 1980 | `.rtf` | Không áp dụng | Mã hóa font TCVN3/VNI cũ |
| 06 | 248/2025/QH15 | `.docx` | Không áp dụng | |

### Bộ phân tầng PDF (50 tài liệu)

Lấy từ `laws/manifest.json`, loại trừ 2 PDF đã có trong bộ đa dạng định dạng. **Tình trạng scan** là
kết quả phân loại của pdf-inspector; **tập con OCR** đánh dấu 11 tài liệu được dùng trong đợt kiểm thử
chuyên sâu các cấu hình docling/MinerU.

| # | Citation | Tier | Năm | Kích thước | Tình trạng scan | Trong tập con OCR? |
|---|---|---|---|---|---|---|
| 01 | `.` (Hiến pháp 2013) | 01-hien-phap | 2013 | 2,0MB | Scan hoàn toàn | |
| 02 | 02/2026/QH16 | 02 | 2026 | 578KB | Scan hoàn toàn | |
| 03 | 10/2009/PL-UBTVQH12 | 03-phap-lenh | 2009 | 1,2MB | Scan hoàn toàn | |
| 04 | 2013 (Hiến pháp 2013) | 01-hien-phap | 2013 | 2,0MB | Scan hoàn toàn | ✅ |
| 05 | 38/2013/QH13 | 02 | 2013 | 1,3MB | Scan hoàn toàn | |
| 06 | 50/2014/QH13 | 02 | 2014 | 6,3MB | Scan hoàn toàn | |
| 07 | 74/2018/QH14 | 02 | 2018 | 561KB | Scan hoàn toàn | ✅ |
| 08 | 68/2025/QH15 | 02 | 2025 | 1,4MB | Scan hoàn toàn | ✅ |
| 09 | 179/2025/QH15 | 02 | 2025 | 132KB | Scan hoàn toàn | ✅ |
| 10 | 36/2021/QH15 | 02 | 2021 | 247KB | Scan hoàn toàn | |
| 11 | 35/2017/QH14 | 02 | 2017 | 224KB | Scan hoàn toàn | |
| 12 | 99/2019/QH14 | 02 | 2019 | 372KB | Scan hoàn toàn | |
| 13 | 103/2025/QH15 | 02 | 2025 | 949KB | Scan hoàn toàn | |
| 14 | 153/2024/QH15 | 02 | 2024 | 138KB | Scan hoàn toàn | |
| 15 | 03/2026/QH16 | 02 | 2026 | 600KB | Scan hoàn toàn | |
| 16 | 125/2025/QH15 | 02 | 2025 | 7,8MB | Scan hoàn toàn | |
| 17 | 33/2021/QH15 | 02 | 2021 | 188KB | Scan hoàn toàn | |
| 18 | 127/2016/QH13 | 02 | 2016 | 140KB | Scan hoàn toàn | |
| 19 | 43/2022/QH15 | 02 | 2022 | 710KB | Scan hoàn toàn | |
| 20 | 126/2025/QH15 | 02 | 2025 | 7,1MB | Scan hoàn toàn | |
| 21 | 51/2022/QH15 | 02 | 2022 | 230KB | Scan hoàn toàn | |
| 22 | 06/2022/QH15 | 02 | 2022 | 666KB | Hỗn hợp — 1/65 trang là scan | ✅ |
| 23 | 128/2025/QH15 | 02 | 2025 | 21,0MB | Scan hoàn toàn | |
| 24 | 108/2025/QH15 | 02 | 2025 | 2,9MB | Scan hoàn toàn | |
| 25 | 39/2024/QH15 | 02 | 2024 | 820KB | Sạch — 0/46 trang là scan | ✅ |
| 26 | 41/2017/QH14 | 02 | 2017 | 392KB | Scan hoàn toàn | ✅ |
| 27 | 11/2026/QH16 | 02 | 2026 | 661KB | Scan hoàn toàn | |
| 28 | 59/2024/QH15 | 02 | 2024 | 315KB | Sạch — 0/12 trang là scan | ✅ |
| 29 | 131/2025/QH15 | 02 | 2025 | 10,7MB | Scan hoàn toàn | |
| 30 | 149/2025/QH15 | 02 | 2025 | 151KB | Scan hoàn toàn | |
| 31 | 198/2025/QH15 | 02 | 2025 | 4,1MB | Scan hoàn toàn | |
| 32 | 137/2025/QH15 | 02 | 2025 | 4,5MB | Scan hoàn toàn | |
| 33 | 114/2016/QH13 | 02 | 2016 | 175KB | Scan hoàn toàn | |
| 34 | 117/2020/QH14 | 02 | 2020 | 211KB | Scan hoàn toàn | |
| 35 | 246/2025/QH15 | 02 | 2025 | 6,6MB | Scan hoàn toàn | ✅ |
| 36 | 14/2026/QH16 | 02 | 2026 | 773KB | Scan hoàn toàn | |
| 37 | 97/2025/QH15 | 02 | 2025 | 352KB | Scan hoàn toàn | |
| 38 | 148/2025/QH15 | 02 | 2025 | 1,2MB | Scan hoàn toàn | |
| 39 | 59/2018/QHH14 | 02 | 2018 | 210KB | Scan hoàn toàn | |
| 40 | 213/2025/QH15 | 02 | 2025 | 135KB | Scan hoàn toàn | |
| 41 | 88/2019/QH14 | 02 | 2019 | 494KB | Scan hoàn toàn | |
| 42 | 74/2022/QH15 | 02 | 2022 | 5,1MB | Scan hoàn toàn (có lớp văn bản bị hỏng sẵn — xem Vấn đề) | |
| 43 | 81/2025/QH15 | 02 | 2025 | 1,1MB | Scan hoàn toàn | |
| 44 | 43/2005/QH11 | 02 | 2005 | 33KB | **Lỗi — thực chất không phải PDF** (bị gán nhầm nhãn, là RTF, xem Vấn đề) | |
| 45 | 44/2013/QH13 | 02 | 2013 | 2,5MB | Scan hoàn toàn | ✅ |
| 46 | 94/2019/QH14 | 02 | 2019 | 446KB | Scan hoàn toàn | |
| 47 | 85/2015/QH13 | 02 | 2015 | 2,3MB | Scan hoàn toàn | ✅ |
| 48 | 192/2025/QH15 | 02 | 2025 | 420KB | Scan hoàn toàn | |
| 49 | 134/2020/QH14 | 02 | 2020 | 719KB | Scan hoàn toàn | |
| 50 | 106/2016/QH13 | 02 | 2016 | 460KB | Scan hoàn toàn | |

Mã tier: `01` = `01-hien-phap`, `02` = `02-luat-nghi-quyet-quoc-hoi`, `03` = `03-phap-lenh-nghi-quyet-ubtvqh`.
Chi tiết đầy đủ về citation/tiêu đề/đường dẫn nguồn nằm trong `samples2/_manifest.json`.

## Vấn đề

Mọi phát hiện riêng biệt từ đợt đánh giá này, mỗi phát hiện chỉ trình bày một lần, được nhóm theo chủ đề
thực sự của nó — không nhóm theo thời điểm phát hiện.

### Về bản thân kho dữ liệu

- **PDF gần như hoàn toàn là hiện tượng của tier 2.** Chỉ có 3 trong tổng số 719 PDF của `laws/` tồn
  tại ngoài `02-luat-nghi-quyet-quoc-hoi` (2 Hiến pháp, 1 Pháp lệnh) — nên việc mẫu phân tầng 50 tài
  liệu có 47/50 thuộc tier 2 là một sự thật về kho dữ liệu, không phải thiên lệch khi lấy mẫu.
- **Kho dữ liệu này chủ yếu là dạng scan, không phải digital-native.** 47/51 lần phân loại PDF hợp lệ
  (92,2%) là scan hoàn toàn; chỉ 3 tài liệu là văn bản digital sạch, 1 tài liệu ở dạng hỗn hợp. Năm ban
  hành không dự đoán được điều này — một văn bản luật ban hành năm 2025 (`68/2025/QH15`) vẫn quay về
  dạng scan hoàn toàn giống như một văn bản năm 2013. Đây chính là sự thật khiến vấn đề OCR tiếng Việt
  bên dưới trở thành trường hợp chiếm đa số của pipeline này, không phải một trường hợp biên trong đó.
- **Một file bị gán nhầm phần mở rộng.** File `.pdf` của `43/2005/QH11` thực ra là nội dung RTF — đã
  xác nhận bằng cách đọc trực tiếp dữ liệu byte thô (`{\rtf1\ansi...`). Bộ nhận diện của pdf-inspector
  đoán nhầm "JSON" (sai, nhiều khả năng do ký tự `{` ở đầu); bộ nhận diện của markitdown nhận đúng đó là
  RTF nhưng sau đó lại rơi vào chính lỗi xử lý RTF đã hỏng của nó (xem bên dưới). Một lỗi có thật trong
  quá trình tải/gán nhãn của `laws/`, độc lập với đợt đánh giá này — đáng ghi chú lại cho người phụ
  trách `server/src/law/download`, vì cả phần mở rộng file lẫn việc nhận diện nội dung của cả hai công
  cụ đều không thể tin cậy hoàn toàn ở đây.
- **Một lớp văn bản tồn tại nhưng đã bị hỏng sẵn.** `74/2022/QH15` được pdf-inspector phân loại "scan
  hoàn toàn," nhưng markitdown (công cụ không bao giờ OCR) lại trích xuất được 580 nghìn ký tự thật từ
  đó — vì nó có một lớp văn bản nhúng sẵn, chỉ là lớp đó đã bị mất dấu từ trước
  (`"QUOC HOI CQNG HOa XA HOI CHU NGHIA VIET NAM"`), có vẻ như từ một lượt OCR chất lượng thấp đã được
  "nướng sẵn" vào trước khi tài liệu này đến được pipeline này. Một dạng lỗi thứ ba bên cạnh
  sạch/cần-OCR: có tồn tại nhưng không dùng được, vô hình trước một phép kiểm tra ngây thơ kiểu "có văn
  bản hay không?", và sẽ bị bất kỳ công cụ nào tin tưởng lớp văn bản có sẵn (markitdown) đưa thẳng vào
  chỉ mục một cách âm thầm.

### Các bug riêng của từng công cụ

- **Đường xử lý RTF của markitdown hoàn toàn hỏng, đã xác nhận độc lập trên hai file khác nhau.** Nó đổ
  nguyên văn mã nguồn control-code thô `{\rtf1\ansi\ansicpg1252...}` ra như thể "đã trích xuất thành
  công" — báo `status: ok`, có số ký tự thật, nhưng hoàn toàn không phân tích gì cả. Phát hiện lần đầu
  trên một mẫu `.rtf` thật, phát hiện lại một cách độc lập trên file bị gán nhầm nhãn ở trên. Hai file
  không liên quan nhau, cùng một lỗi y hệt — đây là một giới hạn cố hữu của đường xử lý RTF trong công
  cụ này, không phải một trường hợp biên.
- **Bộ nhận diện bảng của pdf-inspector có rủi ro false-positive thật sự — nhưng có thể dự đoán được.**
  Trên phần văn xuôi hai cột thông thường (phổ biến trong cách trình bày công báo tiếng Việt), nó có thể
  tự tin xuất ra một bảng Markdown sai lệch, lệch hàng thay vì trả về rỗng. Đã kiểm tra riêng cả 4 tài
  liệu sạch/gần-sạch trong đợt đánh giá này cho đúng vấn đề này: hai tài liệu có bảng bị sai lệch (một
  nghiêm trọng, một chỉ là bảng giả 3 dòng nhỏ) đều có `is_complex_layout: true`; hai tài liệu không có
  sai lệch nào đều có `is_complex_layout: false`. Đúng 4/4 — n nhỏ, nhưng đây là một tín hiệu
  pdf-inspector đã tự tính sẵn miễn phí, đáng để dùng làm điều kiện gate (xem Khuyến nghị).
- **Pipeline OCR của docling có một lỗi độ tin cậy nghiêm trọng, diễn ra âm thầm.** `std::bad_alloc`
  (cấp phát bộ nhớ thất bại) xảy ra lặp lại trên các tài liệu scan vượt quá khoảng 14–15 trang, và tỷ lệ
  lỗi *tệ dần* theo số trang được xử lý trong một lệnh gọi `.convert()` duy nhất — phù hợp với việc áp
  lực bộ nhớ tích lũy bên trong đúng một lệnh gọi đó, không phải qua các lệnh gọi riêng biệt (đã xác
  nhận trực tiếp: chia cùng tài liệu 15 trang đó thành 15 lệnh gọi `.convert()` riêng cho từng trang,
  bên trong một instance converter được tái sử dụng, đã hoàn tất mà không crash nào — xem mục theo từng
  trang trong phần Chỉ số). Quan trọng hơn, **lỗi này diễn ra âm thầm**: docling vẫn trả về
  `status: ok`, vẫn ghi ra file `.md`, không hề có dấu hiệu nào cho biết cả loạt trang đã bị bỏ sót. Đã
  xác nhận bằng kiểm tra trực tiếp — một tài liệu 46 trang gặp `bad_alloc` từ trang 14–46 và output của
  nó bị cắt cụt giữa câu, không có dấu hiệu báo lỗi nào
  (`"...b) Bố trí phòng bỏ phiếu, chuẩn bị hòm phiếu;"` — rồi dừng hẳn): chỉ 26.371 ký tự được thu được
  cho một tài liệu đáng lẽ phải đầy đủ (MinerU thu được 97.394 ký tự — gấp 3,7 lần — từ đúng file đó,
  chạy hết tới đúng đoạn kết văn bản thật sự). Đây là kiểu lỗi nguy hiểm nhất phát hiện được trong đợt
  đánh giá này, vì nó trông giống hệt như thành công.
- **Không công cụ nào trong docling hay MinerU có hỗ trợ tiếng Việt thật sự ở cấu hình OCR mặc định.**
  Đã xác nhận độc lập trên cả hai: docling (backend RapidOCR) đã thử `lang=['chinese']` (mặc định của
  chính nó), `['latin']`, và `['en']` — cả ba đều làm mất dấu tiếng Việt nghiêm trọng
  (`"Điều"` → `"Điu"`/`"Dièu"`, `"được"` → `"đưc"`/`"duoc"`, `"Luật"` → `"Lut"`/`"Luât"`). Đã kiểm tra
  trực tiếp danh sách ngôn ngữ được hỗ trợ của chính RapidOCR — hoàn toàn không có tùy chọn tiếng Việt.
  MinerU (backend `pipeline`, `-l ch` — tùy chọn duy nhất trong danh sách liệt kê của chính nó có vẻ hợp
  lý) cho ra cùng dạng lỗi y hệt trên cùng tài liệu. Model OCR đóng gói sẵn của cả hai công cụ chưa từng
  được huấn luyện với hỗ trợ tiếng Việt thật sự.
- **MinerU hoàn toàn không thể gắn một OCR engine khác — một bức tường kiến trúc, không phải một
  khoảng trống cấu hình.** Đã xác nhận bằng cách đọc mã nguồn của nó (`mineru/utils/ocr_language.py`):
  bộ chọn ngôn ngữ của backend `pipeline` là một enum cố định gồm 12 giá trị (`ch`, `korean`, `ta`,
  `te`, `ka`, `th`, `el`, `arabic`, `east_slavic`, `cyrillic`, `devanagari`), mỗi giá trị trỏ tới model +
  file từ điển đóng gói sẵn của riêng nó — bản tự cài đặt lại PP-OCR bằng PyTorch của chính MinerU,
  hoàn toàn không có dependency `easyocr`/`paddleocr` nào trong gói đã cài. `validate_public_ocr_lang()`
  ném lỗi cứng `ValueError` với bất kỳ giá trị nào ngoài danh sách đó, và không có điểm mở rộng nào để
  thay thế bằng một engine khác. Ngược lại, docling thực sự hỗ trợ các OCR backend có thể hoán đổi
  (`EasyOcrOptions`/`RapidOcrOptions`/`TesseractOcrOptions` đều là các pipeline option có thật, có tài
  liệu, có thể thay thế lẫn nhau) — một thiết kế khác về căn bản. Backend `vlm-engine`/`hybrid-engine`
  riêng của MinerU (dùng một vision-language model thay vì pipeline cố định) là một con đường lý thuyết
  khác chưa được thử — phải tải thêm một model lớn, nhiều khả năng chậm hơn nhiều trên máy chỉ chạy CPU
  này, và không đáng công sức bỏ ra xét theo bằng chứng rằng backend pipeline của MinerU đã là công cụ
  đáng tin cậy hơn trong hai công cụ OCR mặc định.
- **Gắn thêm EasyOCR(vi) sửa được dấu của docling nhưng lại sinh ra một lỗi đúng-sai khác, mới: thứ tự
  từ bị xáo trộn tại các điểm xuống dòng.** Đã xác nhận trên nhiều trang, cùng một mô hình lỗi nhất
  quán mỗi lần — từ cuối cùng (hoặc vài từ cuối) của một dòng bị ngắt giữa câu bị đẩy ra *cuối* đoạn văn
  thay vì giữ nguyên vị trí:
  > `"...tính theo 12 liên tục kể từ ngày đầu tiên có mặt tại Việt Nam; tháng"` (đúng ra phải là
  > `"...tính theo 12 tháng liên tục kể từ ngày đầu tiên có mặt tại Việt Nam"` — từ `"tháng"` bị đẩy ra
  > cuối)

  Từng từ riêng lẻ đều được đánh vần đúng (dấu vẫn nguyên vẹn) — đây thuần túy là lỗi thứ tự đọc, không
  phải lỗi nhận dạng ký tự, và là kiểu lỗi rất dễ bị bỏ sót khi đọc lướt nhưng sẽ làm hỏng bất kỳ khâu
  downstream nào giả định rằng thứ tự dòng phản ánh đúng thứ tự đọc. Nguyên nhân nhiều khả năng nhất:
  logic chuyển từ layout sang thứ tự đọc của docling được tinh chỉnh theo quy ước bounding-box của
  RapidOCR, và các box của EasyOCR có hình dạng/thứ tự khác đủ để làm hỏng logic đó. Việc chia nhỏ theo
  từng trang (giúp sửa crash, xem bên dưới) không sửa cũng không làm lỗi này tệ hơn, xác nhận đây là vấn
  đề trong nội bộ một trang, độc lập với vấn đề bộ nhớ.
- **Chia nhỏ theo từng trang sửa hoàn toàn lỗi crash của docling — đã xác nhận ở quy mô toàn bộ tập con
  kho dữ liệu, không chỉ trên một tài liệu.** Một instance `DocumentConverter` được tái sử dụng qua các
  lệnh gọi tuần tự `.convert(path, page_range=(i, i))` cho từng trang, thay vì một lệnh gọi duy nhất cho
  cả tài liệu. Xác nhận lần đầu trên một tài liệu 15 trang (15/15 trang, không crash); sau đó chạy lại
  trên toàn bộ tập con 11 tài liệu/295 trang (cùng tập con dùng để so sánh độ tin cậy của docling mặc
  định và MinerU) — **295/295 trang hoàn tất, không crash nào**, kể cả trên chính hai tài liệu từng gặp
  `bad_alloc` dưới docling mặc định (tài liệu 37 trang và 46 trang, trước đây chỉ thu được khoảng 41% và
  27% nội dung thật, nay cả hai đều hoàn tất đầy đủ: lần lượt 82.853 và 83.078 ký tự). Điều này trực tiếp
  xác nhận chẩn đoán ở trên: áp lực bộ nhớ tích lũy *bên trong* một lệnh gọi `.convert()` xử lý nhiều
  trang, chứ không phải qua các lần gọi lặp lại tới một converter được tái sử dụng, và cách khắc phục này
  vẫn đứng vững ở quy mô lớn, không chỉ là may mắn trên một tài liệu.
- **Tốc độ theo từng trang dưới EasyOCR biến động rất lớn theo tài liệu, và biến động đó khớp với việc
  tài liệu có lớp văn bản thật hay không.** Trên toàn bộ lượt chạy 295 trang, các tài liệu được
  pdf-inspector phân loại là sạch hoặc gần-sạch (0 hoặc 1 trang thực sự cần OCR) được xử lý với tốc độ
  khoảng 1,1–1,3s/trang — nhanh hơn 15–20 lần so với mức ~17–28s/trang thường thấy ở các tài liệu scan
  hoàn toàn. Điều này xảy ra dù mọi trang đều đi qua đúng cùng một pipeline EasyOCR theo từng trang bất
  kể phân loại — cho thấy bản thân pipeline của docling đang bỏ qua bước OCR thật sự trên các trang đã có
  sẵn lớp văn bản dùng được, ngay cả khi EasyOCR được cấu hình làm OCR backend. Tin tốt cho throughput
  thực tế: một kho dữ liệu hỗn hợp không phải trả chi phí OCR đầy đủ trên mọi trang, chỉ trên những trang
  thực sự là scan.
- **Một tài liệu chậm bất thường dưới cả hai cấu hình OCR, bất kể engine nào.** `246/2025/QH15` (15
  trang) trung bình 41,6s/trang ở đây (có trang lên tới 96,25s) — và cũng là tài liệu chậm nhất trong đợt
  đánh giá này dưới docling mặc định (688,3s tổng, kèm cảnh báo "RapidOCR returned empty result"). Cùng
  một bất thường, hai OCR engine khác nhau — cho thấy vấn đề nằm ở chất lượng scan hoặc độ phức tạp của
  chính tài liệu đó, không phải một bug riêng của OCR engine nào.

### Các vấn đề xuyên suốt / liên quan đến tích hợp, bất kể chọn công cụ nào

- **Không công cụ nào trong bốn công cụ gốc xử lý được định dạng `.doc`/`.rtf` cũ của kho dữ liệu này.**
  Theo `laws/manifest.json` (tổng 1.155 tài liệu): 191 `.doc` (17%) + 236 `.rtf` (20%) = **37% kho dữ
  liệu hiện có** không được công cụ nào xử lý trực tiếp. Một bước chuyển đổi trước bằng
  LibreOffice-headless (`--convert-to docx`) là điều kiện tiên quyết bất kể công cụ nào được chọn ở
  downstream — máy này chưa cài LibreOffice, nên bước đó cũng chưa được xây dựng.
- **`document-node.parser.ts` không tương thích với output của mọi công cụ, theo cùng một cách, bất kể
  công cụ nào.** Đây là một parser dựa trên dòng văn bản thuần —
  `DIEU_KHOAN_PATTERN = /^Điều\s+(\d+)([a-zđ]?)\s*[.:]?\s*(.*)$/iu` và các pattern tương tự đều được
  neo để khớp với một dòng bắt đầu *đúng nguyên văn* bằng `"Điều"`/`"Chương"`/v.v. — được viết dựa trên
  dữ liệu scrape plain-innerText của vbpl.vn, chưa từng được viết để xử lý Markdown. Mọi công cụ đã kiểm
  thử đều thêm tiền tố `#`/`##` trước mỗi tiêu đề nhận diện được (đã xác nhận bằng cách đọc trực tiếp
  các file thật: `"## Điều 1. Phạm vi điều chỉnh"`), mà regex hiện tại hoàn toàn không khớp — cùng kiểu
  lỗi với bug NFD/NFC đã được ghi nhận ở §16 trong `docs/monitoring/law-index-flagged-documents.md`.
  Các heuristic ngăn nhận nhầm bảng của parser (tinh chỉnh cho các dòng bảng dạng plain-text đã bị làm
  phẳng theo hình dạng scrape của vbpl.vn) cũng không áp dụng được cho cả pipe-table của Markdown
  (docling) lẫn bảng HTML nhúng (MinerU) — không gây hại chủ động, nhưng cấu trúc thật của bảng vẫn vô
  hình đối với parser bất kể nguồn nào. **Cần một lớp tiền xử lý trước khi parser này có thể tiêu thụ
  output của bất kỳ công cụ nào trong số này** — tối thiểu là loại bỏ tiền tố `#+\s*` ở đầu các dòng
  tiêu đề; đây không phải yếu tố phân biệt giữa các công cụ, đây là công việc bắt buộc chung, bất kể
  công cụ nào thắng cuộc.
- **Cả docling lẫn MinerU đều không dùng GPU sẵn có theo mặc định.** Cả hai đều chỉ cài được bản torch
  chạy CPU trên máy này dù có sẵn RTX 3060; muốn dùng GPU thật sự cần một bước cài đặt pip trỏ tường
  minh vào index CUDA mà hướng dẫn cài đặt mặc định của cả hai công cụ đều không tự thiết lập.

## Chỉ số

Sáu mục, mỗi mục một hàng, cho từng khía cạnh. **Kích thước mẫu (n) khác nhau giữa các mục** —
pdf-inspector/markitdown/MinerU/docling (mặc định) được chạy trên toàn bộ 56 tài liệu (hoặc tập con mà
mỗi định dạng hỗ trợ). docling+EasyOCR cả tài liệu một lượt được kiểm thử trên một tài liệu (15 trang, đã
xác nhận là scan — chính tài liệu nơi lỗi mất dấu ban đầu được phát hiện) và dừng lại ở đó, vì kết quả
(một lần crash) khiến việc chạy rộng hơn không còn ý nghĩa. docling+EasyOCR theo từng trang bắt đầu theo
cách tương tự, sau đó được chạy lại trên toàn bộ tập con 11 tài liệu/295 trang (cùng tập con dùng để so
sánh độ tin cậy của docling mặc định và MinerU) một khi kết quả trên một tài liệu đủ khả quan để đáng
kiểm chứng ở quy mô lớn hơn — xem phần Vấn đề để biết đầy đủ phát hiện từ lượt chạy quy mô lớn đó.

### Phạm vi hỗ trợ định dạng

| Mục | PDF (digital) | PDF (scan) | `.docx` | `.doc` cũ | `.rtf` |
|---|---|---|---|---|---|
| pdf-inspector | ✅ | ⚠️ chỉ phân loại, không OCR | ❌ không phải công cụ cho PDF | ❌ | ❌ |
| markitdown | ✅ | ❌ âm thầm trả về rỗng | ✅ | ❌ báo lỗi rõ ràng | ❌ âm thầm hỏng nội dung |
| MinerU | ✅ | ⚠️ có chạy OCR, dấu không dùng được | ✅ | ❌ không nằm trong danh sách hỗ trợ | ❌ không nằm trong danh sách hỗ trợ |
| docling (mặc định) | ✅ | ⚠️ có chạy OCR, dấu không dùng được, và không đáng tin cậy quá ~14 trang | ✅ | ❌ lỗi cứng (dù tuyên bố hỗ trợ) | ❌ từ chối tường minh |
| docling + EasyOCR, cả tài liệu | (chưa kiểm thử lại — cùng đường xử lý không-OCR như mặc định) | ⚠️ dấu đã sửa, nhưng crash quá ~14 trang | (chưa kiểm thử lại) | (chưa kiểm thử lại) | (chưa kiểm thử lại) |
| docling + EasyOCR, theo từng trang | (chưa kiểm thử lại) | ✅ dấu đã sửa, hoàn tất đáng tin cậy (295/295 trang trên 11 tài liệu — xem Độ tin cậy); lỗi thứ tự từ vẫn mở | (chưa kiểm thử lại) | (chưa kiểm thử lại) | (chưa kiểm thử lại) |

### Độ chính xác (dấu tiếng Việt + độ trung thực của bảng)

| Mục | Văn bản digital-native | Văn bản PDF scan | Độ trung thực của bảng |
|---|---|---|---|
| pdf-inspector | Chính xác, đầy đủ | Không áp dụng — nhận diện đúng "cần OCR," không thử xử lý | Thường đúng; có rủi ro false-positive trên layout phức tạp (xem Vấn đề), có thể dự đoán qua `is_complex_layout` |
| markitdown | Chính xác, đầy đủ | Lỗi âm thầm — 0 ký tự, không lỗi | Không áp dụng (không trích xuất bảng có cấu trúc) |
| MinerU | Chính xác, đầy đủ | Cấu trúc đúng; dấu bị lỗi nghiêm trọng | Đúng dữ liệu, nhưng là HTML `<table>` thô nằm trên một dòng dài, không phải cú pháp Markdown |
| docling (mặc định) | Chính xác, đầy đủ | Cấu trúc đúng; dấu bị lỗi nghiêm trọng | Đúng — pipe-table Markdown gốc sạch sẽ khi không crash |
| docling + EasyOCR, cả tài liệu | (chưa kiểm thử lại) | **Dấu đúng** trên các trang đã hoàn tất; có lỗi thứ tự từ mới tại các điểm xuống dòng | Chưa đánh giá trong đợt này (crash trước khi tới trang có bảng) |
| docling + EasyOCR, theo từng trang | (chưa kiểm thử lại) | **Dấu đúng**, đã xác nhận trên nhiều tài liệu lên tới 46 trang; cùng lỗi thứ tự từ, mang tính cục bộ theo trang, xác nhận không đổi ở quy mô lớn | Chưa đánh giá trong đợt này |

Một rủi ro khác phát hiện được cụ thể trên trường hợp digital-native: bộ nhận diện bảng theo heuristic
của pdf-inspector tạo ra một pipe-table sai lệch, lệch hàng trên phần văn xuôi hai cột thông thường
trong một luật thuế GTGT — không chỉ đơn thuần là "không trả về gì" khi gặp thứ không phải bảng, nó có
thể tự tin xuất ra một bảng sai (xem Vấn đề để biết cách khắc phục bằng `is_complex_layout`). Riêng câu
hỏi về mã hóa RTF cũ mà đợt đánh giá này đặt ra để kiểm chứng (có công cụ nào giải mã đúng font
`.VnTime`/TCVN3 8-bit sang Unicode không?) chưa từng thực sự được kiểm chứng — ba trong bốn công cụ gốc
từ chối RTF hoàn toàn, còn công cụ duy nhất báo `status: ok` (markitdown) lại không hề phân tích file
đó, chỉ đơn giản lặp lại nguyên byte thô của nó.

### Độ tin cậy khi mở rộng quy mô

| Mục | Số lượt thử | Hoàn tất sạch sẽ | Kiểu lỗi đã biết |
|---|---|---|---|
| pdf-inspector | 52 | 51 (1 bị từ chối đúng cách vì input hỏng) | Không có — "lỗi" duy nhất là phản ứng *đúng* trước một input thực sự bị hỏng (file RTF gán nhầm nhãn); đây là công cụ duy nhất trong bốn công cụ không âm thầm xử lý sai file đó cũng không crash trên nó |
| markitdown | 56 | 54 báo `status: ok` (2 bị từ chối rõ ràng, đúng cách) | 46/56 âm thầm trả về rỗng trên PDF scan; 2/2 âm thầm đổ mã nguồn RTF (xem Vấn đề) — không crash nào |
| MinerU | 14 | **14/14 (100%)** | Không có — không crash qua cả hai đợt lấy mẫu, kể cả tài liệu 65 trang |
| docling (mặc định) | 17 lượt thử, 14 xử lý được | 14/14 báo `status: ok`, nhưng chỉ 9/14 (64%) thực sự khớp với nội dung kỳ vọng | 5/14 (36%) có mất nội dung; 3/14 (21%) mất trên 50%, một cách âm thầm, qua `bad_alloc` |
| docling + EasyOCR, cả tài liệu | 1 tài liệu | 0/1 | Crash ở trang cuối cùng, không có output |
| docling + EasyOCR, theo từng trang | 11 tài liệu, 295 trang | **295/295 trang (100%)** | Không có — không crash nào, kể cả trên chính 2 tài liệu (37 trang, 46 trang) từng crash dưới docling mặc định trong cùng bảng này |

### Tốc độ (chỉ chạy CPU, thời gian thực)

| Mục | Tổng thời gian | Tổng số ký tự thu được | Ghi chú |
|---|---|---|---|
| pdf-inspector | Không đáng kể (dưới 100ms/tài liệu, tối đa ~0,23s khi tạo markdown thật) | — | Gần như miễn phí so với năm mục còn lại |
| markitdown | 48,4s trên 56 tài liệu | — | Nhanh vì nó làm rất ít trên input dạng scan (không OCR) |
| MinerU | 3.231,3s (~53,9 phút) trên 14 tài liệu | 821.861 | Chậm hơn docling mặc định 2–5 lần; không có công sức lãng phí — mọi ký tự thu được đều là thật |
| docling (mặc định) | 1.715s (~28,6 phút) trên 14 tài liệu xử lý được | 653.412 | Nhanh trên từng tài liệu, nhưng một phần đáng kể cả thời gian lẫn số ký tự bị dùng cho các tài liệu âm thầm mất nội dung |
| docling + EasyOCR, cả tài liệu | Chưa từng hoàn tất (crash) | 0 | — |
| docling + EasyOCR, theo từng trang | 4.438,4s (~74,0 phút) trên tập con 11 tài liệu/295 trang | 635.174 | Chậm hơn docling mặc định khoảng 2,8 lần tính chung trên đúng 11 tài liệu đó (1.564,8s) — nhưng tỷ lệ này thực ra còn đánh giá thấp mức chênh lệch thật, vì một phần thời gian "nhanh" của docling mặc định trên 2 tài liệu nó từng crash chỉ nhanh vì nó dừng sớm, không phải vì hoàn tất. Tốc độ mỗi trang biến động rất lớn theo tài liệu: khoảng 1,1–1,3s/trang trên các tài liệu có lớp văn bản thật (docling có vẻ bỏ qua bước OCR thật sự ở đó dù đã cấu hình EasyOCR), khoảng 17–28s/trang trên các tài liệu scan thật sự, và một tài liệu chậm bất thường (~41,6s/trang) dưới cả hai cấu hình — xem phần Vấn đề |

### Độ phức tạp khi cài đặt

| Mục | Cài đặt | Bẫy thật sự đã gặp |
|---|---|---|
| pdf-inspector | `pip install pdf-inspector` | Không có — đơn giản nhất trong sáu mục, bỏ xa các mục còn lại |
| markitdown | `pip install markitdown[pdf,docx]` | Extra `[all]` bị hỏng trên PyPI (do pin dependency sai) — chỉ nên cài đúng extras cần thiết |
| MinerU | `pip install mineru[core]` trong một venv Python <3.14 riêng | Giới hạn phiên bản Python cứng (nhưng pip báo lỗi rõ ràng/ngay lập tức); bản cài nặng nhất về dung lượng tải (kèm cả giao diện web Gradio đầy đủ dù chỉ dùng CLI) |
| docling (mặc định) | `pip install docling` | Cần `TORCHDYNAMO_DISABLE=1` hoặc một trình biên dịch MSVC mới chạy được trên Windows; ngôn ngữ OCR mặc định sai đối với tiếng Việt một cách âm thầm |
| docling + EasyOCR, cả hai cấu hình | Thêm `pip install easyocr`, đặt `ocr_options = EasyOcrOptions(lang=['vi'])` | Cùng các bẫy của docling ở trên, cộng thêm: EasyOCR tự tải model nhận diện/nhận dạng của riêng nó khi dùng lần đầu |

### Khả năng tương thích với parser

Tình huống giống hệt nhau trên cả sáu mục, nên một dòng là đủ: output Markdown của mọi công cụ đều thêm
tiền tố `#`/`##` trước tiêu đề, điều mà regex dựa trên dòng hiện tại của `document-node.parser.ts` hoàn
toàn không khớp — xem phần Vấn đề để biết giải thích đầy đủ. Đây không phải yếu tố phân biệt giữa các
mục; đây là công việc xây dựng lớp tiền xử lý bắt buộc, bất kể mục nào được chọn.

## Đánh giá tổng thể và kết luận

Vấn đề OCR PDF scan — lý do thực sự khiến phương án chinhphu.vn+OCR được cân nhắc — quy về một sự thật:
**kho dữ liệu này trên 92% là PDF tiếng Việt dạng scan, và không có cấu hình OCR mặc định nào của bất
kỳ công cụ nào cho ra văn bản dùng được.** Dấu tiếng Việt mang ý nghĩa ngữ nghĩa
(`ma`/`má`/`mà`/`mã`/`mạ` là năm từ khác nhau), nên một pipeline hoàn tất đáng tin cậy nhưng cho ra dấu
sai (MinerU, docling mặc định) thực ra không hữu ích hơn một pipeline không đáng tin cậy — cả hai đều
không dùng được cho trường hợp chiếm đa số của kho dữ liệu này, chỉ theo hai cách khác nhau.

Việc sửa ngôn ngữ OCR chỉ khả thi với đúng một trong hai ứng viên. OCR engine của MinerU là một hệ thống
đóng kín — đã xác nhận bằng cách đọc mã nguồn của nó, không phải suy đoán — nên không có con đường nào,
đã kiểm thử hay sẵn có, dẫn tới hỗ trợ tiếng Việt cho nó. OCR engine của docling thực sự có thể hoán đổi,
và EasyOCR(`lang='vi'`) là một cách khắc phục thật, đã được xác minh cho nửa vấn đề về độ chính xác ký
tự. Nhưng bản thân cách khắc phục đó lại khiến điểm yếu đã biết khác của docling (crash `bad_alloc`) tệ
hơn, không phải tốt hơn — cho tới khi kết hợp với việc xử lý theo từng trang, giúp sửa hoàn toàn crash đó
mà không ảnh hưởng tới cách sửa dấu. Cách sửa đó không phải một may mắn ngẫu nhiên trên một tài liệu: xác
nhận lần đầu trên một tài liệu 15 trang (15/15 trang), sau đó xác nhận lại trên toàn bộ tập con độ tin
cậy 11 tài liệu/295 trang (295/295 trang, không crash nào, kể cả trên chính hai tài liệu từng crash dưới
docling mặc định). Tổ hợp EasyOCR(vi) + theo từng trang là cấu hình đã kiểm thử duy nhất, trong cả sáu
mục của đợt đánh giá này, cho ra văn bản tiếng Việt đúng *và* hoàn tất một cách đáng tin cậy, và kết luận
đó giờ dựa trên bằng chứng từ 295 trang, không phải một tài liệu. Nó chưa được giải quyết hoàn toàn: vẫn
còn một lỗi thứ tự từ riêng biệt tại các điểm xuống dòng (xác nhận không đổi ở quy mô lớn hơn), và cấu
hình này chậm hơn docling mặc định một cách đáng kể — khoảng 2,8 lần tính chung, dù tỷ lệ đó thực ra còn
đánh giá thấp khoảng cách thật, vì số liệu của docling mặc định trên hai tài liệu nó từng crash trông
nhanh một cách giả tạo do nó dừng sớm chứ không phải vì hoàn tất. Tốc độ cũng phụ thuộc rất nhiều vào
tài liệu: các trang có sẵn lớp văn bản xử lý nhanh hơn 15–20 lần so với các trang scan thật sự, vì
docling có vẻ bỏ qua bước OCR thật sự trên chúng ngay cả khi đã cấu hình EasyOCR — nên chi phí thực tế
của cấu hình này thấp hơn con số kịch bản-xấu-nhất gợi ý, đối với một kho dữ liệu không phải 100% scan.
Cả hai vấn đề mở đều có phạm vi rõ ràng với các bước tiếp theo cụ thể (xem Khuyến nghị), không phải lý do
để từ bỏ hướng tiếp cận này.

Ngoài câu hỏi về OCR, hai điều sau đúng bất kể chọn công cụ nào: 37% kho dữ liệu `laws/` hiện có
(`.doc` + `.rtf`) không được công cụ nào đã kiểm thử xử lý và cần một bước chuyển đổi LibreOffice riêng
chưa tồn tại, và `document-node.parser.ts` cần một lớp tiền xử lý (bỏ cú pháp tiêu đề Markdown, phân
tích pipe-table gốc) trước khi có thể tiêu thụ output từ bất kỳ công cụ nào trong số này — công việc bắt
buộc dù theo hướng nào, không phải chi phí riêng của hướng được khuyến nghị.

## Khuyến nghị

### Lựa chọn cốt lõi: docling + EasyOCR(`lang='vi'`), chạy theo từng trang, cho mọi thứ cần OCR

Đây là cấu hình đã kiểm thử duy nhất thỏa mãn đồng thời cả hai yêu cầu bắt buộc — văn bản tiếng Việt
đúng và hoàn tất một cách đáng tin cậy (xem Chỉ số và Đánh giá tổng thể ở trên).

Vẫn còn một lỗi đã biết chưa được xử lý, và đây là lỗi về tính đúng đắn của nội dung, không phải điều mà
việc viết lại parser có thể tự bù đắp: các từ bị đẩy ra cuối dòng khi một câu bị ngắt giữa dòng. Hai
hướng rẻ tiền đáng thử trước khi viết code tùy chỉnh:

1. Đổi `EasyOcrOptions` sang `TesseractOcrOptions` — docling hỗ trợ sẵn, và cách phân tích layout của
   Tesseract khác đủ nhiều so với EasyOCR nên có thể không mắc phải lỗi này.
2. Nếu không, cách sửa nhiều khả năng là sắp xếp lại có mục tiêu các phần tử văn bản của docling theo vị
   trí bounding-box (trên-xuống-dưới, trái-sang-phải) trước khi gọi `export_to_markdown()` —
   `result.document` đã sẵn có dữ liệu bbox, và lỗi này trông giống như nằm ở cách export markdown sắp
   xếp thứ tự, không phải ở bản thân bước OCR.

### pdf-inspector làm công cụ chính cho mọi thứ *không* cần OCR

pdf-inspector thắng ở mọi chỉ số quan trọng cho trường hợp phổ biến — chi phí, tốc độ, và độ chính xác
trên văn bản thực sự tồn tại sẵn — nên nó nên đóng vai trò định tuyến, không chỉ là một trong sáu mục
ngang hàng:

1. **Luôn phân loại trước.** `<100ms`, nhận diện đúng scan-vs-digital trên toàn bộ 52 lượt thử PDF
   trong đợt đánh giá này. Chỉ trả chi phí cho docling+EasyOCR trên những tài liệu/trang nó thực sự đánh
   dấu là cần OCR.
2. **Tin tưởng trực tiếp output markdown của nó khi `pages_needing_ocr == 0` và
   `is_complex_layout == false`.** False-positive về bảng phát hiện được trong đợt đánh giá này tương
   quan đúng 4/4 với `is_complex_layout` — một tín hiệu pdf-inspector đã tự tính sẵn miễn phí (xem Vấn
   đề).
3. **Khi `is_complex_layout == true`, đừng tin tưởng output bảng một cách mù quáng.** Cho các phần có
   bảng đi qua docling để đối chiếu chéo, hoặc đánh dấu để rà soát theo đúng mô hình mà dự án này đã
   dùng trong `docs/monitoring/law-index-flagged-documents.md`. Điều này không loại pdf-inspector khỏi
   vai trò công cụ chính — không mục nào trong sáu mục hoàn toàn không cần giám sát ở bất kỳ đâu trong
   đợt đánh giá này — nó chỉ có nghĩa là đường xử lý chính cần một lớp bảo vệ, không phải không cần gì
   cả.

### markitdown: vai trò hẹp nhưng có thật — chỉ dành cho `.docx`

pdf-inspector hoàn toàn không đụng đến `.docx`, và không có lý do gì để chạy thêm một công cụ thứ hai
trên một PDF mà pdf-inspector đã xử lý sạch sẽ. Vai trò của markitdown thu hẹp lại đúng vào khoảng
trống đó: công cụ chính cho `.docx` (chính xác và nhanh ở mọi lần kiểm thử), không gì khác. Các kiểu lỗi
của nó trên PDF scan và RTF khiến nó bị loại ở mọi trường hợp còn lại.

### `.doc` / `.rtf`: vẫn chưa giải quyết được, vẫn là một hạng mục công việc riêng

Không công cụ nào xử lý được các định dạng này — khuyến nghị này không thay đổi điều đó. Một bước
chuyển đổi trước sang `.docx`/`.pdf`, đặt trước toàn bộ pipeline nêu trên, vẫn là điều kiện tiên quyết.
**Chưa được cài đặt hay kiểm thử trên máy này — phần này là một khuyến nghị cần xác minh, không phải một
kết quả để tin tưởng mù quáng, khác với phần còn lại của báo cáo này.**

**Được khuyến nghị: chuyển đổi bằng LibreOffice ở chế độ headless**
(`soffice --headless --convert-to docx file.doc`, hoặc `--convert-to pdf`). Nó đọc trực tiếp được cả
`.doc` nhị phân cũ lẫn `.rtf`, miễn phí, và là một trong những triển khai mã nguồn mở được kiểm chứng
kỹ lưỡng nhất cho khả năng tương thích với các định dạng MS Office cũ. Có hai điều cần làm đúng, không
chỉ đơn giản là "cài vào rồi xong":

- **Đừng khởi tạo một tiến trình `soffice` mới cho mỗi file.** Gọi CLI riêng cho từng file phải trả chi
  phí khởi động thật sự (~2–5s), và các lệnh gọi đồng thời có thể gặp xung đột khóa profile người dùng —
  cách này không mở rộng tốt cho một kho dữ liệu cỡ này. Thay vào đó, nên chạy nó như một listener
  thường trực: hoặc dùng `unoconv` (một wrapper giao tiếp với một instance LibreOffice chạy dài hạn qua
  API UNO của nó), hoặc dùng chế độ socket `--accept` sẵn có của chính LibreOffice.
- **Xác minh nó giải mã đúng cách mã hóa tiếng Việt cũ của kho dữ liệu này trước khi tin tưởng.** Mẫu
  `.rtf` trong đợt đánh giá này dùng font `.VnTime`/`.VnTimeH` — mã hóa TCVN3/VNI 8-bit, không phải
  Unicode. Việc "LibreOffice hỗ trợ RTF" không tự động đồng nghĩa với việc nó ánh xạ đúng bộ font 8-bit
  cũ đó sang dấu tiếng Việt Unicode chuẩn khi xuất ra. Đây là một rủi ro thật, có thể kiểm chứng, đặc thù
  của dự án này, không phải điều nên mặc định đúng chỉ vì LibreOffice hỗ trợ định dạng nói chung — đúng
  kiểu khẳng định mà đợt đánh giá này, ở mọi chỗ khác, đã xác minh trực tiếp thay vì tin theo lời đồn.

**Các phương án thay thế, kèm đánh đổi thẳng thắn, nếu LibreOffice không hiệu quả:**

- **Aspose.Words** (thư viện thương mại .NET/Java/Python) — nhìn chung là công cụ chuyển đổi định dạng
  cũ có độ trung thực cao nhất hiện có, không phụ thuộc LibreOffice/Word, nhưng tốn phí, khác với mọi
  công cụ khác đã đánh giá trong báo cáo này.
- **MS Word qua COM automation** (`pywin32`) — độ trung thực gốc vì chính là chủ sở hữu định dạng, nhưng
  cần một bản cài Word có bản quyền thật trên máy và khá mong manh khi tự động hóa trên server không có
  người giám sát.
- **Pandoc** — xử lý `.rtf` tương đối ổn, nhưng khả năng hỗ trợ định dạng `.doc` *nhị phân* cũ làm input
  là điều chưa chắc chắn và chưa được kiểm chứng ở đây; đừng mặc định nó hoạt động mà chưa kiểm thử,
  giống như độ trung thực RTF của LibreOffice ở trên cũng cần kiểm thử.

Bước tiếp theo cụ thể, chưa thực hiện: cài LibreOffice, chạy nó trên các mẫu `.doc`/`.rtf` thật của dự
án này, và kiểm tra riêng xem mẫu `.rtf` mã hóa TCVN3/VNI có được giải mã đúng sang tiếng Việt Unicode
hay không — trước khi biến nó thành một phần được tin tưởng của pipeline.

### Điều này giải quyết gì cho việc viết lại parser

Vì parser đang được viết lại để tiêu thụ Markdown thay vì văn bản phẳng đã scrape của vbpl.vn, kiến trúc
này xác định rõ hình dạng cụ thể mà parser mới cần xử lý:

- Loại bỏ tiền tố `#+\s*` trước khi khớp với `Điều`/`Chương`/v.v. — mọi công cụ đã kiểm thử đều thêm
  tiền tố tiêu đề theo cách này, không phải một đặc thù riêng của docling.
- Phân tích các pipe-table Markdown gốc (`| ... |`) thành các ô có cấu trúc — đây là hình dạng bảng cụ
  thể của docling. (Của MinerU là HTML `<table>` thô nhúng trực tiếp — một nhánh hoàn toàn khác; không
  cần thiết cho khuyến nghị này, nhưng đáng để thiết kế lớp tiêu thụ bảng có nhận biết trước hình dạng
  đó, phòng khi sau này quay lại xem xét MinerU.)
- Đừng giả định thứ tự dòng là thứ tự đọc đối với nội dung có nguồn từ OCR cho tới khi lỗi thứ tự từ nói
  trên thực sự được khắc phục — đáng để có một bước kiểm chứng (ví dụ: đối chiếu các câu đã tái dựng với
  một danh sách cụm từ đã biết là đúng) trước khi tin tưởng hoàn toàn output docling+EasyOCR theo từng
  trang khi đưa vào production.

## Các file liên quan

- `samples/`, `samples2/`, `samples2_ocr_subset/` — các tài liệu nguồn (không commit vào git, là bản
  sao của dữ liệu `laws/` vốn cũng đã không được commit)
- `outputs/<tool>/`, `outputs2/<tool>/` — output `.md` của mỗi công cụ cho từng mẫu + `_timings.json`
- `scripts/run_*.py` — các harness dùng để chạy chuyển đổi xuyên suốt đợt đánh giá
- `.venv-mineru/` — môi trường Python 3.12 riêng của MinerU (không commit vào git)
