# docling + VLM cục bộ, xử lý từng trang, xuất văn bản thuần: báo cáo thăm dò

Phạm vi: **chỉ docling, pipeline VLM**, mang tính thăm dò và bổ sung cho
`DOCLING_REPORT.md` (đánh giá dựa trên EasyOCR trên cùng mẫu 50 tài liệu/909
trang). Đây không phải là một bản thay thế hoàn toàn ngang hàng với báo cáo
đó — đây ghi lại một kiến trúc pipeline khác đã hình thành qua quá trình thử
nghiệm chủ động, bao gồm ba lỗi thật sự được tìm ra và sửa hoặc mới được xác
định dọc đường (một lỗi trong chính phần xuất bảng của docling, hai lỗi trong
parser sản xuất của dự án). Trong khi `DOCLING_REPORT.md` kiểm chứng
`docling + EasyOCR(vi)`, báo cáo này kiểm chứng pipeline `VlmPipeline` riêng
của docling với một mô hình tự triển khai (self-hosted), với một thiết kế đầu
ra khác biệt đáng kể: thay vì yêu cầu mô hình tạo ra Markdown/HTML có cấu
trúc, nó được yêu cầu phiên âm thành văn bản thuần và giao việc khôi phục cấu
trúc cho parser sản xuất sẵn có của dự án. 47 trong số 50 tài liệu mẫu đã
hoàn tất với cấu hình cuối cùng.

## Tóm tắt điều hành

**Giả thuyết cốt lõi — phiên âm văn bản thuần cộng với parser sản xuất sẵn có
`document-node.parser.ts`, không cần gắn thẻ cấu trúc nào — đã được kiểm
chứng bằng bằng chứng thật, không chỉ là một bằng chứng khái niệm (proof of
concept).** 47 trong số 50 tài liệu đã hoàn tất với một cấu hình đã được tinh
chỉnh ổn định; cả 47 tài liệu đều được phân tích qua parser sản xuất thật
không có ngoại lệ nào, khôi phục được 331 Điều, 1.115 Khoản, 554 Điểm, 144
Phụ lục, và cấu trúc phân cấp Chương/Phần/Mục nhiều tầng thật sự ở những nơi
có. Để đạt được điều này cần phải xử lý qua một số lỗi thật, không hiển
nhiên — một mô hình cloud âm thầm bỏ qua các trang do bộ lọc nội dung, các
token "suy nghĩ" ẩn của một mô hình reasoning, một lỗi định dạng bảng trong
chính tầng xuất của docling, hai lỗi phiên âm trang — và, chỉ khi chạy toàn
bộ mẫu, một khoảng trống thứ hai, hệ trọng hơn trong chính parser sản xuất,
nơi "0 ngoại lệ" không có nghĩa là "0 mất nội dung âm thầm". Mỗi phát hiện
đều được chẩn đoán bằng bằng chứng trực tiếp thay vì mặc định coi là đã sửa.

| Phát hiện | Kết quả |
| --- | --- |
| Khôi phục cấu trúc (cấu hình cuối cùng) | 47/47 phân tích thành công, 0 ngoại lệ — nhưng xem khoảng trống parser bên dưới; không ngoại lệ không đồng nghĩa với nội dung đầy đủ |
| Cấu trúc tổng hợp khôi phục được | 331 Điều, 1.115 Khoản, 554 Điểm, 144 Phụ lục, 20 Chương, 1 Phần, 9 Mục |
| VLM cloud (Gemini qua gateway) | Bị loại bỏ — âm thầm bỏ qua 5/9 trang do bộ lọc nội dung, không thể phát hiện nếu không kiểm tra provenance ở cấp từng phần tử |
| VLM cục bộ (mô hình reasoning) | Khả thi khi đặt `reasoning_effort: "none"`; vẫn cần ngân sách `max_tokens` lớn dù có tắt reasoning |
| Định dạng bảng | Pipe-table Markdown gốc không thể biểu diễn ô hợp nhất; HTML với `colspan`/`rowspan` thật hoạt động, nhưng chỉ khi dùng `table.export_to_html()` — `export_to_markdown()` của chính docling có lỗi làm hỏng các bảng có ô hợp nhất |
| Kiến trúc | Một yêu cầu duy nhất cho toàn bộ tài liệu → quay lại xử lý từng trang thật sự khi văn bản thuần (không thẻ) loại bỏ lý do cần gộp nhiều trang lại |
| **Khoảng trống parser mới** | Một Nghị quyết thật không có bao bọc `Điều` nào cả (nội dung thực chất nằm trực tiếp dưới `"QUYẾT NGHỊ:"` dưới dạng các mục đánh số trần) bị mất toàn bộ thân bài — 319 dòng — một cách âm thầm; parser không có cơ chế dự phòng cho biến thể cấu trúc hợp lệ, có thật này |
| **Rủi ro còn mở** | 3/50 tài liệu thất bại hoàn toàn (gateway/network timeout 300+ giây trên từng trang dày đặc, không hoàn toàn xác định với từng tài liệu); phát hiện một lần hiện tượng bịa số hiệu văn bản, chưa kiểm chứng lại ở cấu hình cuối; độ chính xác nội dung bảng chưa được kiểm chứng ở quy mô lớn |

