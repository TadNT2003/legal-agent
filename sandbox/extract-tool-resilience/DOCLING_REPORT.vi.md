# docling + EasyOCR(vi) xử lý từng trang: báo cáo độ bền ở quy mô lớn, tập trung vào bảng biểu

Phạm vi: **chỉ docling**. Báo cáo đầu tiên trong ba báo cáo theo từng công cụ cho
`extract-tool-resilience` (pdf-inspector và markitdown sẽ có báo cáo riêng sau, theo
đúng yêu cầu — báo cáo này không phải là so sánh giữa các công cụ). Kiểm chứng cấu hình
OCR-fallback mà đánh giá trước (`sandbox/text-extract-evaluation/REPORT.md`) đã đề xuất —
docling + EasyOCR(`lang='vi'`), xử lý từng trang — trên 50 file PDF scan được chọn riêng
vì có mật độ bảng biểu cao, ở quy mô (909 trang) mà đánh giá trước chưa từng thử nghiệm
đối với bảng biểu.

## Tóm tắt điều hành

**Cấu hình này đáng tin cậy ở quy mô lớn nhưng có một vấn đề về độ chính xác tương quan
với mật độ bảng biểu mà đánh giá trước chưa từng phát hiện.** Toàn bộ 909 trang trên 50
tài liệu cuối cùng đều hoàn tất, không lỗi ở cấp trang — cách khắc phục lỗi crash bằng xử
lý từng trang từ đánh giá trước vẫn giữ vững. Nhưng mật độ bảng biểu hóa ra lại dự báo một
lỗi thứ hai, nghiêm trọng hơn lỗi sai thứ tự từ đã biết trước đó: **bảng trong trang càng
dày đặc, EasyOCR càng đánh mất nhiều dấu tiếng Việt hơn.**

| Phát hiện                                                          | Kết quả                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Độ tin cậy (số trang)                                            | 909/909 (100%) — 0 lỗi ở cấp trang                                                                                                                                                                                                                    |
| Độ tin cậy (hạ tầng)                                            | 2 lần sập toàn bộ pool (`BrokenProcessPool`), cả hai đều tự phục hồi nhờ checkpoint — không mất trang nào                                                                                                                                |
| Tốc độ                                                            | 18,6 giây/trang (mật độ bảng thấp) đến 166,8 giây/trang (mật độ bảng cao nhất) — chênh lệch 9 lần, do độ phức tạp của bảng chứ không phải chất lượng bản scan                                                              |
| **Độ chính xác dấu tiếng Việt so với mật độ bảng** | **Hệ số tương quan Pearson r = -0,641.** 17/50 tài liệu (34%) suy giảm nghiêm trọng (dưới 40% mật độ dấu bình thường); 8/50 (16%) gần như mất hoàn toàn dấu; 1/50 mất hoàn toàn (672.131 ký tự, không một dấu nào) |
| Cấu trúc bảng                                                     | Bảng đơn giản 2-3 cột: cấu trúc + nhãn hàng phần lớn dùng được. Bảng tài chính nhiều cột (7+): cấu trúc được giữ, nhưng nhiều ô nội dung bị bỏ trống                                                                     |
| Lỗi sai thứ tự từ (từ đánh giá trước)                      | Vẫn còn nguyên, không đổi, xác nhận lại ở quy mô này                                                                                                                                                                                          |

Kết quả này không phủ nhận khuyến nghị của đánh giá trước đối với nội dung chủ yếu là
văn xuôi — nó chỉ ra một khoảng trống thực sự đối với nội dung bảng biểu dày đặc mà mẫu
thử trước đó (thiên về văn xuôi hơn) không có đủ tài liệu nhiều bảng để phát hiện ra.

## Thiết lập

