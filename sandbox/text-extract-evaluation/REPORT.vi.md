# Đánh giá công cụ trích xuất văn bản: docling vs. markitdown vs. pdf-inspector vs. MinerU

Đánh giá các công cụ này với vai trò ứng viên chuyển đổi PDF/DOCX/RTF/DOC → Markdown cho pipeline
dự phòng chinhphu.vn+OCR (dùng khi một citation bị thiếu trên vbpl.vn). Nhánh: `evaluate/document-parser`.
Hai đợt: vòng 1 (6 tài liệu chọn thủ công, đa dạng định dạng — PDF/DOCX/RTF/DOC) và vòng 2 (50 tài liệu
PDF bổ sung, phân tầng theo tier/năm/kích thước, vì PDF là định dạng mà tài liệu mới thực sự xuất hiện).

## Tóm tắt điều hành

|                                               | pdf-inspector                                                                                                | markitdown                                                                                                                                  | docling                                                                                                                                                                                                                                                                                | MinerU                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vai trò**                            | Bộ định tuyến sơ bộ miễn phí: phân loại text-vs-scanned trong <100ms trước khi tốn chi phí OCR | Đường xử lý nhanh cho input thực sự sạch (PDF digital, docx)                                                                        | Ứng viên OCR chủ lực — output có hình thức tốt nhất, độ tin cậy tệ nhất                                                                                                                                                                                                 | Ứng viên OCR chủ lực — chậm nhất, nhưng đáng tin cậy nhất                                                                            |
| **OCR tiếng Việt**                    | Không áp dụng, không bao giờ thực hiện OCR                                                            | Không áp dụng, không bao giờ thực hiện OCR                                                                                           | **Hỏng** — RapidOCR không có tiếng Việt trong danh sách ngôn ngữ; đã thử chinese/latin/en, cả ba đều làm sai lệch dấu                                                                                                                                          | **Hỏng** — cùng một lỗi, được xác nhận độc lập; danh sách ngôn ngữ của MinerU cũng không có tiếng Việt               |
| **Độ tin cậy khi mở rộng quy mô** | Không lỗi trong tổng 56 tài liệu                                                                        | Không crash; nhưng âm thầm trả về rỗng trên PDF scan và âm thầm làm hỏng nội dung trên RTF                                   | **`std::bad_alloc` từ khoảng trang thứ 14 trở đi**, càng về sau trong một phiên chạy càng tệ hơn — âm thầm cắt cụt output trong khi vẫn báo cáo thành công (đã xác nhận: tài liệu 46 trang bị cắt giữa câu ở trang 14, không có báo lỗi) | Không crash trên cùng bộ 11 tài liệu, kể cả tài liệu 65 trang; đã xác minh output đi đến đúng phần cuối của tài liệu gốc |
| **Phạm vi hỗ trợ định dạng**      | Chỉ PDF                                                                                                     | PDF, docx; từ chối gọn gàng với .doc; lỗi**thảm khốc** âm thầm với RTF (đổ nguyên văn source như thể "thành công") | PDF, docx; từ chối tường minh với RTF; lỗi cứng với .doc                                                                                                                                                                                                                       | PDF, image, docx, pptx, xlsx; không thử với .doc/.rtf                                                                                         |
| **Tốc độ (chỉ chạy CPU)**          | ~miễn phí (<100ms)                                                                                         | Nhanh khi nó thực sự làm gì đó (không tốn chi phí OCR)                                                                            | Nhanh*khi mọi thứ suôn sẻ*, nhưng biến động rất lớn (có trường hợp ngoại lệ 688 giây) và tự làm giảm giá trị số liệu của chính mình do cắt cụt âm thầm                                                                                               | Luôn là chậm nhất, gấp 2–5× docling — nhưng thực sự hoàn tất tài liệu                                                             |
| **Độ phức tạp khi cài đặt**      | Đơn giản nhất — một wheel duy nhất, không có model                                                  | Nhẹ, nhưng extra`[all]` đang bị hỏng trên PyPI                                                                                      | Nhiều bẫy nhất: cần`TORCHDYNAMO_DISABLE=1` hoặc MSVC; sai ngôn ngữ OCR mặc định một cách âm thầm                                                                                                                                                                       | Cần venv Python <3.14 riêng; tải về nặng nhất; cùng khoảng trống về ngôn ngữ OCR                                                     |

**Kết luận chính:** không công cụ nào trong bốn công cụ này sẵn sàng triển khai ngay cho trường hợp
chiếm đa số thực tế của kho dữ liệu này — PDF tiếng Việt dạng scan (94% số PDF trong kho dữ liệu theo
vòng 2). pdf-inspector và markitdown là những khối xây dựng vững chắc, rủi ro thấp cho đúng phần việc
chúng phù hợp (định tuyến, và trích xuất văn bản sạch). Giữa hai ứng viên có khả năng OCR, MinerU là lựa
chọn mặc định an toàn hơn *ở thời điểm hiện tại* dù chậm hơn nhiều — một kết quả trông có vẻ đúng nhưng
âm thầm mất hai phần ba nội dung tài liệu còn tệ hơn một kết quả chậm nhưng đúng. Vòng 3–4 (bên dưới) đã
thử các cách khắc phục hiển nhiên trên docling (MinerU không thể đổi OCR engine, vì lý do kiến trúc):
chuyển sang EasyOCR(vi) thực sự sửa được lỗi dấu ở mức ký tự nhưng lại sinh ra lỗi đảo thứ tự từ mới và
khiến crash `bad_alloc` *tệ hơn*; chia nhỏ theo từng trang sau đó sửa được crash (0 → hoàn tất 15/15 trang)
nhưng để nguyên lỗi thứ tự từ. **Trong cả bốn cấu hình docling đã thử (mặc định, mặc định+quy mô vòng 2,
+EasyOCR toàn văn bản, +EasyOCR theo từng trang), không cấu hình nào vừa nhanh, vừa đáng tin cậy, vừa
chính xác về ký tự — mỗi cách sửa đều đánh đổi lỗi này lấy lỗi khác.** Ngoài ra, bất kể chọn công cụ nào:
~37% kho dữ liệu `laws/` hiện có (.doc + .rtf) không được công cụ nào trong bốn công cụ này xử lý, và
`document-node.parser.ts` cần một lớp tiền xử lý (bỏ cú pháp tiêu đề Markdown) trước khi có thể tiêu thụ
output của bất kỳ công cụ nào trong số này.

## Thiết lập

**venv chính (`.venv/`, Python 3.14.4, gốc repo)** — đã có sẵn `docling`, một bản `markitdown` cũ
(0.0.2), `torch` (bản CPU), và `pdfminer.six` được cài trước khi đợt đánh giá này bắt đầu. Đã bổ sung:

- Nâng cấp `markitdown` từ 0.0.2 → 0.1.7, chỉ giới hạn extras `[pdf,docx]`. `markitdown[all]==0.1.7`
  hiện đang **bị hỏng trên PyPI** — nó ghim `youtube-transcript-api~=1.0.0`, mà không có bản phát hành
  nào trong đúng dải đó tồn tại (các phiên bản đã công bố nhảy từ 0.6.2 → 1.2.3). Cài `[all]` sẽ thất
  bại hoàn toàn; chỉ nên cài đúng những extras thực sự cần.
- `pdf-inspector` 0.2.7 — cài sạch, không vấn đề gì (wheel PyO3/Rust, `cp38-abi3`, nên không phụ thuộc
  phiên bản Python cụ thể; là công cụ duy nhất trong bốn công cụ cài được trên Python 3.14 mà không có
  lưu ý nào).

**venv thứ hai (`sandbox/text-extract-evaluation/.venv-mineru/`, Python 3.12.1)** — `mineru` giới hạn ở
`Requires-Python >=3.10,<3.14`, nên hoàn toàn không cài được vào venv 3.14 chính (pip báo lỗi ngay lập
tức và rõ ràng). Đã dùng `py -0p` để tìm bản cài Python 3.12 sẵn có (`C:\Python312`) và tạo một venv
riêng ở đó. Đã cài `mineru[core]` 3.4.4.

**Cả docling và MinerU đều chỉ chạy trên CPU.** Máy này có RTX 3060 (6GB VRAM, driver 596.36,
CUDA 13.2), nhưng `pip install torch` trên nền tảng/index này lại trả về bản wheel chỉ-chạy-CPU
(`torch-2.13.0+cpu`) ở *cả hai* venv — muốn dùng GPU cần một bước cài đặt tường minh trỏ vào index CUDA
(`--index-url https://download.pytorch.org/whl/cu...`) mà đường cài đặt mặc định của cả hai công cụ
đều không tự thiết lập. Toàn bộ số liệu thời gian bên dưới đều chỉ chạy CPU; thứ hạng giữa docling/MinerU
cụ thể có thể thay đổi nếu chạy GPU.

**Vướng mắc riêng của docling:** pipeline mặc định gọi `torch.compile` (TorchInductor), việc này cần
một trình biên dịch C++ của MSVC (`cl.exe`) — không có sẵn trên máy này, và nó lỗi cứng
(`InvalidCxxCompiler`) thay vì tự động chuyển sang phương án khác. Đã khắc phục bằng
`TORCHDYNAMO_DISABLE=1` (ép chạy ở chế độ eager). Nếu không có biến môi trường đó, docling hoàn toàn
không chạy được trên một máy Windows mới không cài Visual Studio Build Tools.

**Mẫu thử** (`samples/`, sao chép từ `laws/`, không commit vào git — xem `.gitignore`): chọn theo tiêu
chí đa dạng định dạng × nội dung, không chọn ngẫu nhiên —

| #  | Tài liệu                       | Định dạng  | Lý do chọn                                                                                                                                                              |
| -- | -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 | 48/2024/QH15 (Luật Thuế GTGT)  | PDF, 20 trang | Digital-native — đã xác nhận có lớp text thật qua`pypdfium2`                                                                                                    |
| 02 | 109/2025/QH15 (Luật Thuế TNCN) | PDF, 15 trang | Đã xác nhận**không có** lớp text nào (scan thật sự) qua `pypdfium2`; có bảng biểu thuế lũy tiến — trường hợp khó nhất (vừa OCR vừa bảng) |
| 03 | 57/2010/QH12 (Luật Thuế BVMT)  | .doc cũ      | Nhỏ, có bảng khung thuế suất riêng                                                                                                                                  |
| 04 | 01/2002/QH11 (Luật Ngân sách) | .doc cũ      | Văn xuôi thuần, không có bảng                                                                                                                                       |
| 05 | Hiến pháp 1980                 | .rtf          | Dùng font`.VnTime`/`.VnTimeH` — mã hóa tiếng Việt 8-bit kiểu TCVN3/VNI cũ, không phải Unicode                                                               |
| 06 | 248/2025/QH15                    | .docx         | Chuẩn Office XML hiện đại                                                                                                                                             |