## Thiết lập

**Gateway:** Bifrost (kiểu LiteLLM), API tương thích OpenAI
`/v1/chat/completions`, cấu hình qua `sandbox/extract-tool-resilience/.env`
(không commit — xem `.gitignore` ở gốc dự án). Hai mô hình đã được thử nghiệm
xuyên suốt quá trình tìm hiểu này:

- **Cloud:** `gemini/gemini-3.1-flash-lite` — bị loại bỏ, xem phần Phát hiện.
- **Cục bộ/tự triển khai:** `SDS-AI/softdream`, một mô hình có khả năng
  reasoning chạy qua vLLM đằng sau cùng gateway — được dùng cho mọi kết quả
  báo cáo ở đây.

**Tài liệu thử nghiệm:** đào sâu trên một tài liệu duy nhất `128/2020/QH14`
(9 trang, table_score 2055 — tài liệu có độ phức tạp trung vị từ mẫu nhiều
bảng biểu của `DOCLING_REPORT.md`, được chọn vì thực sự là một trường hợp
"trung bình", không phải chọn lọc có chủ đích). Kiểm tra quy mô lớn trên cùng
mẫu 50 tài liệu/909 trang dùng xuyên suốt `extract-tool-resilience`
(`samples/docling/`, `docling_manifest.json`).

**Kết nối:** dùng `VlmPipeline` + `ApiVlmOptions` của docling cho các thử
nghiệm ban đầu (`enable_remote_services=True` là bắt buộc — docling mặc định
từ chối gọi dịch vụ từ xa). Harness kiểm tra quy mô lớn cuối cùng bỏ qua hoàn
toàn pipeline của docling, thay bằng một script tự viết gọi API trực tiếp —
xem phần Phát hiện để biết lý do.

## Phát hiện

### VLM cloud: âm thầm bỏ qua trang do bộ lọc nội dung, không phải lựa chọn mặc định khả thi

Lần thử nghiệm toàn tài liệu đầu tiên với Gemini trông có vẻ sạch sẽ ở bề mặt
— `ConversionStatus.SUCCESS`, đúng số trang 9, 11.312 ký tự đầu ra có cấu
trúc tốt. Kiểm chứng trực tiếp (ánh xạ từng phần tử nội dung về trang nguồn
qua `item.prov[0].page_no`) cho thấy một câu chuyện khác: **các trang 1-5
không có phần tử nội dung nào cả** — không `TextItem`, không `TableItem`,
không gì hết. Chỉ có 4 bảng phụ lục (trang 6-9) là có nội dung.

Nguyên nhân gốc, đã xác nhận bằng cách gọi trực tiếp gateway và kiểm tra JSON
thô: các trang 1-5 trả về `finish_reason: content_filter` — bộ phân loại an
toàn của Gemini chặn hoàn toàn việc sinh nội dung trên các trang có nội dung
tiêu đề/trích dẫn mang tính chính phủ (`"QUỐC HỘI"`, trích dẫn "Hiến pháp",
tham chiếu đến các báo cáo/nghị định cụ thể của chính phủ), trong khi các
trang phụ lục thuần số liệu lại đi qua bình thường. Một phản hồi bị lọc nội
dung không có completion, nên `usage.completion_tokens` bị thiếu trong JSON —
điều này khiến mô hình Pydantic `OpenAiResponseUsage` của docling báo lỗi
(trường này bắt buộc, không có giá trị mặc định), và trình xử lý ngoại lệ
rộng của docling (`api_image_request.py`) âm thầm nuốt lỗi validate đó thành
văn bản rỗng. **`ConversionStatus.SUCCESS` và số trang đúng không đảm bảo có
nội dung thật ở từng trang** — đây là một khoảng trống độ tin cậy thật sự của
docling, đáng biết đến bất kể mô hình nào đứng sau API.

Đã thử kỹ thuật prompt để né bộ lọc: một prompt tối giản (`"Extract the text from this image as Markdown."`) vượt qua được bộ lọc trên 3 trong 5 trang bị
chặn, nhưng với cái giá tệ hơn cả việc bị chặn — mô hình chuyển từ phiên âm
sang **tóm tắt** (`"Dựa trên văn bản bạn cung cấp, dưới đây là các thông tin chính..."`), một kiểu lỗi trông có vẻ hợp lý nhưng âm thầm thay thế văn bản
thật. Một prompt nghiêm ngặt hơn ("OCR nguyên văn, không tóm tắt") khắc phục
được vấn đề đó nhưng lại bị lọc lại trên mọi trang được thử, kể cả trang mà
prompt tối giản đã vượt qua được. Không có biến thể prompt nào giải quyết
được vấn đề này một cách đáng tin cậy. Đã chuyển sang dùng mô hình cục bộ
thay vì tiếp tục theo đuổi hướng này.

### Mô hình reasoning cục bộ: token "suy nghĩ" ẩn, cách sửa thật, chi phí mới thật