**Mẫu thử:** 50 file PDF scan, tổng cộng 909 trang (tối thiểu 4 / trung vị 13 / tối đa
163 trang/tài liệu), được chọn bằng một heuristic phát hiện đường kẻ bảng dựa trên
OpenCV (render từng trang, dùng morphological-open để tách các đường kẻ ngang/dọc dài,
đếm số giao điểm lưới) chạy trên toàn bộ 597 PDF đã scan trong kho `laws/` rồi xếp hạng
theo tổng số giao điểm. Đã kiểm chứng heuristic này bằng `246/2025/QH15` (đã được xác
nhận trong đánh giá trước là có bảng thật): đạt điểm 21.118 so với điểm một/hai chữ số ở
các tài liệu chỉ có văn xuôi — chênh lệch rõ ràng 2-3 bậc độ lớn. Chọn ra top 50 (điểm từ
294 đến 49.161). Xem `sandbox/extract-tool-resilience/scripts/detect_table_gridlines.py`
và `docling_manifest.json`.

**Harness:** mỗi worker có một `DocumentConverter` riêng (`EasyOcrOptions(lang=['vi'], use_gpu=False)`), xử lý từng trang một (`page_range=(i,i)`) theo đúng cách khắc phục lỗi
crash của đánh giá trước. 50 tài liệu được chia round-robin thành 5 chunk, mỗi chunk 10
tài liệu (để mỗi chunk trộn lẫn tài liệu nặng/nhẹ thay vì dồn hết tài liệu chậm vào một
chỗ), chạy qua `ProcessPoolExecutor`. Mỗi chunk ghi checkpoint sau từng trang một vào
file `outputs/docling/_chunk{N}_timings.json` riêng, nên nếu crash chỉ mất phần đang xử
lý dở, không mất phần đã lưu trên đĩa. Xem `scripts/run_docling_parallel.py`.

**Mức độ song song:** bắt đầu với 5 worker theo đúng yêu cầu ban đầu; đã đo dung lượng bộ
nhớ thực tế của từng tiến trình trước (khoảng 1,1GB RSS sau khi các mô hình docling+EasyOCR
được nạp xong, ổn định qua các trang — khớp với phát hiện của đánh giá trước rằng xử lý
từng trang ngăn được tình trạng tích lũy bộ nhớ *trong cùng một tiến trình*). Tại thời
điểm đó chỉ còn 5,2GB RAM trống (do stack docker Postgres/OpenSearch/Neo4j/ChromaDB/Redis dev server đã chiếm dụng phần lớn); dừng các container không cần thiết cũng không giúp
ích gì, vì VM WSL2 của Docker Desktop không trả lại bộ nhớ cho Windows chỉ vì các
container bên trong nó dừng lại. Chốt ở mức 4 worker, sau đó giảm xuống 3 sau một lần
crash thực tế (xem bên dưới).

## Độ tin cậy: hai lần sập toàn bộ pool, không mất dữ liệu

**Lần chạy đầu (4 worker, không có auto-retry):** chạy được 9.022 giây (~2,5 giờ), rồi cả
4 worker cùng chết đồng loạt — `BrokenProcessPool: A process in the process pool was terminated abruptly while the future was running or pending.` Nhờ có checkpoint nên
không mất gì ngoài thời gian: 384/909 trang (42%) đã được lưu an toàn trên đĩa, không lỗi
nào trong số đó.

Không thể xác định chắc chắn nguyên nhân gốc: đã kiểm tra event log System và Application
của Windows để tìm dấu hiệu OOM, crash ứng dụng (Event ID 1000), và sự kiện sleep/wake
trong khoảng thời gian xảy ra crash — không tìm thấy dấu hiệu nào trong ba loại trên.
Windows không ghi log các lỗi cấp phát bộ nhớ ở tầng user-mode sâu trong native code
(các phần mở rộng C++ của torch/EasyOCR/OpenCV) theo cách Linux ghi log OOM-killer vào
dmesg, nên việc không có event log không loại trừ khả năng do áp lực bộ nhớ — chỉ có
nghĩa là không có bằng chứng rõ ràng theo cả hai hướng.

**Lần chạy thứ hai (3 worker + wrapper auto-retry-đến-khi-xong):** harness được sửa để
tự động thử lại các chunk chưa hoàn thành theo vòng lặp (tối đa 8 lượt) thay vì cần can
thiệp thủ công. Lượt 1 crash *y hệt như trước* — cả 5 chunk, `BrokenProcessPool`, vẫn
không có tín hiệu nào trong log hệ thống. Lượt 2 (tự động, không cần can thiệp) hoàn tất
toàn bộ: 909/909 trang, 50/50 tài liệu, 0 lỗi, 8.607,9 giây (~2,4 giờ) cho phần việc của
riêng lượt 2.