## Tổng quan mẫu thử nghiệm (hợp nhất vòng 1 + vòng 2)

**Tổng cộng 56 tài liệu, không trùng lặp giữa hai vòng** (vòng 2 đã chủ động loại trừ 2 PDF đã dùng ở
vòng 1 khi lấy mẫu từ `laws/manifest.json`).

| | Số lượng |
|---|---|
| Vòng 1 (chọn thủ công, đa dạng định dạng) | 6 — 2 PDF, 2 `.doc` cũ, 1 `.rtf`, 1 `.docx` |
| Vòng 2 (phân tầng, chỉ PDF) | 50 |
| **Tổng cộng** | **56** |
| Số citation riêng biệt | 56 (mỗi mẫu là một tài liệu khác nhau) |
| Các tier xuất hiện | `01-hien-phap`, `02-luat-nghi-quyet-quoc-hoi`, `03-phap-lenh-nghi-quyet-ubtvqh` |
| Khoảng năm (vòng 2) | 2005–2026 |
| Khoảng kích thước (vòng 2) | 33KB – 21,5MB |
| Được dùng trong tập con OCR chuyên sâu cho docling/MinerU (vòng 2–4) | 11 trong số 50 mẫu vòng 2, cộng thêm mẫu 02 của vòng 1 (mẫu được dùng lại xuyên suốt vòng 3–4 cho các bài kiểm thử EasyOCR) |

### Vòng 1 (6 tài liệu) — chọn để đa dạng định dạng, không nhằm mục đích đại diện

Lặp lại từ phần Thiết lập để tiện tham chiếu ở một chỗ; xem phần đó để biết lý do chọn đầy đủ.

| # | Tài liệu | Định dạng | Tình trạng scan | Ghi chú |
|---|---|---|---|---|
| 01 | 48/2024/QH15 (Luật Thuế GTGT) | PDF, 20 trang | Văn bản digital sạch (đã xác nhận qua `pypdfium2`) | |
| 02 | 109/2025/QH15 (Luật Thuế TNCN) | PDF, 15 trang | Scan hoàn toàn (đã xác nhận qua `pypdfium2`) | Được dùng lại xuyên suốt vòng 3–4 cho mọi bài kiểm thử EasyOCR/theo từng trang — tài liệu đơn lẻ được phân tích sâu nhất trong toàn bộ đợt đánh giá này |
| 03 | 57/2010/QH12 (Luật Thuế BVMT) | `.doc` cũ | Không áp dụng | |
| 04 | 01/2002/QH11 (Luật Ngân sách) | `.doc` cũ | Không áp dụng | |
| 05 | Hiến pháp 1980 | `.rtf` | Không áp dụng | Mã hóa font TCVN3/VNI cũ |
| 06 | 248/2025/QH15 | `.docx` | Không áp dụng | |

### Vòng 2 (50 tài liệu) — phân tầng theo tier/năm/kích thước, chỉ PDF

Lấy từ `laws/manifest.json`, loại trừ 2 PDF đã dùng ở vòng 1. **Tình trạng scan** là kết quả phân loại
của pdf-inspector (xem phần phát hiện của Vòng 2 để biết chi tiết phân tích tỷ lệ scan 92,2%); **tập
con OCR** đánh dấu 11 tài liệu được mang tiếp sang đợt kiểm thử chuyên sâu docling/MinerU ở vòng 2–4.

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
| 42 | 74/2022/QH15 | 02 | 2022 | 5,1MB | Scan hoàn toàn (nhưng có lớp văn bản bị hỏng sẵn — xem phần phát hiện Vòng 2) | |
| 43 | 81/2025/QH15 | 02 | 2025 | 1,1MB | Scan hoàn toàn | |
| 44 | 43/2005/QH11 | 02 | 2005 | 33KB | **Lỗi — thực chất không phải PDF** (bị gán nhầm nhãn, là RTF, xem phần phát hiện Vòng 2) | |
| 45 | 44/2013/QH13 | 02 | 2013 | 2,5MB | Scan hoàn toàn | ✅ |
| 46 | 94/2019/QH14 | 02 | 2019 | 446KB | Scan hoàn toàn | |
| 47 | 85/2015/QH13 | 02 | 2015 | 2,3MB | Scan hoàn toàn | ✅ |
| 48 | 192/2025/QH15 | 02 | 2025 | 420KB | Scan hoàn toàn | |
| 49 | 134/2020/QH14 | 02 | 2020 | 719KB | Scan hoàn toàn | |
| 50 | 106/2016/QH13 | 02 | 2016 | 460KB | Scan hoàn toàn | |

Mã tier: `01` = `01-hien-phap`, `02` = `02-luat-nghi-quyet-quoc-hoi`, `03` = `03-phap-lenh-nghi-quyet-ubtvqh`.
Chi tiết đầy đủ về citation/tiêu đề/đường dẫn nguồn cho từng mẫu vòng 2 nằm trong `samples2/_manifest.json`.

## Phát hiện đầu tiên: không công cụ ML nào OCR được tiếng Việt ngay khi dùng mặc định

Đây là phát hiện quan trọng nhất, vì OCR các PDF scan của chinhphu.vn chính là lý do khiến đợt đánh giá
này tồn tại. Trên mẫu 02 (đã xác nhận là scan, không có lớp text):

- **docling** (backend RapidOCR) đã thử với `lang=['chinese']` (mặc định của chính nó), `['latin']`,
  và `['en']` — cả ba đều tạo ra tiếng Việt bị mất dấu nghiêm trọng: `"Điều"` → `"Điu"`/`"Dièu"`,
  `"được"` → `"đưc"`/`"duoc"`, `"Luật"` → `"Lut"`/`"Luât"`. Đã kiểm tra trực tiếp danh sách ngôn ngữ
  nhận dạng của chính RapidOCR (`rapidocr.LangRec`) — hoàn toàn không có tùy chọn tiếng Việt; gần nhất
  là một model `latin` chung chung, vẫn thất bại nặng nề trước hệ thống dấu dày đặc của tiếng Việt.
- **MinerU** (backend `pipeline`, `-l ch` — tùy chọn duy nhất trong danh sách ngôn ngữ liệt kê ở
  `--help` có vẻ hợp lý nhất; danh sách của MinerU cũng không có tiếng Việt, cũng không có tùy chọn
  latin/en chung chung nào) cho ra **cùng dạng lỗi** trên cùng tài liệu — cùng những từ, cùng bị mất
  dấu thanh.
- Vì lỗi này được xác nhận độc lập trên hai công cụ/hai bộ OCR khác nhau với nhiều cấu hình ngôn ngữ
  khác nhau, đây không phải lỗi do cấu hình sai của người thực hiện — tiếng Việt đơn giản là không phải
  ngôn ngữ được hỗ trợ trong các model OCR đóng gói sẵn của cả hai công cụ.
- **pdf-inspector** và **markitdown** không dính lỗi này vì cả hai đều không thực hiện OCR (xem bên
  dưới) — nhưng điều đó nghĩa là chúng cho ra 0% nội dung dùng được trên input dạng scan, không phải
  một điểm cộng.
- Chưa kiểm thử trong đợt này (do giới hạn thời gian): EasyOCR có liệt kê `'vi'` là ngôn ngữ được hỗ
  trợ và docling có thể dùng nó như một OCR backend có thể thay thế cho RapidOCR — đáng thử trước khi
  loại hẳn docling. Chưa cài trong đợt này.

**Kết luận thực tiễn: dù chọn công cụ nào, cần chủ động gắn thêm một OCR engine có khả năng xử lý tiếng
Việt (EasyOCR với `lang='vi'`, hoặc bộ dữ liệu huấn luyện `vie` của Tesseract) — đường OCR mặc định của
cả docling lẫn MinerU đều không dùng được cho kho dữ liệu này ở cấu hình hiện tại.**

## Chỉ số: độ chính xác (bao gồm độ trung thực của bảng)

|               | Văn bản PDF digital-native | Văn bản PDF scan                                                                               | Bảng trong PDF scan                                                                                                                                               | RTF (mã hóa VNI/TCVN3 cũ)                                                                                                                                                                                                                                                  |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdf-inspector | Chính xác, đầy đủ      | Không áp dụng — nhận diện đúng "cần OCR", không trả về markdown, không thử xử lý | Không áp dụng                                                                                                                                                   | Không áp dụng (công cụ chỉ dành cho PDF)                                                                                                                                                                                                                               |
| markitdown    | Chính xác, đầy đủ      | **Lỗi âm thầm** — báo `status: ok`, 0 ký tự, không lỗi, không cảnh báo       | Không áp dụng                                                                                                                                                   | **Hỏng nội dung âm thầm** — báo `status: ok`, 127.938 ký tự, nhưng "văn bản trích xuất" thực chất là *mã nguồn RTF thô, chưa được phân tích* (`{\rtf1\ansi\ansicpg1252...`), hoàn toàn không phải một tài liệu đã chuyển đổi |
| docling       | Chính xác, đầy đủ      | Cấu trúc (tiêu đề) đúng;**văn xuôi bị lỗi dấu nghiêm trọng** (xem trên)     | **Đúng** — bảng Markdown pipe-table sạch sẽ, đúng số liệu ở đúng ô dù văn bản xung quanh bị lỗi OCR                                       | Không áp dụng — từ chối tường minh`File format not allowed`                                                                                                                                                                                                         |
| MinerU        | Chính xác, đầy đủ      | Cấu trúc đúng;**lỗi dấu giống hệt docling**                                        | **Đúng** — nhưng xuất ra dưới dạng HTML `<table>...</table>` thô nằm trên một dòng rất dài, không phải cú pháp pipe-table của Markdown | Không áp dụng — không nằm trong danh sách định dạng hỗ trợ, tự động bỏ qua                                                                                                                                                                                    |