Mô hình tự triển khai hóa ra là một mô hình reasoning/"thinking" — nó sinh ra
chuỗi suy luận (chain-of-thought) trong một trường phản hồi `reasoning` riêng
biệt trước khi đưa ra câu trả lời thật trong `content`. Một prompt đơn giản
"2+2 bằng mấy?" đã tiêu tốn 161 completion token, gần như toàn bộ là suy
luận, trước khi mô hình bắt đầu vào câu trả lời thật. Hai hệ quả: `max_tokens`
cần có dư địa thật sự (4096 không đủ cho việc suy luận cộng phiên âm một
trang đầy đủ; chốt ở mức 8192-24000 tùy tác vụ) nếu không phản hồi sẽ bị cắt
giữa chừng suy luận mà không có câu trả lời thật nào cả, và độ trễ mỗi yêu
cầu cao hơn đáng kể so với một mô hình không-reasoning.

Theo hướng dẫn do người dùng cung cấp riêng cho deployment Bifrost/vLLM này,
`chat_template_kwargs.enable_thinking: false` (cách phổ biến hơn được ghi
nhận để tắt reasoning của họ Qwen) bị âm thầm bỏ qua trên deployment này —
**`reasoning_effort: "none"` (một trường request cấp cao nhất) là cách duy
nhất đã được xác minh hoạt động để tắt reasoning ở đây**, đã xác nhận trực
tiếp: completion token cho bài test đơn giản giảm từ 161 xuống 2, và một lần
phiên âm toàn tài liệu 9 trang giảm từ 296,4 giây xuống còn 170,0 giây khi
tắt reasoning.

Tuy nhiên tắt reasoning không phải là miễn phí: trên cùng tài liệu 9 trang,
2 trong 4 bảng bị thoái lui từ Markdown sạch thành cú pháp LaTeX thô, không
thể phân tích được (`\begin{tabular}{|l|l|r|} \hline STT &amp; NỘI DUNG...`)
và nội dung của bảng thứ 4 biến mất hoàn toàn thay vì chỉ định dạng sai.
Reasoning dường như đã thực sự đóng góp vào bước cụ thể "nhận ra đây là bảng,
chuyển đổi đúng cách"; khi không có nó, mô hình đôi khi quay về một bản phiên
âm dự đoán đầu tiên theo nghĩa đen thay vì tuân theo chỉ dẫn định dạng. Đây
chính là điều thúc đẩy phần tìm hiểu về định dạng bảng bên dưới, không phải
là một hiện tượng ngẫu nhiên đơn lẻ.

### Định dạng bảng: pipe-table Markdown không thể chứa ô hợp nhất; chính docling có lỗi ở phần xuất

Cú pháp bảng Markdown chuẩn không có tương đương cho `colspan`/`rowspan` —
đây là một giới hạn cấu trúc, không phải lỗi của mô hình. Đã thử một chỉ dẫn
rõ ràng: bảng thường (không ô hợp nhất) → pipe-table Markdown gốc; bảng có
tiêu đề hợp nhất hoặc ô trải rộng → bảng HTML `<table>` với thuộc tính
`colspan`/`rowspan` thật. Cách này loại bỏ hoàn toàn hiện tượng rơi về LaTeX
(0/6 trong một lần kiểm tra khả năng lặp lại có mục tiêu, 3 lần thử mỗi
trang) và khôi phục hoàn toàn bảng phức tạp trước đó bị mất, tái tạo đúng cấu
trúc tiêu đề trải rộng thật của nó. Một hiện tượng lạm dụng nhỏ, vô hại được
quan sát: đôi khi mô hình dùng `rowspan="2"` trên một bảng mà hàng tiêu đề
thứ hai của nó thực ra không cần điều đó (không có cột nào thực sự trải
rộng) — chỉ mang tính thẩm mỹ, không ảnh hưởng dữ liệu.

**Quan trọng hơn, và riêng biệt: chính `export_to_markdown()` của docling có
một lỗi thật với các ô hợp nhất.** Cho một tài liệu có bảng `colspan=2` thật
đi qua đường xuất Markdown thông thường tạo ra một kết quả trùng lặp, gây
hiểu lầm — `CHIA RA` (một tiêu đề dự định trải rộng 2 cột) trở thành hai cột
`CHIA RA | CHIA RA` theo nghĩa đen, theo sau bởi một hàng "dữ liệu" giả chỉ
lặp lại văn bản tiêu đề (`STT | NỘI DUNG | NSNN | ...`) như thể đó là nội
dung thật. Đã xác nhận đây là lỗi ở tầng xuất, không phải mất dữ liệu: đọc
trực tiếp `table.data.table_cells` cho thấy cấu trúc bên dưới đúng
(`row_span=2` trên `STT`/`NỘI DUNG`/`NSNN`, `col_span=2` trên `CHIA RA`) vẫn
còn nguyên vẹn, và `table.export_to_html()` trên cùng dữ liệu đó tạo ra HTML
sạch, đúng (`<td rowspan="2">STT</td>...<td colspan="2">CHIA RA</td>`). Cách
sửa là gọi `export_to_html()` thay vì `export_to_markdown()` — dữ liệu chưa
bao giờ sai, chỉ một trong hai đường xuất bị lỗi.

### Bước ngoặt kiến trúc: văn bản thuần + parser sẵn có, không phải thẻ có nhận biết cấu trúc