**Tổng cộng cả hai lần chạy:** khoảng 4,9 giờ thời gian thực, hai lần sập toàn bộ pool,
không mất trang nào ở cả hai lần. Một phát hiện mới của lần chạy này: kiểu crash (tất cả
worker chết *cùng lúc*, không phải từng cái một) phù hợp với giả thuyết tranh chấp bộ nhớ
ở thời điểm tải đỉnh — và các tài liệu trong lần chạy này, theo đúng thiết kế, là những
tài liệu có mật độ bảng dày đặc nhất trong kho ngữ liệu, mà bản thân chúng cũng là những
trang chậm nhất *và* (xem bên dưới) tốn nhiều tài nguyên tính toán nhất qua công đoạn
nhận diện cấu trúc bảng của docling. Việc nhiều worker cùng xử lý những trang tệ nhất của
mình cùng một lúc là một yếu tố khả dĩ làm trầm trọng thêm vấn đề, ngoài mức RAM dư ra đã
được cảnh báo từ trước khi bắt đầu chạy. Điều này chưa được chứng minh, chỉ là phù hợp với
bằng chứng quan sát được — nên thử với 2 worker nếu tình trạng này lặp lại.

**Điều rút ra cho ai tái sử dụng harness này:** thiết kế chunk-có-checkpoint + auto-retry
hoạt động đúng như kỳ vọng. Tỷ lệ crash 2/2 lần chạy trên tổ hợp tài liệu nhiều bảng biểu,
bộ nhớ hạn chế này đủ cao để coi wrapper auto-retry là bắt buộc, không phải tùy chọn, cho
bất kỳ lần chạy nào ở quy mô này — nên coi việc hoàn tất chỉ trong một lượt là ngoại lệ,
không phải là điều mặc định.

## Tốc độ: mật độ bảng dự báo thời gian xử lý, không phải chất lượng bản scan

|                        | giây/trang                                   |
| ---------------------- | --------------------------------------------- |
| Tài liệu nhanh nhất | 18,6 (`27/2016/QH14`, table_score 294)      |
| Tài liệu chậm nhất | 166,8 (`223/2025/QH15`, table_score 48.789) |
| Trung vị              | ~65                                           |

Nhóm 10 tài liệu nhanh nhất và 10 tài liệu chậm nhất tách biệt gần như hoàn hảo theo
table_score — cả 10 tài liệu nhanh nhất đều có table_score < 3.600; cả 10 tài liệu chậm
nhất đều có table_score > 12.000. Đây là cơ chế khác với hiệu ứng tăng tốc nhờ bỏ qua lớp
văn bản sẵn có mà đánh giá trước đã phát hiện (1,1-1,3 giây/trang ở đó): cả 50 tài liệu ở
đây đều được pdf-inspector phân loại "scan toàn bộ," nên không tài liệu nào được hưởng lợi
từ đường tắt đó. Thay vào đó, độ chênh lệch tương ứng với khối lượng công việc mà công
đoạn nhận diện cấu trúc bảng của docling phải làm — lưới bảng càng dày càng có nhiều ô
ứng viên cần xử lý, không phụ thuộc vào việc văn bản bên dưới dễ hay khó đọc.

Tài liệu tốn thời gian nhất, bỏ xa các tài liệu khác: `74/2022/QH15`, 163 trang (hơn 3
lần tài liệu lớn thứ nhì), tổng 7.567,9 giây — chiếm 13,4% tổng thời gian tính toán của
cả lần chạy này. Đây cũng là tài liệu có lỗi độ chính xác nghiêm trọng nhất (mục tiếp
theo), khó có thể là trùng hợp ngẫu nhiên khi cả hai đều bắt nguồn từ cùng các công đoạn
xử lý bên dưới.

## Phát hiện chính: mật độ bảng làm sập độ chính xác dấu tiếng Việt

Dấu tiếng Việt mang ý nghĩa quyết định (`ma`/`má`/`mà`/`mã`/`mạ` là năm từ khác nhau) —
đây là trục đúng-sai trung tâm trong đánh giá trước, và EasyOCR(vi) chính là cách khắc
phục của đánh giá đó. Lần chạy này phát hiện ra một giới hạn thực sự của cách khắc phục ấy.