Một rủi ro thật khác phát hiện được trên PDF digital-native: **bộ nhận diện bảng theo heuristic của
pdf-inspector tạo ra một pipe-table sai lệch, lệch hàng** trên phần văn xuôi hai cột thông thường trong
Luật Thuế GTGT (một cách trình bày phổ biến trong công báo tiếng Việt) — nội dung của các điểm/khoản
không liên quan bị gộp lẫn vào nhau. Đây không chỉ đơn thuần là "không trả về gì" khi gặp thứ không phải
bảng — nó có thể tự tin xuất ra một bảng sai. Cần lưu ý điều này trước khi tin tưởng tuyệt đối vào
`is_complex_layout`/output dạng bảng của công cụ này.

Câu hỏi về mã hóa RTF cũ mà mẫu 05 được chọn riêng để kiểm chứng (có công cụ nào giải mã đúng font
`.VnTime`/TCVN3 8-bit sang Unicode không?) **thực ra chưa từng được kiểm chứng thật sự** — ba trong bốn
công cụ từ chối RTF hoàn toàn, còn công cụ duy nhất báo `status: ok` (markitdown) lại không hề phân
tích tập tin đó, chỉ đơn giản là lặp lại nguyên byte thô của nó.

## Chỉ số: phạm vi hỗ trợ định dạng

| Định dạng  | pdf-inspector                     | markitdown                  | docling                                                                        | MinerU                                             |
| ------------- | --------------------------------- | --------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| PDF (digital) | ✅                                | ✅                          | ✅                                                                             | ✅                                                 |
| PDF (scan)    | ⚠️ chỉ phân loại, không OCR | ❌ âm thầm trả về rỗng | ⚠️ có chạy OCR, văn bản không dùng được                             | ⚠️ có chạy OCR, văn bản không dùng được |
| .docx         | ❌ không phải công cụ cho PDF | ✅                          | ✅                                                                             | ✅                                                 |
| .doc cũ      | ❌                                | ❌ báo lỗi rõ ràng      | ❌ lỗi cứng (dù được liệt kê là một`InputFormat` được hỗ trợ) | ❌ không nằm trong danh sách hỗ trợ           |
| .rtf          | ❌                                | ❌ (âm thầm, xem trên)   | ❌ từ chối tường minh                                                      | ❌ không nằm trong danh sách hỗ trợ           |

**Không công cụ nào trong bốn công cụ xử lý đúng các tập tin `.doc` hoặc `.rtf` cũ của kho dữ liệu này.**
Theo `laws/manifest.json` (tổng 1.155 tài liệu): 191 `.doc` (17%) + 236 `.rtf` (20%) = **37% kho dữ
liệu hiện có** mà các công cụ này không thể xử lý trực tiếp. Một bước chuyển đổi trước bằng
LibreOffice-headless (`--convert-to docx`) sẽ là điều kiện tiên quyết bất kể chọn công cụ nào trong bốn
công cụ này — máy này chưa cài LibreOffice, nên bước đó cũng chưa được xây dựng.

## Chỉ số: thời gian xử lý (chỉ chạy CPU, đơn luồng, thời gian thực)

| Mẫu                        | pdf-inspector            | markitdown              | docling     | MinerU  |
| --------------------------- | ------------------------ | ----------------------- | ----------- | ------- |
| 01 PDF sạch, 20 trang      | 0,08s                    | 5,5s                    | 52,6s       | 236,0s  |
| 02 PDF scan, 15 trang (OCR) | 0,01s (chỉ phân loại) | 0,07s (không làm gì) | 97,0s       | 151,3s  |
| 03 .doc (có bảng)         | không áp dụng         | lỗi, 0,01s             | lỗi, 0,1s  | bỏ qua |
| 04 .doc (văn xuôi)        | không áp dụng         | lỗi, 0,01s             | lỗi, 0,04s | bỏ qua |
| 05 .rtf                     | không áp dụng         | 0,02s (output rác)     | lỗi, 0,0s  | bỏ qua |
| 06 .docx                    | không áp dụng         | 0,59s                   | 1,0s        | 25,2s   |

pdf-inspector gần như miễn phí (không có model ML, dưới 100ms). markitdown nhanh với những gì nó thực
sự làm, nhưng nó làm ít việc hơn nhiều (không OCR, không có model layout thật sự). docling và MinerU
phải trả chi phí ML thật cho mỗi trang (model layout + OCR + nhận dạng cấu trúc bảng); MinerU luôn chậm
hơn docling ở đây, đặc biệt rõ trên file `.docx` đơn giản (25,2s so với 1,0s) — điều này giống như chi
phí cố định cho mỗi lần gọi/tải model trong CLI hơn là công việc thực sự, và chi phí đó sẽ được khấu hao
dần nếu chạy dưới dạng server thường trực thay vì gọi CLI từng lần một (xem bên dưới).

## Chỉ số: hỗ trợ xử lý đồng thời / theo lô

Chưa kiểm thử tải ở quy mô lớn (do giới hạn thời gian) — dựa theo hình dạng API/CLI:

- **pdf-inspector**: các lời gọi Rust không trạng thái, an toàn tuyệt đối khi chạy song song qua
  nhiều luồng/tiến trình.
- **markitdown**: bộ chuyển đổi không giữ trạng thái theo từng lời gọi, an toàn khi chạy song song qua
  nhiều tiến trình; không có trạng thái model thường trực cần lo lắng.
- **docling**: `DocumentConverter` có thể tái sử dụng/gọi lại nhiều lần (chính là cách đã dùng trong
  harness đánh giá này) và API của nó hỗ trợ chuyển đổi theo lô trên một danh sách đường dẫn, model chỉ
  nạp một lần. Muốn mở rộng vượt quá CPU/GPU của một máy nghĩa là phải chạy nhiều tiến trình worker,
  mỗi tiến trình tự trả chi phí bộ nhớ cho model layout+OCR+bảng của riêng nó.
- **MinerU**: có sẵn kiến trúc client/server tường minh — các backend `--api-url` /
  `vlm-http-client` / `hybrid-http-client` được thiết kế cho một server suy luận dùng chung, phục vụ
  nhiều request đồng thời từ các client nhẹ. Đây là một chiến lược đồng thời có chủ đích rõ ràng hơn
  hẳn kiểu "chạy thêm nhiều tiến trình" của docling, và khớp với chi phí cố định ~25s cho mỗi lần gọi
  CLI đã quan sát được ở trên — MinerU có vẻ được thiết kế để chạy như một dịch vụ, không phải gọi
  CLI cho từng tài liệu một.

## Chỉ số: độ phức tạp khi cài đặt

- **pdf-inspector**: `pip install pdf-inspector`. Không phụ thuộc hệ thống, không có model. Đơn giản
  nhất trong bốn công cụ, bỏ xa các công cụ còn lại, và là công cụ duy nhất cài được trên Python 3.14
  mà không có lưu ý nào.
- **markitdown**: `pip install markitdown[pdf,docx]`. Gần như thuần Python, không cần GPU/model. Một
  bẫy thật sự: đừng dùng extra `[all]` (do pin dependency bị hỏng, xem phần Thiết lập ở trên) — chỉ
  cài đúng những extras thực sự cần.
- **docling**: cây dependency nặng nhất (torch, transformers, onnxruntime, rapidocr, docling-ibm-models,
  doclang...). Hai bẫy thật sự gặp phải trong đợt đánh giá này: (1) cần `TORCHDYNAMO_DISABLE=1` hoặc
  một trình biên dịch MSVC mới chạy được trên Windows; (2) ngôn ngữ OCR mặc định sai đối với tiếng Việt
  một cách âm thầm, không cảnh báo.
- **MinerU**: cần một venv Python 3.12 riêng (giới hạn phiên bản cứng, nhưng pip báo lỗi rõ ràng và
  ngay lập tức nên ít nhất cũng dễ nhận ra). Bản cài nặng nhất về dung lượng tải — kèm theo cả một giao
  diện web Gradio đầy đủ dù chỉ dùng CLI thuần túy. Cùng khoảng trống về OCR tiếng Việt như docling,
  cùng việc mặc định chỉ chạy CPU của torch.

## Chỉ số: khả năng tương thích với parser (đối chiếu `document-node.parser.ts`)

Đã đọc trực tiếp mã nguồn của parser thay vì đoán. Đây là một parser **dựa trên dòng văn bản thuần** —
`DIEU_KHOAN_PATTERN = /^Điều\s+(\d+)([a-zđ]?)\s*[.:]?\s*(.*)$/iu` và các pattern tương tự đều được neo
để khớp với một dòng bắt đầu *đúng nguyên văn* bằng `"Điều"`/`"Chương"`/v.v., trên văn bản đã tách theo
`\r?\n`. Parser này được viết dựa trên dữ liệu scrape plain-innerText của vbpl.vn — chưa từng được viết
để xử lý Markdown.

- Cả docling lẫn MinerU đều thêm tiền tố `#`/`##` trước mỗi tiêu đề nhận diện được trong output — đã
  xác nhận bằng cách đọc trực tiếp các file thật: `"## Điều 1. Phạm vi điều chỉnh"`.
  `DIEU_KHOAN_PATTERN` **không** khớp với dòng này (dòng bắt đầu bằng `#`, không phải `Điều`) — parser
  sẽ âm thầm không nhận ra được bất kỳ tiêu đề Điều/Chương nào từ output của cả hai công cụ, cùng kiểu
  lỗi với bug NFD/NFC đã được ghi nhận ở §16 trong
  `docs/monitoring/law-index-flagged-documents.md`.
- Output Markdown của pdf-inspector cũng dùng cùng quy ước đánh dấu tiêu đề — cùng vấn đề.
- Các heuristic ngăn nhận nhầm bảng của parser (`TABLE_HEADER_PATTERN`, `looksLikeTableFragment`, phát
  hiện ký tự tab) được tinh chỉnh cho các dòng bảng dạng *plain-text đã bị làm phẳng* theo hình dạng
  scrape của vbpl.vn. Chúng không áp dụng được cho cả pipe-table của Markdown (docling) lẫn bảng HTML
  nhúng (MinerU) — cả hai đều chỉ đi qua như văn bản thường được gắn thêm vào. Không gây hại chủ động
  (không tạo ra các Khoản giả va chạm nhau), nhưng cấu trúc thật của bảng vẫn vô hình đối với parser dù
  từ nguồn nào; hiện chưa có đường trích xuất bảng thật sự nào ở downstream, bất kể nguồn dữ liệu.