Một nỗ lực kéo dài nhằm khiến mô hình trực tiếp phát ra thẻ HTML ngữ nghĩa
(`<h1>`-`<h6>` cho toàn bộ phân cấp Phần→Chương→Mục→Tiểu mục→Điều/Phụ lục,
`<ol>`/`<ol type="a">` cho Khoản/Điểm) đã có những tiến bộ thật, đo lường
được với các quy tắc ngày càng rõ ràng — độ nhất quán cấp tiêu đề của Điều đi
từ 1 đúng trên 4 (không có quy tắc) lên 4/4 đúng khi mỗi loại phần tử được
gán một thẻ chính xác, xác định rõ bất kể trang nào — nhưng vấp phải một giới
hạn cứng: mỗi trang là một request VLM **độc lập** không có ký ức về việc các
trang trước đó đã được gắn thẻ như thế nào, nên không có gì đảm bảo `Điều 1`
ở trang 1 và `Điều 4` ở trang 4 rơi vào cùng một cấp tiêu đề, hay một trang
Phụ lục không có nhãn "Phụ lục" hiển thị trên trang (bị che một phần bởi con
dấu chính thức, trong trường hợp thực tế đã tìm thấy) được nhận diện là phần
đính kèm thay vì một tài liệu mới.

Cách sửa thực sự là một cách nhìn lại, không phải thêm một vòng tinh chỉnh
prompt nữa: parser sản xuất thật của dự án này
(`server/src/law-index/crawl/document-node.parser.ts`) đã tồn tại sẵn, được
hiệu chỉnh kỹ lưỡng dựa trên các tài liệu vbpl.vn thật (hàng chục trường hợp
biên được đặt tên, trích dẫn cụ thể — mảnh bảng bị đọc nhầm thành đánh số
Khoản, khối trích dẫn trích lại cấu trúc của một tài liệu khác, khối chân
trang chữ ký, nội dung trùng lặp, các dấu nhóm ngoài lề, các biến thể Unicode
NFD/NFC), và — đã xác nhận trực tiếp từ docstring của chính nó và
`vbpl-client.service.ts`'s `fullText: (pane as HTMLElement).innerText` — đã
kỳ vọng sẵn **văn bản thuần với ngắt dòng tự nhiên, không HTML hay Markdown
gì cả**. Yêu cầu VLM *phiên âm* trung thực (một tác vụ OCR tự nhiên) và để
parser sẵn có *suy luận* cấu trúc từ các mẫu bắt đầu-dòng loại bỏ hoàn toàn
vấn đề nhất quán gắn thẻ — không có cấp tiêu đề nào để sai nếu ngay từ đầu
không có thẻ nào để gán. `DoclingDocument.export_to_text()` (loại bỏ đánh
dấu tiêu đề/đậm/nghiêng, giữ lại đánh số danh sách và dấu phân cách pipe của
bảng) là đích xuất tương ứng.

### Hai lỗi phiên âm thật được tìm ra và sửa

**Lần thử phiên âm văn bản thuần theo từng trang đầu tiên thất bại hoàn
toàn** — `parseDocumentBody()` trả về 0 node gốc, kể cả Điều đầu tiên cũng
không có. Nguyên nhân gốc, tìm ra bằng cách kiểm tra trực tiếp văn bản đã
phiên âm: hai lỗi ngắt dòng độc lập, cả hai đều đặc thù cho việc xử lý từng
trang:

1. Tiêu đề hai cột của trang đầu tiên (`"QUỐC HỘI"`/cơ quan ban hành bên trái,
   `"CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"`/quốc hiệu bên phải) bị trộn lẫn
   thành một dòng liên tục thay vì được phiên âm thành hai dòng riêng biệt.
2. Nội dung trải qua ranh giới trang bị hỏng do chữ số trang vật lý dính vào
   văn bản liền kề — ví dụ `"2 Điều 2. Điều chỉnh..."`, số trang của chính
   trang 2 bị gắn trực tiếp vào văn bản tiêu đề thật. Vì `DIEU_KHOAN_PATTERN`
   được neo để khớp một dòng bắt đầu bằng `"Điều"`, điều này âm thầm phá vỡ
   việc nhận diện cho mọi tiêu đề `Điều` trong tài liệu thử nghiệm — cả bốn
   Điều đều hoặc bị chữ số lạ đứng trước, hoặc bị chôn giữa câu, hoặc bị chia
   cắt qua ranh giới trang.

**Cách sửa, và bằng chứng nó hoạt động:** chuyển sang gửi mọi trang của một
tài liệu dưới dạng nhiều ảnh trong một request duy nhất (bỏ qua pipeline của
docling, vốn không có chế độ nhiều-trang-mỗi-request) với hai chỉ dẫn rõ
ràng — đọc các cột tiêu đề từ trên xuống dưới, cột trái rồi đến cột phải,
không bao giờ trộn chúng vào một dòng; và nhận diện số trang là một hiện
tượng bố cục cần bỏ qua hoàn toàn, nối lại bất kỳ câu/Khoản/Điều nào trải qua
ranh giới trang như thể ranh giới đó chưa từng tồn tại. Kết quả trên cùng tài
liệu thử nghiệm: cả 4 Điều được nhận diện đúng với **chính xác** đúng số
Khoản (4, 10, 8, 2) khớp với nguồn, không có hiện tượng số trang lạ, tiêu đề
được tách sạch sẽ.