**Phương pháp:** đếm số ký tự có dấu tiếng Việt trên tổng số ký tự đầu ra của từng tài
liệu (regex trên các chữ cái có dấu dạng precomposed). Đã kiểm tra kỹ để loại trừ khả
năng đây chỉ là hiện tượng do chuẩn hóa Unicode trước khi tin vào kết quả này — dự án đã
từng gặp lỗi NFD/NFC được ghi nhận trước đó
(`docs/monitoring/law-index-flagged-documents.md` §16) nên đã kiểm tra trực tiếp: không
có ký tự combining mark nào trong dải U+0300-U+036F ở các tài liệu điểm thấp, và chuẩn
hóa lại theo NFC cũng không thay đổi gì. Các ký tự đó thực sự không phải là dấu — kiểm
tra trực tiếp đầu ra của tài liệu tệ nhất cho thấy các ký hiệu Latin-1 lạc chỗ
(`£ § © « ® · » • € ■`) xuất hiện thay cho các chữ cái có dấu — đây là lỗi nhận diện OCR
thật sự, không phải hiện tượng do mã hóa.

**Kết quả:** hệ số tương quan Pearson giữa table_score và tỷ lệ dấu tiếng Việt trên toàn
bộ 50 tài liệu: **r = -0,641** — một mối tương quan mạnh, rõ ràng, không phải nhiễu. Các
tài liệu có table_score dưới khoảng 1.500 phần lớn nằm trong khoảng tỷ-lệ-dấu lành mạnh
0,10-0,20 (khớp với mật độ dấu bình thường của văn bản tiếng Việt); các tài liệu trên
khoảng 10.000 phần lớn sập xuống còn 0,02-0,09.

- **17/50 (34%)** dưới 0,06 (dưới 40-60% mật độ dấu bình thường)
- **8/50 (16%)** dưới 0,03 (gần như mất dấu hoàn toàn)
- **1/50** mất dấu hoàn toàn: `74/2022/QH15` — 672.131 ký tự, **không một** ký tự có dấu
  nào trong toàn bộ 163 trang. Ví dụ một dòng: `"Can cu Hien phdp nuac Cong hoa xd hoi chit nghia Viet Ham"` (đúng ra phải là `"Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam"`) — mọi từ có dấu đều bị tước dấu trơ hoặc thay bằng một chữ cái
  thường khác hẳn.

Ngay cả tài liệu dùng để kiểm chứng heuristic của chính lần chạy này, `246/2025/QH15`
(table_score 21.118, đã được xác nhận trong đánh giá trước là có dấu đúng trong bảng của
nó) — cũng chỉ đạt 0,083, dưới mức nền lành mạnh. Đọc lướt nhanh qua nó (xem bên dưới)
vẫn cho cảm giác "tiếng Việt phần lớn là đúng," và đó chính xác là rủi ro: **mức độ suy
giảm đủ nghiêm trọng ở quy mô tổng thể để trở thành một vấn đề chất lượng dữ liệu thực
sự, nhưng không phải lúc nào cũng đủ nghiêm trọng để lộ rõ khi kiểm tra qua loa** — cần
kiểm tra bằng mật độ ký tự, chứ không phải đọc lướt, mới phát hiện được một cách đáng tin
cậy.

Phát hiện này không xuất hiện trong đánh giá trước vì bộ 11 tài liệu/295 trang dùng để
thử OCR ở đánh giá đó không được chọn theo mật độ bảng — tình cờ chứa rất ít bảng thực sự
dày đặc, nên lỗi này chưa có cơ hội bộc lộ. Đây là một khoảng trống thực sự trong hiểu
biết của dự án về pipeline này, không phải là một sự thoái lui — kết luận "đã sửa được
dấu" trước đó vẫn đúng đối với nội dung chủ yếu là văn xuôi; chỉ là nó không áp dụng được
cho nội dung nhiều bảng biểu theo cách mà báo cáo trước ngụ ý.