- Một số quy tắc ngăn nhận nhầm hiện có được tinh chỉnh riêng cho cách vbpl.vn hiển thị nội dung và sẽ
  không hoạt động tương tự với Markdown có nguồn từ chinhphu.vn — `AMENDMENT_ANNOTATION_LINE` chính là
  đoạn văn bản UI do vbpl.vn tự chèn vào, và sẽ đơn giản là không bao giờ khớp (vô hại, không phải bug,
  chỉ là không áp dụng được với nguồn mới). Các quy tắc khác (`FOOTER_START_PATTERN`, nhận diện Phụ
  lục) dựa trên quy chuẩn chung (Nghị định 78/2025/NĐ-CP) nên sẽ vẫn áp dụng được bất kể nguồn nào.

**Kết luận: cần một lớp tiền xử lý trước khi `document-node.parser.ts` có thể tiêu thụ output của
*bất kỳ* công cụ nào trong bốn công cụ này** — tối thiểu là loại bỏ tiền tố `#+\s*` ở đầu các dòng tiêu
đề. Đây không phải yếu tố phân biệt giữa bốn công cụ; đây là bước tiếp theo bắt buộc chung, bất kể công
cụ nào thắng cuộc.

## Đánh giá tổng thể

1. **Vấn đề OCR PDF scan — lý do thực sự khiến phương án chinhphu.vn+OCR được cân nhắc — chưa được
   giải quyết bởi bất kỳ ứng viên ML nào ở cấu hình hiện tại.** Cả hai đều thất bại giống hệt nhau
   trước dấu tiếng Việt. Trước khi chọn giữa docling và MinerU theo bất kỳ tiêu chí nào khác, hãy làm
   cho EasyOCR (`lang='vi'`) hoặc Tesseract (`vie`) chạy được dưới một trong hai công cụ và chạy lại
   mẫu 02 — kết quả đó mới là thứ nên quyết định việc chọn công cụ, không phải tốc độ thô hay định
   dạng bảng.
2. **Vai trò thật sự của pdf-inspector không phải là "công cụ chuyển đổi cạnh tranh", mà là một bộ
   định tuyến sơ bộ gần như miễn phí.** Nó phân loại mẫu 01 là dạng text và trích xuất toàn bộ trong
   80ms — docling mất 52,6s và MinerU mất 236s trên cùng file đó. Nên cho mọi PDF đi qua bước phân
   loại `<100ms` của pdf-inspector trước; chỉ trả chi phí cho docling/MinerU trên những trang nó thực
   sự đánh dấu là cần OCR.
3. **37% kho dữ liệu `laws/` hiện có (.doc + .rtf) không được cả bốn công cụ xử lý.** Một bước chuyển
   đổi bằng LibreOffice-headless là điều kiện tiên quyết cho các định dạng đó bất kể công cụ nào được
   chọn ở downstream, và bước đó hiện chưa tồn tại trên máy này.
4. **Hình dạng bảng khác nhau đáng kể giữa hai công cụ có khả năng OCR khi chúng hoạt động đúng**:
   docling → pipe-table Markdown sạch; MinerU → đúng nhưng dưới dạng HTML thô. Không công cụ nào có
   thể dùng trực tiếp với parser hiện tại nếu không có logic xử lý bảng mới, nhưng hình dạng của
   docling gần với thứ mà con người (hoặc một parser biết xử lý bảng trong tương lai) có thể đọc trực
   tiếp hơn.
5. Bất kể công cụ nào được chọn, cần dự trù riêng công việc xây dựng một lớp tiền xử lý cho
   `document-node.parser.ts` (loại bỏ cú pháp tiêu đề Markdown) — đây không phải điều mà output của
   bất kỳ công cụ nào trong bốn công cụ này tự tránh được nhu cầu.

## Vòng 2: 50 mẫu PDF bổ sung

Vòng 1 dùng 6 tài liệu chọn thủ công trải trên 4 định dạng. Vòng 2 bỏ trục định dạng cũ (theo yêu cầu —
.doc/.rtf là định dạng đang mai một/legacy, PDF mới là định dạng mà tài liệu mới thực sự xuất hiện) và
thay vào đó kiểm tra chiều sâu của phạm vi hỗ trợ định dạng: 50 PDF bổ sung, phân tầng theo tier/năm/
kích thước, lấy từ `laws/manifest.json` (loại trừ 2 file đã dùng). Có tổng cộng 719 PDF trong kho dữ
liệu; việc phân tầng ngay lập tức cho thấy **PDF gần như hoàn toàn là hiện tượng của tier 2
(`02-luat-nghi-quyet-quoc-hoi`)** — chỉ có 3 PDF tồn tại ngoài tier đó (2 Hiến pháp, 1 Pháp lệnh) — nên
dù đã cố tình rải việc chọn mẫu trên mọi tier, 47/50 mẫu vẫn thuộc tier 2 do cấu trúc dữ liệu, không
phải do thiên lệch khi chọn. Năm trải từ 2005–2026, kích thước từ 33KB–21,5MB.

### Phát hiện mới: kho dữ liệu này chủ yếu là dạng scan, không phải digital-native

Đã phân loại toàn bộ 50 mẫu bằng pdf-inspector trước tiên (gần như miễn phí, <10ms/tài liệu) trước khi
đầu tư vào các lượt chạy OCR tốn kém. Kết quả: **46 trong số 49 PDF hợp lệ (94%) là dạng scan hoàn
toàn — chỉ 2 tài liệu là văn bản digital-native sạch, 1 tài liệu ở dạng hỗn hợp.** Điều này trực tiếp
mâu thuẫn với giả định "tài liệu mới hơn thì nhiều khả năng là digital-native" vốn là lý do khiến PDF
được chọn để kiểm thử riêng — năm ban hành không dự đoán được điều này; một văn bản luật ban hành năm
2025 (`68/2025/QH15`) vẫn quay về dạng scan hoàn toàn giống như một văn bản năm 2013. **Điều này nâng
mức độ quan trọng của phát hiện đầu tiên ở vòng 1 lên rất nhiều**: nếu ~94% định dạng này cần OCR thật
sự, và cả docling lẫn MinerU đều không OCR đúng được tiếng Việt ở cấu hình mặc định (vòng 1), thì
khoảng trống mặc định đó chặn đứng việc nhập đúng gần như toàn bộ phần PDF của kho dữ liệu này, chứ
không phải một trường hợp biên nhỏ lẻ trong đó.

Một file thất bại ngay ở bước phân loại: `44_...43-2005-QH11.pdf` — `ValueError: Not a PDF: file appears to be JSON`. Đã kiểm tra trực tiếp dữ liệu byte thô: đây không phải PDF cũng không phải JSON,
mà là nội dung **RTF** (`{\rtf1\ansi...`) được lưu dưới tên file `.pdf` — một lỗi có thật trong quá
trình tải/gán nhãn của `laws/`, độc lập với đợt đánh giá này. Bộ nhận diện của pdf-inspector nhiều khả
năng đoán nhầm "JSON" chỉ vì ký tự `{` ở đầu; bộ nhận diện của markitdown (có lẽ là `magika`) nhận đúng
đó là RTF nhưng sau đó lại rơi vào đúng lỗi xử lý RTF đã hỏng từ vòng 1 — đổ nguyên văn mã nguồn RTF ra
như một kết quả "thành công" dài 33.371 ký tự. Đáng ghi chú lại cho người phụ trách
`server/src/law/download` — không thể tin cậy phần mở rộng file cho kho dữ liệu này, và bản thân việc
nhận diện nội dung cũng không hoàn toàn đáng tin (hai bộ nhận diện khác nhau, hai lần đoán sai khác
nhau).

Cũng phát hiện qua markitdown (công cụ không hề OCR, nên bất kỳ output khác rỗng nào trên một tài liệu
bị pdf-inspector đánh dấu "scan" đều nghĩa là có tồn tại một lớp văn bản thật, dù đã bị hỏng):
`42_...74-2022-QH15.pdf` (pdf-inspector: scan hoàn toàn) thực ra có một lớp văn bản nhúng sẵn — nhưng
bản thân lớp đó đã bị hỏng từ trước (`"QUOC HOI CQNG HOa XA HOI CHU NGHIA VIET NAM"`, hoàn toàn không
có dấu). Điều này giống như một lượt OCR chất lượng thấp đã được "nướng sẵn" vào PDF trước khi nó đến
được pipeline này — **một dạng lỗi thứ ba** bên cạnh dạng digital-sạch/cần-OCR: một lớp văn bản *có
tồn tại nhưng không dùng được*, vô hình trước một phép kiểm tra ngây thơ kiểu "có văn bản hay không?",
và sẽ bị bất kỳ công cụ nào (như markitdown) tin tưởng một lớp văn bản có sẵn mà không kiểm chứng nội
dung của nó, đưa thẳng vào chỉ mục một cách âm thầm.

### Phát hiện mới: docling có vấn đề độ tin cậy thật sự ở kích thước tài liệu thực tế; MinerU thì không

Phần so sánh docling/MinerU ở vòng 1 chỉ dùng 6 tài liệu ngắn (tối đa 20 trang) trong một tiến trình —
quá nhỏ để thấy được điều này. Vòng 2 chạy cả hai công cụ trên một tập con 11 file (8 tài liệu đã xác
nhận là scan, trải từ 2013–2025 và từ 1–65 trang, cộng thêm 3 tài liệu sạch/hỗn hợp từ bước phân loại
của vòng 2), tái sử dụng một phiên `DocumentConverter`/CLI cho mỗi công cụ, giống cách làm harness ở
vòng 1.