### Một lỗi thật được tìm ra trong parser sản xuất, không chỉ ở đường VLM

Sau khi các lỗi phiên âm đã được sửa, nội dung bảng (4 bảng phụ lục) vẫn còn
thiếu khỏi cây đã phân tích — nhưng lần này nguyên nhân nằm **trong chính
parser sẵn có**, không liên quan gì đến những gì VLM làm sai. Khối chữ ký của
tài liệu đọc như sau:

```
CHỦ TỊCH QUỐC HỘI
Nguyễn Thị Kim Ngân
```

`FOOTER_START_PATTERN` chỉ nhận diện `"Nơi nhận:"`, `"TM./KT. <chức danh>"`,
hoặc `"THAY MẶT"` là các dòng mở đầu khối chữ ký — một tài liệu mà người ký
mở đầu trực tiếp bằng dòng chức danh độc lập của chính họ (không có tiền tố
`TM./KT./THAY MẶT` nào cả) không nằm trong số đó, nên cơ chế loại bỏ chân
trang không bao giờ được kích hoạt và mọi thứ sau đó — dòng chữ ký, cả 4 bảng
— âm thầm tích lũy thành văn bản thường vào Khoản thật cuối cùng thay vì được
tách riêng. Điều này sẽ ảnh hưởng đến các tài liệu thật lấy từ vbpl.vn dùng
đúng định dạng chữ ký này nữa, không chỉ đường xử lý OCR này.

**Cách sửa:** thêm `SIGNATURE_TITLE_PATTERN`, khớp một dòng chức danh người
đứng đầu cơ quan Việt Nam độc lập (Chủ tịch nước/Quốc hội, Thủ tướng, Bộ
trưởng, Tổng thư ký, v.v.), được neo khớp toàn bộ dòng để tránh bắt nhầm cùng
cụm từ đó xuất hiện giữa câu trong văn bản thân bài thật. Chỉ có
`"CHỦ TỊCH QUỐC HỘI"` được xác nhận trực tiếp trên nội dung thật; các chức
danh liên quan khác là một suy diễn hợp lý, trung thực đã được ghi chú (cùng
tinh thần best-effort như phần còn lại của file đó, và được đánh dấu như vậy
trong chú thích mã nguồn) — chưa được xác nhận độc lập. Đã thêm một bài test
hồi quy dùng nội dung tài liệu thật; toàn bộ 47 bài test parser hiện có vẫn
pass (`npm test -- document-node.parser`).

### Khoảng trống thứ hai, lớn hơn của parser: "0 ngoại lệ" không phải là "0 mất nội dung âm thầm"

Chạy toàn bộ lô 47 tài liệu đã phát hiện một phiên bản hệ trọng hơn của cùng
bài học đó. Hai tài liệu tạo ra cây kết quả với **0 node Điều**, trông giống
hệt nhau trong bảng tổng hợp — đáng để kiểm tra cả hai thay vì mặc định coi
một trong hai là ổn:

- `61-2020-QH14` (lấy mẫu dưới tên `luat-dau-tu-2.pdf`) — không phải lỗi.
  File PDF được lấy mẫu thực sự chỉ là Phụ lục I của Luật Đầu tư (danh mục
  chất bị cấm đầu tư kinh doanh), xác nhận bằng chính dòng đầu tiên của nó:
  `"PHỤ LỤC (Ban hành kèm theo Luật Đầu tư số 61/2020/QH14)"`. 0 Điều là câu
  trả lời đúng cho đúng file nguồn cụ thể này.
- `263-2025-QH15` — một khoảng trống parser thật sự, trước đây chưa từng
  biết đến. Toàn bộ nội dung thực chất của Nghị quyết này nằm trực tiếp dưới
  `"QUYẾT NGHỊ:"` dưới dạng các mục đánh số trần, không có bao bọc `Điều`
  nào cả — `"1. Quốc hội ghi nhận, đánh giá cao nỗ lực của Chính phủ..."`,
  sau đó chia nhỏ thành `"2.1. Lĩnh vực tài chính"`, v.v. `KHOAN_PATTERN`
  chỉ được kiểm tra khi parser đang ở bên trong một container `Điều`/
  `Khoản`/`Điểm` đã mở; vì tài liệu này không bao giờ mở một container nào,
  mọi dòng trong số đó rơi vào trường hợp cuối cùng "không có container nào
  mở, không có nơi để gắn vào" và bị âm thầm loại bỏ — **319 trong số 565
  dòng đã phiên âm của tài liệu không bao giờ vào được cây kết quả**, không
  có ngoại lệ nào được ném ra và không có tín hiệu nào trong đầu ra tổng hợp
  ngoài việc "0 Điều" cần được xem xét kỹ hơn.