**Giả thuyết về nguyên nhân gốc (chưa được xác nhận):** bảng lưới dày đặc có khả năng tạo
ra các vùng văn bản hẹp, có ranh giới sát nhau cho từng ô trong quá trình phân tích bố
cục, đây là một tác vụ nhận diện khó hơn đối với EasyOCR so với văn bản xuôi dòng có
nhiều ngữ cảnh xung quanh hơn. Chưa được kiểm chứng, nhưng phù hợp với mối tương quan
quan sát được và với hiện tượng mất nội dung theo từng ô được ghi nhận trực tiếp ở phần
kiểm tra độ trung thực của bảng bên dưới.

## Độ trung thực của cấu trúc bảng: đúng hình dạng, nội dung không nhất quán

Hai tài liệu ở hai thái cực về độ phức tạp bảng, cả hai đều được kiểm tra trực tiếp so
với markdown đầu ra đã render:

**`246/2025/QH15`** (đơn giản, 3 cột: STT | Nội dung | Dự toán) — nhãn hàng và số liệu
phần lớn được ghi nhận và căn đúng cột:

```
| STT | NỘI DUNG                                              | DỰ TOÁN   |
| A   | CHI BỎ SUNG CÂN ĐÓI CHO NSĐP                          | 238.421   |
|     | Chi đầu tư phát triển                                 |           |
| 2   | Chi an ninh và trật tự an toàn xã hội                 | 152.190   |
```

Vẫn còn lỗi sai thứ tự từ đã biết từ đánh giá trước bên trong các ô nhiều từ (ví dụ
`"Chi khoa học, nghệ, đổi mới tạo và chuyển đổi số công sáng"` — `"công nghệ"` và
`"sáng tạo"` bị đảo lộn — đúng ra phải là `"Chi khoa học, công nghệ, đổi mới sáng tạo và chuyển đổi số"`), xác nhận lỗi đó thực sự độc lập với lỗi mới và vẫn tồn tại nguyên vẹn ở
quy mô này.

**`132/2024/QH15`** (dày đặc, 7+ cột số liệu, bảng đối chiếu ngân sách) — *cấu trúc* bảng
(hình dạng hàng/cột) được ghi nhận thành một pipe-table thật sự, nhưng một phần đáng kể
các ô bị bỏ trống ở chỗ lẽ ra phải có nhãn hàng:

```
| STT | NỌl DUNG | DỰ TOÁN     |           |           |           |
|     | [Thu NSNN|             |           |           |           |
| 2   |          | 1.178.408   | 1.447.915 | 565.362   | 882.553   |
|     |          | 28.200      | 78.137    | 78.137    |           |
```

Các hàng chỉ có số mà không có nhãn thì không dùng được nếu thiếu nhãn — đây là một lỗi
khác, tệ hơn lỗi tước dấu: mất nội dung, không chỉ là ký tự bị sai lệch. Độ phức tạp của
bảng (số cột, mật độ ô) dường như làm suy giảm khả năng ghi nhận nội dung, không chỉ độ
chính xác dấu — có khả năng cùng một cơ chế bên dưới với mối tương quan mật độ dấu ở trên.

## Số liệu tổng hợp

**Độ tin cậy:** 909/909 trang (100%), 50/50 tài liệu (100%), 0 lỗi OCR ở cấp trang, 2/2
lần sập toàn bộ pool ở tầng hạ tầng đều tự phục hồi nhờ checkpoint, không mất trang nào ở
cả hai lần.

**Tốc độ:** 56.587,9 giây (15,72 giờ) tổng thời gian tính toán OCR cộng dồn qua các
trang; khoảng 4,9 giờ thời gian thực tế cho cả hai lần chạy (3-4 worker trừ đi chi phí
crash/khởi động lại) — tương đương tăng tốc khoảng 3,2 lần nhờ chạy song song. Khoảng
dao động 18,6-166,8 giây/trang, tương quan mạnh với table_score (xem ở trên). Tài liệu
tốn chi phí nhất: `74/2022/QH15` với 7.567,9 giây (13,4% tổng thời gian tính toán) cho
163 trang.

**Độ chính xác:** tỷ lệ mật độ dấu dao động từ 0,0000 đến 0,20 trên 50 tài liệu (mức nền
lành mạnh khoảng 0,10-0,20), hệ số tương quan Pearson r = -0,641 so với table_score. Lỗi
sai thứ tự từ từ đánh giá trước được xác nhận vẫn còn nguyên, không đổi, độc lập với phát
hiện mới về sập dấu tiếng Việt.