**docling ném ra lỗi `std::bad_alloc` (cấp phát bộ nhớ thất bại) lặp lại trên mọi tài liệu scan vượt
quá khoảng 14 trang**, và mô hình lỗi này càng về sau trong phiên chạy càng tệ hơn (càng nhiều trang bị
ảnh hưởng, ở những tài liệu chạy sau) — phù hợp với việc tiến trình tích lũy áp lực bộ nhớ qua các lần
gọi `.convert()` lặp lại, hơn là do một file cụ thể có vấn đề. Quan trọng hơn, **lỗi này diễn ra âm
thầm**: docling vẫn trả về `status: ok`, vẫn ghi ra file `.md`, và không hề có dấu hiệu nào trong output
cho biết cả loạt trang đã bị bỏ sót. Đã xác nhận bằng kiểm tra trực tiếp — mẫu 47 (`85/2015/QH13`, 46
trang) gặp `bad_alloc` từ trang 14–46 và file output của nó bị cắt cụt giữa câu, không có dấu hiệu báo
lỗi nào (`"...b) Bố trí phòng bỏ phiếu, chuẩn bị hòm phiếu;"` — rồi dừng hẳn): chỉ 26.371 ký tự được
thu được cho một văn bản luật đáng lẽ phải đủ 46 trang.

MinerU chạy cùng 8 tài liệu scan đó mà **không có bất kỳ crash nào**. Đối chiếu chéo cùng trường hợp
`85/2015/QH13`: output của MinerU cho cùng file này chạy hết tới đúng đoạn kết văn bản thật sự
(`"...Chủ tịch ký: Nguyễn Sinh Hùng... SAO Y BẢN CHÍNH..."`) — 97.394 ký tự, khoảng gấp 3,7 lần lượng
nội dung so với bản bị cắt cụt âm thầm của docling, xác nhận MinerU đã xử lý trọn vẹn tài liệu.

| Mẫu                | Số trang         | docling                            | MinerU                   | Vấn đề của docling                                                                                                                     |
| ------------------- | ----------------- | ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 04 Hiến pháp 2013 | 31                | 242,2s / 53.252 ký tự            | 482,0s / 54.814 ký tự  | không có — số liệu khớp sát nhau                                                                                                    |
| 07 74/2018/QH14     | 4                 | 29,0s / 7.608 ký tự              | 94,9s / 7.822 ký tự    | không có — số liệu khớp sát nhau                                                                                                    |
| 08 68/2025/QH15     | 32                | 102,1s / 28.852 ký tự            | 554,5s / 63.582 ký tự  | `bad_alloc` trang 16–32 (mất khoảng 55% nội dung)                                                                                    |
| 09 179/2025/QH15    | 1                 | 10,7s / 952 ký tự                | 62,8s / 1.051 ký tự    | không có — số liệu khớp sát nhau                                                                                                    |
| 22 06/2022/QH15     | 65 (1 trang scan) | 109,4s / 144.601 ký tự           | 423,9s / 125.501 ký tự | `bad_alloc` trang 58, 60, 63, 64 (nhẹ — tài liệu chủ yếu có lớp văn bản thật)                                                 |
| 25 39/2024/QH15     | 46 (sạch)        | 87,5s / 105.837 ký tự            | 160,5s / 104.542 ký tự | không có — số liệu khớp sát nhau                                                                                                    |
| 26 41/2017/QH14     | 6                 | 46,3s / 12.429 ký tự             | 73,1s / 13.461 ký tự   | không có — số liệu khớp sát nhau                                                                                                    |
| 28 59/2024/QH15     | 12 (sạch)        | 25,3s / 27.780 ký tự             | 69,7s / 27.412 ký tự   | không có — số liệu khớp sát nhau                                                                                                    |
| 35 246/2025/QH15    | 15                | **688,3s** / 131.133 ký tự | 247,5s / 164.280 ký tự | không`bad_alloc`, nhưng có 3 lần "RapidOCR returned empty result" — chậm hơn 7 lần *và* ít hơn 20% nội dung so với MinerU |
| 45 44/2013/QH13     | 37                | 132,3s / 30.630 ký tự            | 299,8s / 77.785 ký tự  | `bad_alloc` trang 16–37 (mất khoảng 59% nội dung)                                                                                    |
| 47 85/2015/QH13     | 46                | 91,7s / 26.371 ký tự             | 350,2s / 97.394 ký tự  | `bad_alloc` trang 14–46, đã xác nhận bị cắt cụt giữa câu (mất khoảng 73% nội dung)                                          |

Cộng dồn trên 8 tài liệu thực sự là dạng scan: **docling thu được tổng cộng 291.227 ký tự; MinerU thu
được 480.189 — nhiều hơn 65%**, và khác với số liệu của docling, số liệu của MinerU không bị âm thầm
thiếu hụt từng phần. docling nhanh hơn khi mọi thứ chạy suôn sẻ (tài liệu ngắn, hoặc tài liệu vốn đã có
gần như đầy đủ lớp văn bản thật), nhưng với kho dữ liệu này — 94% là scan, thường xuyên có hàng chục
trang — "khi mọi thứ chạy suôn sẻ" lại loại trừ phần lớn kho dữ liệu.

**Lưu ý:** cả ba công cụ (docling, MinerU, markitdown) đều chạy đồng thời trong các tiến trình riêng
biệt ở đợt này để tiết kiệm thời gian, cùng tranh chấp khoảng 29GB RAM. Có khả năng việc tranh chấp tài
nguyên đã góp phần gây ra hoặc trực tiếp gây ra các lỗi `bad_alloc` của docling, chứ không hẳn đây là
một rò rỉ bộ nhớ nội tại của docling — điều này chưa được tách bạch rõ ràng ở đây. Nhưng có hai điểm
nghiêng về khả năng đây là vấn đề thật sự của docling hơn là do tranh chấp tài nguyên thuần túy: (1) tỷ
lệ lỗi rõ ràng *tệ dần* theo phiên chạy (các tài liệu chạy sau, kích thước tương tự, lại mất nhiều
trang hơn), phù hợp với việc tích lũy theo tiến trình hơn là một giới hạn tài nguyên bên ngoài cố định;
(2) ngay cả ở những trường hợp docling không crash, nó vẫn thường xuyên vừa chậm hơn *vừa* cho ra ít
nội dung hơn MinerU (mẫu 35). Đáng để xác nhận lại bằng cách chạy riêng docling (không chạy đồng thời
với MinerU/markitdown) trước khi quy hoàn toàn nguyên nhân này cho bản thân docling, nhưng xét theo
điều kiện chạy theo lô đồng thời thực tế — bản thân đây cũng là một kịch bản triển khai thực tế — thì
MinerU là công cụ đáng tin cậy hơn.

### Đánh giá cập nhật sau vòng 2

Vòng 1 nghiêng về hướng "docling cho ra hình dạng output sạch hơn, chọn nó, sửa OCR tiếng Việt trước."
Vòng 2 thay đổi điều đó: **xét mức độ kho dữ liệu này là dạng scan và nhiều trang, việc docling âm
thầm cắt cụt nội dung trên các tài liệu dài là rủi ro thực tế lớn hơn nhiều so với chênh lệch về định
dạng bảng Markdown-so-với-HTML-của-MinerU từ vòng 1.** Nếu buộc phải chọn một công cụ ngay bây giờ,
dựa trên bằng chứng này MinerU là lựa chọn mặc định an toàn hơn cho việc nhập dữ liệu theo lô, dù chậm
hơn 2–5 lần — một file `.md` trông có vẻ hợp lý nhưng âm thầm mất hai phần ba phần sau của một văn bản
luật là một kiểu lỗi tệ hơn một kết quả chạy chậm. Cả hai vẫn cần cùng một cách khắc phục OCR tiếng
Việt (EasyOCR/Tesseract `vie`) trước khi thực sự dùng được cho trường hợp PDF-scan chiếm đa số của kho
dữ liệu này — phát hiện đó từ vòng 1 vẫn giữ nguyên và giờ càng có hệ quả lớn hơn với con số 94%.

## Vòng 3: liệu việc gắn thêm một OCR engine tiếng Việt có thực sự khắc phục được vấn đề?

Yêu cầu tiếp theo: gắn EasyOCR (`lang='vi'`) vào docling và MinerU rồi kiểm thử lại. Kết quả: khả thi
với docling, không khả thi về mặt kiến trúc với MinerU, và với docling thì đây là một cách khắc phục
thật nhưng chưa trọn vẹn, không phải một chiến thắng hoàn toàn.

### MinerU: không phải thay đổi cấu hình, mà là một bức tường kiến trúc

Đã đọc trực tiếp mã nguồn của MinerU (`mineru/utils/ocr_language.py`) thay vì đoán. Bộ chọn ngôn ngữ
của backend `pipeline` không phải một điểm cắm chung kiểu "chọn một OCR engine" — `PUBLIC_OCR_LANGUAGES`
là một enum cố định gồm 12 giá trị (`ch`, `korean`, `ta`, `te`, `ka`, `th`, `el`, `arabic`,
`east_slavic`, `cyrillic`, `devanagari`), mỗi giá trị trỏ tới model + file từ điển đóng gói sẵn của
riêng nó (`ppocrv5_*_dict.txt`/`ppocrv6_dict.txt`, bản tự cài đặt lại PP-OCR bằng PyTorch của chính
MinerU — hoàn toàn không có dependency `easyocr` hay `paddleocr` nào trong gói đã cài).
`validate_public_ocr_lang()` ném lỗi cứng `ValueError` với bất kỳ giá trị nào ngoài danh sách đó hoặc
các bí danh của nó — tiếng Việt không nằm trong đó, và không có điểm mở rộng nào để thay thế bằng một
OCR engine khác. Đây là một thiết kế khác về căn bản so với docling, vốn thực sự hỗ trợ các OCR backend
có thể hoán đổi cho nhau (`EasyOcrOptions`/`RapidOcrOptions`/`TesseractOcrOptions` đều là các pipeline
option có thật, có tài liệu, có thể thay thế lẫn nhau). Con đường lý thuyết duy nhất còn lại — backend
`vlm-engine`/`hybrid-engine` riêng của MinerU, dùng một vision-language model thay vì pipeline cố định
và có thể đã học được một phần tiếng Việt từ quá trình pretraining đa ngôn ngữ tổng quát — chưa được
thử (phải tải thêm một model lớn, nhiều khả năng chậm hơn nhiều trên máy chỉ chạy CPU này, và xét theo
bằng chứng ở vòng 2 rằng backend *pipeline* của MinerU đã là công cụ đáng tin cậy hơn trong hai công
cụ, việc này bị đánh giá là không đáng công sức bỏ ra). MinerU nằm ngoài phạm vi của phần còn lại trong
vòng này.