Đây là cùng loại vấn đề với khoảng trống `SIGNATURE_TITLE_PATTERN` ở trên —
một cấu trúc văn bản pháp lý Việt Nam hợp lệ, có thật mà parser không có cơ
chế bao phủ — nhưng hệ trọng hơn về hậu quả: cái trước làm mất một khối chữ
ký giá trị thấp, cái này làm mất toàn bộ nội dung thực chất của một nghị
quyết. Chưa được sửa trong báo cáo này (ngoài phạm vi của lần này); được ghi
chú ở đây vì con số "0 lỗi phân tích" tổng hợp nếu không sẽ đọc như một kết
quả sạch hơn thực tế — một parser không bao giờ ném ngoại lệ không phải là
cùng một đảm bảo với một parser không bao giờ âm thầm mất nội dung, và đây
chính xác là kiểu lỗi mà toàn bộ chuỗi đánh giá này được xây dựng để bắt
được thay vì tin tưởng một cách mặc định.

### Hạ tầng kiểm tra quy mô lớn: một lỗi ghi log, một trần cứng của gateway, và việc quay lại xử lý từng trang

Việc xây dựng harness kiểm tra 50 tài liệu có checkpoint đã phát hiện thêm
hai vấn đề thật, không hiển nhiên nữa:

**Log phình to do một hiện tượng của Bifrost.** Khi một request timeout, phản
hồi lỗi của gateway lặp lại một phần của request gốc — bao gồm cả các ảnh
trang đã mã hóa base64 của chúng ta — bên trong `extra_fields`. Việc chuyển
toàn bộ body lỗi thành chuỗi để ghi log một cách ngây thơ đã biến một vài lần
timeout thành một **file log 33MB** từ các dòng dài hàng triệu ký tự. Đã sửa
bằng cách chỉ trích xuất các trường `error.type`/`error.message` dễ đọc, và
giới hạn mọi chuỗi ngoại lệ ở 300 ký tự bất kể loại nào.

**Gateway tự áp đặt timeout 300 giây của riêng nó, độc lập với client.** Phát
hiện qua chính nội dung lỗi:
`"request timed out (default is 300 seconds). You can increase it by setting the default_request_timeout_in_seconds..."` — điều này kích hoạt bất kể
client yêu cầu timeout bao nhiêu (đã đặt 600 giây, không tạo ra khác biệt gì).
Các request theo chunk nhiều trang (ban đầu 25 trang, sau đó 6 trang mỗi
request) liên tục chạm gần hoặc vượt trần này — ngay cả chunk 4-5 trang đôi
khi cũng mất hơn 280 giây, và hai tài liệu thất bại hoàn toàn sau khi hết cả
3 lần thử lại.