**Độ trung thực của bảng:** cấu trúc (hình dạng hàng/cột, cú pháp pipe-table) được ghi
nhận đúng bất kể độ phức tạp; độ trung thực nội dung suy giảm theo số cột/mật độ ô — bảng
đơn giản phần lớn dùng được, bảng tài chính dày đặc mất nhãn hàng thành ô trống.

## Kết luận

docling + EasyOCR(vi) xử lý từng trang vẫn là cấu hình duy nhất đã kiểm chứng có thể *hoàn
tất* một cách đáng tin cậy trên nội dung tiếng Việt đã scan của kho ngữ liệu này — phát
hiện đó từ đánh giá trước vẫn đứng vững và nay đã được xác nhận ở quy mô thực (909 trang,
hai lần sập hạ tầng, không mất dữ liệu). Nhưng lần chạy này bổ sung một điều kiện thực sự,
trước đây chưa từng biết đến: **cam kết về độ chính xác của nó chỉ đúng đối với nội dung
chủ yếu là văn xuôi.** Ở đúng phần tài liệu mang nhiều dữ liệu dạng bảng nhất — biểu thuế,
phân bổ ngân sách, phụ lục — chính là nội dung đáng giá nhất cần chính xác trong một kho
ngữ liệu RAG pháp lý — độ chính xác dấu và nội dung suy giảm mạnh và khó lường khi mật độ
bảng tăng lên.

Điều này có nghĩa là pipeline được khuyến nghị trong báo cáo trước cần thêm một điều kiện
đi kèm, chứ không phải bị đảo ngược: nó vẫn là lựa chọn mặc định đúng đắn cho OCR-fallback,
nhưng một tài liệu (hoặc trang) đạt điểm cao theo heuristic phát hiện lưới bảng xây dựng
cho đánh giá này nên được coi là cần thêm sự giám sát hoặc một hướng xử lý khác, không nên
được tin tưởng ở cùng mức độ như các trang văn xuôi.
`sandbox/extract-tool-resilience/scripts/detect_table_gridlines.py` bản thân nó là một
ứng viên cho vai trò gác cổng đó, vì đã tự chứng minh là một tín hiệu tiền-OCR mạnh, rẻ,
và chính xác đối với đúng loại rủi ro này.

Các bước tiếp theo chưa được kiểm chứng, chưa thực hiện: liệu `TesseractOcrOptions` (đã
được đề xuất nhưng chưa từng thử nghiệm trong báo cáo trước cho lỗi sai thứ tự từ) có
giúp ích hay làm tệ hơn đối với bảng dày đặc; liệu tăng độ phân giải render riêng cho các
trang có điểm lưới cao có cải thiện việc phân tách ô hay không; liệu pipeline VLM riêng
của docling (`ApiVlmOptions`/`InlineVlmOptions`, đã xác nhận là tồn tại nhưng chưa được
đánh giá ở bất kỳ đâu trong dự án này) có xử lý bảng dày đặc tốt hơn không, vì nó không
được xây dựng trên cùng kiến trúc phân-tích-bố-cục-rồi-OCR-theo-vùng mà phát hiện này chỉ
ra là nguyên nhân.

## Files

- `samples/docling/`, `samples/docling_manifest.json` — bộ mẫu 50 tài liệu/909 trang và
  điểm số lưới bảng của chúng (mẫu bị gitignore, manifest được theo dõi)
- `outputs/docling/*.md` — markdown đầu ra tổng hợp của từng tài liệu
- `outputs/docling/_chunk{0-4}_timings.json` — dữ liệu checkpoint/thời gian theo từng
  trang (nguồn của mọi con số trong báo cáo này)
- `docling_results_summary.json` — tổng hợp theo từng tài liệu (số trang, thời gian, số
  ký tự, table_score)
- `scripts/detect_table_gridlines.py` — heuristic sàng lọc mật độ bảng
- `scripts/run_docling_parallel.py` — harness chạy song song có checkpoint/auto-retry
- `scripts/aggregate_docling_results.py` — script tổng hợp thời gian dùng cho báo cáo này