### docling + EasyOCR(vi): vấn đề dấu tiếng Việt được sửa thật — nhưng là một sự đánh đổi, không phải một chiến thắng

Đã cài `easyocr` (xác nhận `'vi'` có trong `easyocr.config.all_lang_list`) và gắn vào qua
`PdfPipelineOptions.ocr_options = EasyOcrOptions(lang=['vi'], use_gpu=False)`. Ba kết quả:

**1. Độ chính xác ở mức ký tự được cải thiện rõ rệt, không thể chối cãi.** Cùng tài liệu, cùng trang,
đối chiếu trực tiếp với output RapidOCR(`chinese`) ở vòng 1:

|  | RapidOCR (vòng 1)                   | EasyOCR`vi` (vòng này)             |
| - | ------------------------------------ | -------------------------------------- |
|  | `"Lut s:"`                         | `"Luật số:"`                       |
|  | `"LUÁT THUÉ THU NHAP CÁ NHÂN"` | `"LUẬT THUẾ THU NHẬP CÁ NHÂN"`  |
|  | `"Điu 1. Phąm vi điu chinh"`    | `"Điều 1. Phạm vi điều chỉnh"` |

Mọi dấu đều đúng. Điều này xác nhận chẩn đoán ở vòng 1 là đúng — chất lượng OCR tiếng Việt luôn phụ
thuộc vào việc dùng model nào, không phải một giới hạn căn bản nào cả — và model `vi` của EasyOCR là
một cách khắc phục thật sự cho nửa vấn đề nhận dạng ký tự.

**2. Nhưng một vấn đề đúng-sai khác, mới, lại xuất hiện: thứ tự từ bị xáo trộn tại các điểm xuống
dòng.** Đã xác nhận trên hai trang khác nhau, cùng một mô hình lỗi nhất quán cả hai lần — từ cuối cùng
(hoặc vài từ cuối) của một dòng bị ngắt giữa câu bị đẩy ra *cuối* đoạn văn thay vì giữ nguyên vị trí:

> `"...tính theo 12 liên tục kể từ ngày đầu tiên có mặt tại Việt Nam; tháng"` (đúng ra phải là
> `"...tính theo 12 tháng liên tục kể từ ngày đầu tiên có mặt tại Việt Nam"` — từ `"tháng"` bị đẩy ra
> cuối)
>
> `"...phù hợp với tình hình kinh tế xã hội trong thời kỳ. hợp từng"` (đúng ra phải là `"...phù hợp với tình hình kinh tế - xã hội trong từng thời kỳ"` — cả `"hợp"` và `"từng"` đều bị đẩy ra cuối)

Từng từ riêng lẻ đều được đánh vần đúng (dấu vẫn nguyên vẹn) — đây thuần túy là lỗi thứ tự đọc, không
phải lỗi nhận dạng ký tự. Đọc như văn xuôi, những câu này sai theo cách rất dễ bị bỏ sót khi đọc lướt,
và sẽ làm hỏng bất kỳ khâu downstream nào giả định rằng thứ tự dòng phản ánh đúng thứ tự đọc — điều mà
`document-node.parser.ts` làm (nó là một parser dựa trên dòng). Nguyên nhân nhiều khả năng nhất: logic
chuyển từ layout sang thứ tự đọc của docling được tinh chỉnh theo quy ước bounding-box của RapidOCR, và
các box của EasyOCR có hình dạng/thứ tự khác đủ để làm hỏng logic đó. Chưa đánh giá riêng với nội dung
bảng trong đợt này (trang được chọn để kiểm tra bảng lại rơi vào một phần khác, không phải bảng, của
tài liệu).

**3. Độ tin cậy trở nên tệ hơn, không phải tốt hơn.** Toàn bộ tài liệu 15 trang mà docling dùng
RapidOCR đã hoàn thành ở vòng 1 (dấu sai, nhưng chạy xong) lại **crash khi dùng EasyOCR** —
`std::bad_alloc` ở trang 15, tiến trình bị dừng, không có file output nào được tạo ra. Từng trang riêng
lẻ vẫn chạy thành công bình thường (trang 1: 28,5s/1.395 ký tự; một trang sau đó: 31,6s/2.185 ký tự) —
nên đây không phải kiểu "EasyOCR không xử lý được một trang," mà là cùng mô hình tích lũy áp lực bộ nhớ
đã thấy ở phát hiện `bad_alloc` của vòng 2, giờ xảy ra *sớm hơn* vì các model dựa trên PyTorch của
EasyOCR có vẻ tiêu tốn bộ nhớ trên mỗi trang nặng hơn các model ONNX nhẹ của RapidOCR. Việc đổi OCR
engine không sửa được vấn đề độ tin cậy của docling — nó khiến vấn đề đó xảy ra sớm hơn.

### Kết luận chung

Sửa *ngôn ngữ* OCR không tự nó đưa được công cụ nào tới trạng thái sẵn sàng triển khai cho kho dữ liệu
này. docling+EasyOCR(vi) đánh đổi một vấn đề về độ chính xác ký tự lấy một vấn đề về thứ tự đọc và một
hồ sơ độ tin cậy tệ hơn; MinerU hoàn toàn không thể nhận cách khắc phục này nếu không fork lại phần lõi
của nó. Các thử nghiệm tiếp theo thực tế nhất, theo thứ tự triển vọng: (a) áp dụng cùng cách đổi sang
EasyOCR(vi) nhưng trên **Tesseract** thay vì EasyOCR (docling cũng hỗ trợ `TesseractOcrOptions`, và tổ
hợp model `vie` + phân tích layout của Tesseract là một sự kết hợp khác, có thể vững chắc hơn), (b) xử
lý tài liệu theo từng trang thay vì cả tài liệu một lượt để né trực tiếp vấn đề tích lũy bộ nhớ, (c) một
bước hậu xử lý riêng để sửa thứ tự đọc cho output của EasyOCR. Không nội dung nào trong số đó nằm trong
phạm vi của vòng này.

## Vòng 4: chia nhỏ theo từng trang, và hợp nhất ba cấu hình của docling

Yêu cầu tiếp theo cho cách khắc phục #2 mà vòng 3 đề xuất ("xử lý theo từng trang để né vấn đề tích lũy
bộ nhớ"): đã kiểm thử trực tiếp, và nó có tác dụng — đối với độ tin cậy. Nó không đụng tới lỗi thứ tự
từ. Phần này cũng hợp nhất 6 tài liệu của vòng 1 và tập con 11 tài liệu của vòng 2 thành một cái nhìn
tổng hợp về docling thuần túy, vì tính đến giờ docling đã được chạy qua ba cấu hình thực sự khác nhau.

### Bài kiểm thử theo từng trang

Cùng tài liệu scan 15 trang như vòng 3 (`109/2025/QH15`), cùng `EasyOcrOptions(lang=['vi'])`, nhưng
thay vì một lệnh gọi `converter.convert(path)` duy nhất cho cả tài liệu, dùng một instance
`DocumentConverter` tái sử dụng qua 15 lệnh gọi tuần tự, mỗi lệnh với `page_range=(i, i)`, rồi ghép các
output lại sau — đúng hình dạng thực tế của "chia nhỏ theo trang bên trong một tiến trình chạy dài
hạn," không phải "khởi tạo một tiến trình mới cho mỗi trang."

**Kết quả: hoàn tất cả 15/15 trang. Không crash, không `bad_alloc` nào.** Tổng cộng 29.504 ký tự,
340,42s tổng thời gian (khoảng 22,7s/trang, ổn định dù ở đầu hay cuối lượt chạy — không có dấu hiệu của
mô hình chậm dần/xuống cấp dần mà vòng 2/3 cho thấy khi xử lý nhiều trang trong một lệnh `.convert()`
duy nhất). Điều này trực tiếp xác nhận giả thuyết của vòng 3: áp lực bộ nhớ tích lũy *bên trong* một
lệnh gọi `.convert()` xử lý nhiều trang, chứ không phải qua các lần gọi lặp lại tới một converter được
tái sử dụng — chia nhỏ theo trang thực sự né được vấn đề đó.

**Dấu tiếng Việt vẫn chính xác** (cùng hành vi EasyOCR theo từng trang đã xác nhận ở vòng 3):
`"Luật số:"`, `"Điều 1. Phạm vi điều chỉnh"`, v.v.

**Lỗi xáo trộn thứ tự từ vẫn còn nguyên, không đổi, và mang tính cục bộ theo từng trang** — việc chia
nhỏ không sửa cũng không làm nó tệ hơn, xác nhận đây là vấn đề thứ tự đọc trong nội bộ một trang, độc
lập với vấn đề bộ nhớ: `"...trợ quốc công; nghề công yếu trợ ngoài trợ nghề trợ năng trợ hàng trợ trợ trợ công"` (đoạn văn ở trang 2 nói về các loại phụ cấp/trợ cấp) — cùng mô hình từ bị đẩy ra sau như ở
vòng 3, đôi khi còn tệ hơn với những đoạn văn dài, nhiều chỗ xuống dòng. Vậy nên chia nhỏ theo trang là
một cách khắc phục thật sự cho đúng một trong hai vấn đề mà vòng 3 phát hiện.

### docling: ba cấu hình, một tài liệu, so sánh trực tiếp

| Cấu hình                                                          | Kết quả trên`109/2025/QH15` (15 trang, scan)                 | Dấu tiếng Việt                          | Thứ tự từ                                           | Có hoàn tất không? |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ | ---------------------- |
| **1. docling thuần** (RapidOCR, mặc định, cả tài liệu) | 97,0s, 26.648 ký tự                                             | Lỗi dấu nghiêm trọng (`"Lut s:"`)    | Đúng                                                 | Có                    |
| **2. docling + EasyOCR(vi)**, cả tài liệu                  | Crash ở trang 15/15,**0 ký tự, không có file output**  | Không áp dụng — chưa từng hoàn tất | Không áp dụng                                       | **Không**       |
| **3. docling + EasyOCR(vi)**, theo từng trang                | 340,4s (chậm hơn cấu hình 1 khoảng 3,5 lần), 29.504 ký tự | Đúng                                     | **Bị xáo trộn tại các điểm xuống dòng** | Có, 15/15             |