**Giải pháp:** lý do ban đầu để gộp nhiều trang vào một request là để sửa
tính nhất quán gắn thẻ giữa các trang — điều này không còn cần thiết nữa một
khi pipeline chuyển sang văn bản thuần, không thẻ gì cả. Các cách sửa cho
tiêu đề hai cột và số trang là ở cấp prompt, không phải ở cấp kiến trúc, và
vẫn hoạt động tốt như nhau với một trang mỗi request. Quay lại **xử lý từng
trang thật sự** (một ảnh mỗi request) đã sửa trực tiếp vấn đề timeout — một
trang đơn trung bình mất 23-50 giây, thoải mái dưới trần — mà không mở lại
vấn đề gắn thẻ vốn không còn tồn tại nữa. Cần cẩn thận khi chuyển đổi: các
mục checkpoint từ sơ đồ chunk-6-trang đã bỏ được đánh chỉ mục theo số thứ tự
chunk, có nghĩa khác dưới sơ đồ 1-trang mới (`chunk "0"` có nghĩa là "trang
0-5" dưới một sơ đồ, "trang 0" dưới sơ đồ kia) — đã xóa các mục cũ cho bất kỳ
tài liệu nào chưa có đầu ra cuối cùng hoàn chỉnh trước khi tiếp tục, để tránh
âm thầm tái sử dụng dữ liệu một phần không khớp nhau.

## Số liệu tổng hợp

**Kiểm tra quy mô lớn (trạng thái cuối cùng):** tổng cộng 909 trang trong mẫu
thử; 47 trong số 50 tài liệu đã hoàn tất và được đưa qua parser
`parseDocumentBody()` thật.

| | Kết quả |
| --- | --- |
| Tài liệu đã phân tích | 47/47 đã thử — 0 ngoại lệ, 0 kết quả cây rỗng (2 trong số 47 có 0 node Điều vì lý do đã nêu ở trên — một đúng, một là khoảng trống parser thật sự) |
| Điều | 331 |
| Khoản | 1.115 |
| Điểm | 554 (có mặt trong 25/47 tài liệu) |
| Phụ lục | 144 (có mặt trong 38/47 tài liệu — xác nhận cách sửa mẫu chân trang vẫn đứng vững ở quy mô đầy đủ, không chỉ tài liệu duy nhất đã thúc đẩy nó) |
| Chương / Phần / Mục | 20 / 1 / 9 (7/47 tài liệu có phân cấp chương thật sự, không chỉ hình dạng Nghị quyết phẳng) |
| Tốc độ | Thường 23-50 giây/trang cho phần lớn tài liệu; một số ngoại lệ trong khoảng 170-225 giây/trang, và tài liệu 163 trang (`74/2022/QH15`) hoàn tất trọn vẹn với trung bình ~37 giây/trang (tổng 6.026 giây) — không có thất bại nào liên quan đến kích thước |
| Thất bại hoàn toàn | **3/50 tài liệu**: `37-2017-QH14`, `21-2026-QH16`, `132-2024-QH15` — đều có tên "phê chuẩn quyết toán ngân sách" / "bổ sung dự toán ngân sách", thất bại ngay cả ở mức xử lý từng trang thật sự, do từng trang riêng lẻ vượt trần 300 giây của gateway hoặc timeout đọc 600 giây của client. Không hoàn toàn xác định: một tài liệu thứ 4 cùng loại (`22-2021-QH15`) thất bại ở lần thử đầu nhưng thành công ở lần thử lại sau đó với cùng một cấu hình — đây là một rủi ro có tính xác suất tương quan với nội dung (gần như chắc chắn là mật độ bảng, khớp với phát hiện độc lập của `DOCLING_REPORT.md`), không phải một danh sách cố định các tài liệu bị chặn |

## Rủi ro còn mở — chưa được kiểm chứng ở cấu hình này

- **Hiện tượng bịa số hiệu văn bản, phát hiện một lần, chưa kiểm tra lại từ
  đó.** Đầu quá trình tìm hiểu này (một cấu hình gắn thẻ HTML trước đó, nay
  đã bị thay thế), cùng mô hình đó đã bịa ra số hiệu văn bản sai
  (`"118/2020/QH14"`, `"113/2020/QH14"`) trong 2 trong 3 chú thích bảng phụ
  lục trên một tài liệu thực chất là `128/2020/QH14` xuyên suốt. Đây là một
  vấn đề độ tin cậy của mô hình, độc lập với mọi cách sửa định dạng/kiến trúc
  trong báo cáo này — chưa được kiểm tra lại cụ thể đối với bất kỳ tài liệu
  nào trong lô 47 tài liệu ở cấu hình văn bản thuần theo từng trang cuối
  cùng.
- **Độ chính xác nội dung bảng chưa được kiểm chứng ở quy mô lớn.** *Cấu
  trúc* bảng (colspan/rowspan thật) đã được kiểm chứng trực tiếp trên một tài
  liệu. Lần chạy parser 47 tài liệu chỉ xác nhận cấu trúc Điều/Khoản/Điểm/Phụ
  lục, vì parser không kiểm tra nội dung bảng chút nào — một bảng nhúng bên
  trong một node Phụ lục thì vô hình đối với việc kiểm chứng này dù thế nào.
- **Khoảng trống parser mới đối với văn bản Nghị quyết không cấu trúc theo
  Điều.** `263-2025-QH15` mất thầm lặng 319/565 dòng nội dung thật vì toàn bộ
  thân văn bản nằm dưới `"QUYẾT NGHỊ:"` dưới dạng các mục đánh số trần, không
  có vỏ bọc `Điều` nào — `KHOAN_PATTERN` chỉ được kiểm tra khi đã ở trong một
  container `Điều`/`Khoản`/`Điểm` đang mở. Đây là một khoảng trống parser thật
  sự, nghiêm trọng hơn cách sửa mẫu chân trang đã tìm thấy trong phiên này vì
  nó làm mất phần thân thực chất của một nghị quyết chứ không chỉ một khối
  chữ ký — cố ý chưa được sửa trong phiên này (xem phần "Khoảng trống thứ hai,
  lớn hơn của parser" ở trên).
- **3/50 tài liệu thất bại hoàn toàn chưa giải quyết**, không chỉ là xui
  xẻo — cùng những tài liệu đó thất bại dưới mọi kích thước chunk đã thử (25,
  6, và giờ là từng trang riêng lẻ), cho thấy nội dung thực sự chậm để phiên
  âm chứ không phải là hiện tượng do việc gộp batch — cộng thêm một tài liệu
  thứ 4 có hành vi không xác định (thất bại rồi thành công ở lần thử lại),
  nghĩa là ngay cả danh sách 3 tài liệu này cũng không đảm bảo là đầy đủ và
  ổn định.

## Kết luận

Canh bạc kiến trúc cốt lõi — tin tưởng parser sản xuất sẵn có, đã được hiệu
chỉnh, để khôi phục cấu trúc từ văn bản thuần, thay vì yêu cầu một VLM độc
lập theo từng trang tự gắn thẻ cấu trúc đó một cách đúng đắn và nhất quán —
đã được kiểm chứng bằng bằng chứng thật ở quy mô đầy đủ: 47/47 tài liệu đã
thử phân tích không có ngoại lệ nào, cấu trúc khôi phục phong phú và đa dạng
(331 Điều, 1.115 Khoản, 554 Điểm, 144 Phụ lục), và ba rủi ro thật sự (một
trong chính tầng xuất của docling, một trong parser sản xuất — đã sửa — và
một khoảng trống parser khác mới phát hiện — chưa sửa) được tìm ra và nêu rõ
dọc đường thay vì bị lách qua. Dấu tiếng Việt sạch ở mọi nơi đã kiểm tra trực
tiếp, một tương phản thật sự với hiện tượng sập dấu tương quan mật độ bảng
nghiêm trọng mà `DOCLING_REPORT.md` đã tìm thấy với EasyOCR.

Dù vậy, "khá tốt" là mức độ tin cậy phù hợp, không phải "đã xong." Ba rủi ro
thật — hiện tượng bịa số hiệu văn bản, độ trung thực nội dung bảng, và
khoảng trống parser đối với văn bản Nghị quyết không cấu trúc theo Điều — đã
được xác định trong quá trình tìm hiểu này nhưng chưa được khép lại đối với
cấu hình cuối cùng, và cả ba đều quan trọng đặc biệt đối với một kho ngữ
liệu pháp lý, nơi một con số cụ thể, một mức thuế cụ thể, hay toàn bộ nội
dung một nghị quyết bị mất là một loại lỗi khác, tệ hơn so với một trục trặc
định dạng. Tỷ lệ thất bại hoàn toàn 6% (3/50) trên các tài liệu nhiều bảng —
với một tài liệu thứ 4 có hành vi không xác định — cũng chưa được giải
quyết, và nó lặp lại, chứ không đi chệch khỏi, cùng yếu tố rủi ro mật độ bảng
mà các đánh giá OCR của dự án này liên tục tìm thấy bất kể công cụ hay
pipeline nào được dùng.

## Khuyến nghị

Trước khi coi cấu hình này là ứng viên để thay thế hoặc bổ sung cho
`docling + EasyOCR(vi)` trong pipeline thực tế:

1. **Kiểm chứng độ chính xác số hiệu văn bản một cách cụ thể**, ít nhất trên
   một mẫu trong số 47 tài liệu đã hoàn tất — đối chiếu số tự trích dẫn đã
   biết của mỗi tài liệu với văn bản đã phiên âm của nó, theo đúng cách hiện
   tượng bịa số ban đầu đã bị phát hiện, vì không có kiểm tra nào khác trong
   báo cáo này sẽ bắt được một con số sai một cách tự tin.
2. **Kiểm tra trực tiếp nội dung bảng**, không chỉ cấu trúc, trên một mẫu
   trong số 38 tài liệu đã tạo ra node Phụ lục — vì parser không nhìn thấy
   nội dung bảng nên một con số bị lỗi bên trong một `<table>` sẽ vượt qua
   mọi kiểm tra đã chạy cho đến nay.
3. **Quyết định cách xử lý khoảng trống văn bản Nghị quyết không cấu trúc
   theo Điều** (`263-2025-QH15`, xem "Khoảng trống thứ hai, lớn hơn của
   parser" ở trên) — đây là mất nội dung âm thầm thật sự đối với một dạng
   Nghị quyết có thật, không phải một trường hợp biên giả định, và cần được
   sửa trong `document-node.parser.ts` trước khi cấu hình này được coi là
   sẵn sàng cho sản xuất.
4. **Truy tìm nguyên nhân gốc của 3 thất bại còn tồn đọng (và trường hợp thứ
   4 không xác định)** một cách trực tiếp — render từng trang riêng lẻ của
   chúng và kiểm tra cùng tín hiệu mật độ bảng (`detect_table_gridlines.py`,
   đã được xây dựng sẵn cho `DOCLING_REPORT.md`) trước khi mặc định rằng
   không có cách sửa nào khác ngoài việc tăng timeout của gateway.

## Files

- `scripts/test_docling_vlm.py` — script thử nghiệm một tài liệu duy nhất,
  đã lặp qua mọi biến thể prompt/định dạng mô tả ở trên
- `scripts/test_vlm_whole_doc_plaintext.py` — bài test một-request-toàn-tài-liệu
  đầu tiên kiểm chứng việc khôi phục văn bản thuần + parser
- `scripts/diagnose_vlm_usage_field.py` — cô lập phát hiện về bộ lọc nội dung
  của Gemini/trường `completion_tokens`
- `scripts/test_vlm_table_repro.py` — kiểm tra khả năng lặp lại của định dạng
  bảng (rơi về LaTeX so với HTML có colspan/rowspan)
- `scripts/test_parser_on_vlm_output.ts` — đưa văn bản phiên âm của một tài
  liệu qua `parseDocumentBody()` thật
- `scripts/run_vlm_scale_test.py` — harness 50 tài liệu có checkpoint, xử lý
  từng trang (cấu hình cuối cùng)
- `scripts/run_parser_scale_test.ts` — chạy hàng loạt parser thật qua mọi văn
  bản phiên âm đã hoàn tất
- `outputs/VLM/*.txt` — văn bản phiên âm thuần của từng tài liệu (47/50)
- `outputs/VLM/*_parsed.json` — cây Điều/Khoản/Điểm/Phụ lục đã phân tích của
  từng tài liệu
- `outputs/VLM/_parser_summary.json` — số liệu node tổng hợp theo từng tài
  liệu
- `server/src/law-index/crawl/document-node.parser.ts` — parser sản xuất, nay
  có thêm `SIGNATURE_TITLE_PATTERN` (khoảng trống Nghị quyết không cấu trúc
  theo Điều tìm thấy trong phiên này chưa được sửa ở đây)
- `server/src/law-index/crawl/document-node.parser.spec.ts` — nay có thêm bài
  test hồi quy cho cách sửa khối chữ ký