Không cấu hình nào đơn giản là "người chiến thắng" — mỗi cấu hình thất bại ở một khía cạnh khác nhau.
Cấu hình 1 nhanh nhất và đáng tin cậy nhưng cho ra văn bản mà con người/parser downstream không thể tin
tưởng ở từng ký tự. Cấu hình 2 là ngõ cụt trong lần kiểm thử này. Cấu hình 3 là cấu hình duy nhất vừa
đáng tin cậy *vừa* chính xác về ký tự, với cái giá là chậm nhất rất xa và vẫn chưa hoàn toàn đúng (thứ
tự từ) — cấu hình ít tệ nhất trong ba, không phải một vấn đề đã được giải quyết.

### docling thuần, hợp nhất: vòng 1 (6 tài liệu) + vòng 2 (tập con 11 tài liệu) = 17 tài liệu

|                                                                                                                     | Giá trị                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Số tài liệu đã thử (chỉ PDF/docx — 3 tài liệu còn lại là .doc/.rtf, bị từ chối trước khi xử lý) | 14                                                                                              |
| Báo`status: ok`                                                                                                  | **14/14 (100%)**                                                                          |
| Trong số đó, xác nhận hoặc nghi ngờ mạnh có mất nội dung/bất thường                                   | 5/14 (36%) — các mẫu 08, 22, 35, 45, 47                                                      |
| Trong số đó, bị cắt cụt*nghiêm trọng* (mất trên 50% nội dung kỳ vọng)                                | 3/14 (21%) — mẫu 08 (~55%), 45 (~59%), 47 (~73%)                                              |
| Tổng thời gian xử lý trên 14 tài liệu                                                                        | 1.715s (~28,6 phút)                                                                            |
| Tổng số ký tự thu được trên 14 tài liệu                                                                   | 653.412 — một phần đáng kể trong đó bị hỏng (dấu) hoặc bị cắt cụt (thiếu trang) |

Con số quan trọng nhất ở đây: **`status: ok` được báo cáo 14/14 lần, kể cả trên mọi tài liệu đã âm
thầm mất hơn một nửa nội dung.** Không có gì trong giá trị trả về của chính docling phân biệt được một
lượt chạy sạch với một lượt chạy bị cắt cụt nghiêm trọng — điều đó phải được kiểm tra từ bên ngoài
(chẳng hạn bằng cách so sánh độ dài output với số trang, chính là cách phát hiện ra vấn đề này ngay từ
đầu).

### Điều này để lại gì cho khuyến nghị

Vòng 3 đặt câu hỏi "sửa ngôn ngữ OCR có sửa được công cụ không?" — không. Vòng 4 đặt câu hỏi "cách khắc
phục cho vấn đề *khác* (chia nhỏ theo trang) có đưa docling tới mức dùng được hoàn toàn không?" — gần
hơn, nhưng vẫn chưa: nó đánh đổi tốc độ lấy độ tin cậy và vẫn để nguyên lỗi thứ tự từ chưa được xử lý.
Gộp mọi thứ lại: để đưa docling tới mức thực sự đáng tin cậy cho kho dữ liệu này sẽ cần *cả* chia nhỏ
theo trang (vòng 4, sửa độ tin cậy) *lẫn* một cách sửa thứ tự đọc hoặc một OCR backend hoàn toàn khác
(Tesseract chưa kiểm thử, vẫn là điều đáng thử tiếp theo) — không thay đổi đơn lẻ nào được kiểm thử
xuyên suốt vòng 1–4 tự nó đạt được điều đó. So với điều đó, hồ sơ của MinerU ở vòng 2 (chậm hơn, nhưng
không crash và không thấy vấn đề thứ tự từ) vẫn có vẻ là con đường ít công sức hơn để đạt được thứ gì
đó dùng được, nếu vấn đề dấu tiếng Việt của riêng nó có thể được giải quyết — điều mà, theo vòng 3, là
không thể thông qua EasyOCR (bị chặn về mặt kiến trúc) và vẫn chưa được kiểm thử qua bất kỳ con đường
nào khác.

## Vòng 5: hợp nhất pdf-inspector, markitdown, và MinerU qua vòng 1–2

Vòng 4 dành sự đối xử này cho docling vì nó có ba cấu hình thực sự khác nhau cần hợp nhất. Ba công cụ
còn lại chỉ từng chạy đúng một cấu hình mỗi công cụ, nên "hợp nhất" ở đây chỉ đơn giản là gộp 6 tài
liệu của vòng 1 với các mẫu của vòng 2 thành một bộ dữ liệu chính xác cho mỗi công cụ — vẫn đáng làm
cẩn thận thay vì để số liệu của hai vòng nằm rải rác, vì một vài tổng số hợp nhất hóa ra lại có ý nghĩa
quan trọng (tỷ lệ scan trên toàn kho dữ liệu của pdf-inspector, lỗi RTF của markitdown chuyển từ "phát
hiện một lần" sang "xác nhận độc lập hai lần").

### pdf-inspector: 52 lượt thử, 51 lần phân loại hợp lệ

|                                   | Vòng 1 | Vòng 2                            | Hợp nhất                        |
| --------------------------------- | ------- | ---------------------------------- | --------------------------------- |
| Số PDF được phân loại       | 2       | 50                                 | 52                                |
| Hợp lệ (input không bị hỏng) | 2       | 49                                 | 51                                |
| Scan hoàn toàn                  | 1       | 46                                 | **47 (92,2% số hợp lệ)** |
| Văn bản digital sạch           | 1       | 2                                  | 3 (5,9%)                          |
| Hỗn hợp/một phần              | 0       | 1                                  | 1 (2,0%)                          |
| Lỗi (input thực sự bị hỏng)  | 0       | 1 (file RTF gán nhầm nhãn .pdf) | 1                                 |

Các định dạng ngoài PDF (.doc/.rtf/.docx, chỉ ở vòng 1) được báo cáo đúng là
`unsupported_format` thay vì bị thử xử lý — thêm 4 mục nữa, không tính là lỗi vì đó là phạm vi đã công
bố của pdf-inspector, không phải một bug. Mọi mốc thời gian đều dưới 100ms, trừ một số ít tài liệu mà
nó còn tạo ra Markdown thật (các tài liệu văn bản sạch, tối đa khoảng 0,23s) — vẫn không đáng kể so với
chi phí mỗi tài liệu của docling/MinerU. Trường hợp lỗi duy nhất đáng nhắc lại trong bối cảnh này: đó
là hành vi *đúng* trước một input thực sự bị hỏng (nội dung RTF được lưu dưới đuôi `.pdf`) —
pdf-inspector là công cụ duy nhất trong bốn công cụ không âm thầm xử lý sai file đó cũng không crash
trên nó, nó chỉ đơn giản báo "đây không phải một PDF thật." (Bản thân phỏng đoán của nó về việc đó
*là gì* — "JSON" — thì sai, nhưng việc từ chối giả vờ ra một kết quả thì không sai.) Không có vấn đề độ
tin cậy, không crash, trên toàn bộ 52 lượt thử.

### markitdown: 56 lượt thử, một bug giờ được xác nhận độc lập hai lần

|                                                                                                     | Vòng 1               | Vòng 2                                                | Hợp nhất                                                                                        |
| --------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Số tài liệu đã thử                                                                            | 6 (mọi định dạng) | 50 (chỉ PDF)                                          | 56                                                                                                |
| `status: ok`                                                                                      | 4                     | 50                                                     | 54                                                                                                |
| `UnsupportedFormatException` báo lỗi rõ ràng (.doc)                                           | 2                     | 0 (vòng 2 không có .doc)                            | 2/2 — 100% bị từ chối đúng cách                                                            |
| Âm thầm trả về rỗng (`ok`, 0 ký tự) trên PDF scan                                         | 1                     | 45                                                     | 46                                                                                                |
| Âm thầm đổ nguyên mã nguồn RTF (`ok`, có số ký tự thật, nội dung là rác)           | 1 (mẫu .rtf thật)   | 1 (file`.pdf`-thực-ra-là-RTF bị gán nhầm nhãn) | **2/2 — giờ đã xác nhận trên hai file độc lập, không phải một lần đơn lẻ** |
| Trích xuất thật, chính xác (PDF/docx sạch, hoặc trường hợp lớp văn bản bị hỏng sẵn) | 2                     | 5                                                      | 7                                                                                                 |
| Tổng thời gian xử lý                                                                            | 6,19s                 | 42,23s                                                 | 48,42s                                                                                            |

Phát hiện về RTF là phát hiện chuyển đổi hình dạng rõ nhất, từ "phát hiện một lần" sang "xác nhận là
một bug mang tính hệ thống": vòng 1 phát hiện nó trên một file `.rtf` thật; vòng 2, một cách độc lập,
phát hiện *đúng* dạng lỗi đó (mã nguồn dạng control-code thô `{\rtf1\ansi...` bị đổ ra như "văn bản
thành công") trên một file hoàn toàn khác, chỉ tình cờ là nội dung RTF bị gán nhầm đuôi `.pdf`. Hai
file khác nhau, hai vòng khác nhau, cùng một bug y hệt — đây không phải một trường hợp biên, đường xử
lý RTF của markitdown đơn giản là hỏng mỗi khi được gọi tới, bất kể input đến bằng cách nào. Tỷ lệ âm
thầm trả về rỗng 46/56 (82%) trên nội dung dạng scan chủ yếu phản ánh cơ cấu kho dữ liệu của vòng 2
(94% là scan, theo phân loại của vòng 2) hơn là nói lên điều gì mới về bản thân markitdown — nhất quán
với việc mẫu scan duy nhất ở vòng 1 cũng trả về rỗng. Không crash nào trong toàn bộ 56 lượt thử, giống
như chỉ riêng vòng 1.

### MinerU: 14 lượt thử, 14 thành công, không crash nào qua cả hai vòng

|                                          | Vòng 1             | Vòng 2 (tập con 11 tài liệu) | Hợp nhất             |
| ---------------------------------------- | ------------------- | -------------------------------- | ---------------------- |
| Số tài liệu đã thử (chỉ PDF/docx) | 3                   | 11                               | 14                     |
| Hoàn tất thành công                  | 3                   | 11                               | **14/14 (100%)** |
| Crash / cắt cụt âm thầm              | 0                   | 0                                | **0**            |
| Tổng thời gian xử lý                 | 412,5s (~6,9 phút) | 2.818,8s (~47,0 phút)           | 3.231,3s (~53,9 phút) |
| Tổng số ký tự thu được            | 84.217              | 737.644                          | 821.861                |

Không có thông tin mới nào ở đây ngoài những gì vòng 1–2 đã lần lượt xác lập riêng — cái nhìn hợp nhất
chỉ xác nhận kết quả "không crash" vẫn đúng ở n=14, không chỉ n=11, và phát hiện về độ tin cậy không
phải một sự may mắn riêng của tập con 11 tài liệu ở vòng 2. `.doc`/`.rtf` chưa từng được thử ở cả hai
vòng (bị loại trừ đúng cách theo danh sách định dạng hỗ trợ đã công bố của MinerU — chỉ pdf/image/docx/
pptx/xlsx), nên những định dạng đó không bị tính là điểm trừ cho MinerU theo cách chúng bị tính cho
docling (vốn tuyên bố hỗ trợ `.doc` rồi lại lỗi trên nó) hay markitdown (mà đường xử lý RTF của nó chủ
động báo sai là thành công).

### Điều này thay đổi gì trong bức tranh tổng thể

Phần lớn là xác nhận lại chứ không đảo ngược: cả pdf-inspector lẫn MinerU khi nhìn theo góc hợp nhất
đều đáng tin cậy đúng như từng vòng riêng lẻ đã gợi ý (pdf-inspector: nhanh và trung thực khi thất bại;
MinerU: chậm nhưng hoàn tất trọn vẹn). Điều duy nhất thực sự nâng mức độ tin tưởng lên là bug RTF của
markitdown — được tái hiện độc lập trên các file không liên quan nhau qua cả hai vòng, nên cần được
xem là một giới hạn cố hữu, lâu dài của công cụ này, chứ không phải điều gì đó đáng để kiểm thử lại
hoặc hy vọng chỉ là vấn đề riêng của một file cụ thể.

## Khuyến nghị

Bằng chứng ở trên đủ để đưa ra một kiến trúc tích hợp cụ thể, không chỉ là xếp hạng công cụ — trình bày
ở đây như câu trả lời cuối cùng cho câu hỏi "vậy thực sự nên xây dựng cái gì."

### Lựa chọn cốt lõi: docling + EasyOCR(`lang='vi'`), chạy theo từng trang, cho mọi thứ cần OCR

Đây là cấu hình đã kiểm thử duy nhất thỏa mãn đồng thời cả hai yêu cầu bắt buộc — văn bản tiếng Việt
đúng và hoàn tất một cách đáng tin cậy:

- docling hoặc MinerU thuần (OCR mặc định): tương đối đáng tin cậy, nhưng dấu tiếng Việt bị sai. Đây
  không phải vấn đề chất lượng nhỏ — dấu tiếng Việt mang ý nghĩa ngữ nghĩa (`ma`/`má`/`mà`/`mã`/`mạ` là
  năm từ khác nhau), nên văn bản bị mất dấu gần như không dùng được làm nội dung pháp lý dù cấu trúc có
  sạch đến đâu.
- MinerU + EasyOCR: không khả thi. Đã xác nhận bằng cách đọc mã nguồn của MinerU — OCR engine của nó bị
  hardcode, không thể hoán đổi, nên hoàn toàn không thể nhận cách khắc phục này (xem Vòng 3).
- docling + EasyOCR, cả tài liệu một lượt: dấu đúng, nhưng crash (`std::bad_alloc`) từ khoảng trang thứ
  14 trở đi, một cách âm thầm, đúng trên loại tài liệu chiếm 94% kho dữ liệu này.
- **docling + EasyOCR, theo từng trang: dấu đúng, hoàn tất 15/15 trang, không crash nào** (Vòng 4). Cấu
  hình duy nhất giải quyết đồng thời cả hai vấn đề.

Vẫn còn một lỗi đã biết chưa được xử lý, và đây là lỗi về tính đúng đắn của nội dung, không phải điều mà
việc viết lại parser có thể tự bù đắp: các từ bị đẩy ra cuối dòng khi một câu bị ngắt giữa dòng (Vòng
3/4). Hai hướng rẻ tiền đáng thử trước khi viết code tùy chỉnh: (1) đổi `EasyOcrOptions` sang
`TesseractOcrOptions` — docling hỗ trợ sẵn, và cách phân tích layout của Tesseract khác đủ nhiều so với
EasyOCR nên có thể không mắc phải lỗi này; (2) nếu không, cách sửa nhiều khả năng là sắp xếp lại có mục
tiêu các phần tử văn bản của docling theo vị trí bounding-box (trên-xuống-dưới, trái-sang-phải) trước
khi gọi `export_to_markdown()` — `result.document` đã sẵn có dữ liệu bbox, và lỗi này trông giống như
nằm ở cách export markdown sắp xếp thứ tự, không phải ở bản thân bước OCR.

### pdf-inspector làm công cụ chính cho mọi thứ *không* cần OCR

pdf-inspector thắng ở mọi chỉ số quan trọng cho trường hợp phổ biến — chi phí, tốc độ, và độ chính xác
trên văn bản thực sự tồn tại sẵn — nên nó nên đóng vai trò định tuyến, không chỉ là một trong bốn ứng
viên ngang hàng:

1. **Luôn phân loại trước.** `<100ms`, nhận diện đúng scan-vs-digital trên toàn bộ 52 lượt thử PDF
   trong đợt đánh giá này (xem Vòng 5). Chỉ trả chi phí cho docling+EasyOCR trên những tài liệu/trang
   nó thực sự đánh dấu là cần OCR.
2. **Tin tưởng trực tiếp output markdown của nó khi `pages_needing_ocr == 0` và
   `is_complex_layout == false`.** Đã kiểm tra riêng cả 4 tài liệu sạch/gần-sạch qua cả hai vòng cho
   chính vấn đề này: false-positive về bảng phát hiện ở mẫu 01 (Vòng 1) và mẫu 22 (Vòng 5) đều có
   `is_complex_layout: true`; mẫu 25 và 28, với `is_complex_layout: false`, không có bảng bị sai lệch
   nào. Đúng 4/4 — n nhỏ, nhưng nhất quán, và đây là tín hiệu pdf-inspector đã tự tính sẵn miễn phí.
3. **Khi `is_complex_layout == true`, đừng tin tưởng output bảng một cách mù quáng.** Cho các phần có
   bảng đi qua docling để đối chiếu chéo, hoặc đánh dấu để rà soát theo đúng mô hình mà dự án này đã
   dùng trong `docs/monitoring/law-index-flagged-documents.md`. Điều này không loại pdf-inspector khỏi
   vai trò công cụ chính — không công cụ nào trong bốn công cụ hoàn toàn không cần giám sát ở bất kỳ
   đâu trong đợt đánh giá này — nó chỉ có nghĩa là đường xử lý chính cần một lớp bảo vệ, không phải
   không cần gì cả.

### markitdown: vai trò hẹp nhưng có thật — chỉ dành cho `.docx`

pdf-inspector hoàn toàn không đụng đến `.docx`, và không có lý do gì để chạy thêm một công cụ thứ hai
trên một PDF mà pdf-inspector đã xử lý sạch sẽ. Vai trò của markitdown thu hẹp lại đúng vào khoảng
trống đó: công cụ chính cho `.docx` (chính xác và nhanh ở mọi lần kiểm thử qua cả hai vòng), không gì
khác. Các kiểu lỗi của nó trên PDF scan và RTF (Vòng 1, Vòng 5) khiến nó bị loại ở mọi trường hợp còn
lại.

### `.doc` / `.rtf`: vẫn chưa giải quyết được, vẫn là một hạng mục công việc riêng

Không công cụ nào trong bốn công cụ xử lý được các định dạng này — khuyến nghị này không thay đổi điều
đó. Một bước chuyển đổi trước bằng LibreOffice-headless (`--convert-to docx`) đặt trước pipeline nêu
trên vẫn là điều kiện tiên quyết, và bước đó chưa tồn tại trên máy này. Không phụ thuộc vào quyết định
OCR/định tuyến ở trên; chỉ đơn giản là chưa được giải quyết bởi quyết định đó.

### Điều này giải quyết gì cho việc viết lại parser

Vì parser đang được viết lại để tiêu thụ Markdown thay vì văn bản phẳng đã scrape của vbpl.vn, kiến
trúc này xác định rõ hình dạng cụ thể mà parser mới cần xử lý:

- Loại bỏ tiền tố `#+\s*` trước khi khớp với `Điều`/`Chương`/v.v. — mọi công cụ đã kiểm thử đều thêm
  tiền tố tiêu đề theo cách này, không phải một đặc thù riêng của docling (xem Chỉ số: khả năng tương
  thích với parser, ở trên).
- Phân tích các pipe-table Markdown gốc (`| ... |`) thành các ô có cấu trúc — đây là hình dạng bảng cụ
  thể của docling. (Của MinerU là HTML `<table>` thô nhúng trực tiếp — một nhánh hoàn toàn khác; không
  cần thiết cho khuyến nghị này, nhưng đáng để thiết kế lớp tiêu thụ bảng có nhận biết trước hình dạng
  đó, phòng khi sau này quay lại xem xét MinerU.)
- Đừng giả định thứ tự dòng là thứ tự đọc đối với nội dung có nguồn từ OCR cho tới khi lỗi thứ tự từ
  nói trên thực sự được khắc phục — đáng để có một bước kiểm chứng (ví dụ: đối chiếu các câu đã tái
  dựng với một danh sách cụm từ đã biết là đúng) trước khi tin tưởng hoàn toàn output docling+EasyOCR
  theo từng trang khi đưa vào production.

## Các file liên quan

- `samples/`, `samples2/`, `samples2_ocr_subset/` — các tài liệu nguồn (không commit vào git, là bản
  sao của dữ liệu `laws/` vốn cũng đã không được commit)
- `outputs/<tool>/`, `outputs2/<tool>/` — output `.md` của mỗi công cụ cho từng mẫu + `_timings.json`
- `scripts/run_*.py` — các harness dùng để chạy chuyển đổi cho cả hai đợt
- `.venv-mineru/` — môi trường Python 3.12 riêng của MinerU (không commit vào git)
