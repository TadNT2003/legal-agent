# markitdown: báo cáo độ bền ở quy mô lớn cho định dạng `.docx`

Phạm vi: **chỉ markitdown**, định dạng `.docx`. Báo cáo thứ ba trong ba báo cáo theo
từng công cụ cho `extract-tool-resilience`. Đánh giá trước
(`sandbox/text-extract-evaluation/REPORT.md`) đã khuyến nghị markitdown là công cụ chính
cho `.docx` dựa trên **một tài liệu thử nghiệm duy nhất** — đã được ghi chú rõ khi đó là
một khoảng trống chưa kiểm chứng. Báo cáo này lấp khoảng trống đó bằng toàn bộ 60 tài
liệu `.docx` thật sự tồn tại trên vanban.chinhphu.vn (xem ghi chú thiết lập sandbox —
`.docx` hóa ra là một định dạng hiếm trên nguồn đó, tập trung vào một đợt phiên âm năm
1975, không phải một lát cắt ngẫu nhiên theo thời gian).

## Tóm tắt điều hành

**Việc trích xuất ở cấp ký tự chính xác — dấu tiếng Việt và nội dung văn bản đúng xuyên
suốt, đúng như kỳ vọng đối với một công cụ đọc XML gốc thay vì chạy OCR. Nhưng về mặt cấu
trúc, mẫu thử bị chi phối bởi một quy ước soạn thảo tài liệu làm vô hiệu hóa khả năng xử
lý đoạn văn của markitdown: 58 trong 60 tài liệu (97%) có toàn bộ nội dung thân bài bị dồn
vào một ô bảng duy nhất, phá hủy cấu trúc đoạn văn/điều khoản mà bất kỳ trình phân tích
theo dòng nào ở phía sau cũng cần đến.**

| Phát hiện | Kết quả |
| --- | --- |
| Độ tin cậy | 60/60 xử lý thành công, 0 crash/lỗi |
| Tốc độ | 9,55 giây cho 60 tài liệu (trung bình 0,16 giây/tài liệu) |
| Độ chính xác ký tự/dấu | Đúng xuyên suốt, đã kiểm tra trực tiếp — không phải đường xử lý OCR nên không có rủi ro tước dấu |
| **Sập cấu trúc** | **58/60 tài liệu (97%)** có toàn bộ thân bài — mọi khoản `Điều`/`Khoản` — bị dồn thành một dòng ô bảng duy nhất, mất hết cấu trúc đoạn văn |
| Nguyên nhân gốc | Quy ước soạn thảo của tài liệu nguồn (dùng một bảng duy nhất cho cả trang khi phiên âm tài liệu thời 1975), không phải lỗi của markitdown — đã xác nhận bằng cách đối chiếu với 2 tài liệu hiện đại không gặp vấn đề này |

## Thiết lập

**Mẫu thử:** toàn bộ 60 tài liệu `.docx` thật có sẵn từ vanban.chinhphu.vn (xem phần thiết
lập sandbox — đây là giới hạn thực sự của nguồn này, không phải một lượt lấy mẫu ngẫu
nhiên 100 tài liệu như phạm vi ban đầu). 58 trong 60 tài liệu đến từ một đợt phiên âm năm
1975 duy nhất (tài liệu cũ thời tiền-số-hóa được đánh máy lại vào Word ở một thời điểm
nào đó); 2 tài liệu còn lại là tài liệu sinh ra trực tiếp dạng số (born-digital) điển hình
hơn (`10/2011/QH13`, `248/2025/QH15`). Thành phần này ảnh hưởng trực tiếp đến cách đọc
hiểu các phát hiện bên dưới — xem mục Files để biết manifest.

**Harness:** vòng lặp tuần tự, gọi `MarkItDown().convert()` một lần cho mỗi file, ghi lại
trạng thái/thời gian/số ký tự/cờ `has_table`. Giống như pdf-inspector, không cần chạy
song song hay checkpoint. Xem `scripts/run_markitdown.py`.

## Phát hiện

### Độ tin cậy và độ chính xác ký tự: không phát hiện vấn đề

60/60 tài liệu chuyển đổi thành công không crash hay lỗi ngoại lệ nào, tổng 9,55 giây
(trung bình 0,16 giây/tài liệu, dao động từ 0,038 đến 0,82 giây). Mọi tài liệu đều cho ra
đầu ra không tầm thường (847-30.862 ký tự). Dấu tiếng Việt đã được kiểm tra trực tiếp
trong từng tài liệu được spot-check và đúng xuyên suốt — điều này dễ hiểu, vì markitdown
đọc văn bản XML gốc của file `.docx` thay vì chạy OCR, nên nó không có bước nhận diện ký
tự nào có thể sai. Đây là một xác nhận thật sự, tích cực cho kết quả một-tài-liệu-duy-nhất
mà đánh giá trước có được — độ chính xác vẫn giữ vững ở n=60.

### Phát hiện thật sự: 97% mẫu thử có thân bài bị mắc kẹt trong một ô bảng

Đếm số dòng của 60 file đầu ra lập tức cho thấy điều bất thường: 58 trong số đó chỉ dài
4-5 dòng, trong khi 2 file còn lại dài tới 114 và 157 dòng. Đọc các file ngắn cho thấy lý
do — *toàn bộ* tài liệu, bao gồm mọi khoản `Điều` được đánh số, được nhúng bên trong một
hàng bảng markdown duy nhất:

```
|  |  |  |
| --- | --- | --- |
| **PHỦ THỦ TƯỚNG**  Số: 232/BT |  | **VIỆT NAM DÂN CHỦ CỘNG HÒA** ... |
| **QUYẾT ĐỊNH** ... **Điều 1.-** Nay chia xã Phình Giàng ... **Điều 2.-** Giải thể xã
  Khẩu Hú ... **Điều 3.-** Uỷ ban hành chính tỉnh Lai Châu chịu trách nhiệm thi hành
  Quyết định này. | | |
```

(`232/BT`, một quyết định ngắn 3 điều — cả ba khoản `Điều` chạy liền nhau trong một ô,
một dòng, không có ngắt đoạn nào giữa chúng.) Điều này không chỉ giới hạn ở các tài liệu
ngắn — `1/TT-LB`, một thông tư dài hơn với sáu điểm nội dung đáng kể, cho thấy đúng mô
hình đó: toàn bộ thân bài nhiều đoạn là một chuỗi văn bản liên tục bên trong một ô bảng.

**Đây là hiện tượng do cách soạn thảo tài liệu nguồn, không phải lỗi của markitdown** —
đã xác nhận bằng cách đối chiếu với 2 tài liệu hiện đại trong mẫu thử. `10/2011/QH13` và
`248/2025/QH15` cũng dùng một bảng nhỏ cho khối tiêu đề (cơ quan ban hành / ngày tháng,
tiêu đề chuẩn của văn bản hành chính Việt Nam), nhưng phần thân bài thật sự — `NGHỊ
QUYẾT`, `QUỐC HỘI`, và mọi khoản sau đó — nằm *bên ngoài* bảng dưới dạng heading và đoạn
văn markdown bình thường với ngắt dòng thật. Các tài liệu thời 1975, rõ ràng được phiên âm
bằng cách nhúng toàn bộ bố cục tự do của trang gốc vào một bảng lớn duy nhất thay vì dùng
cấu trúc đoạn văn gốc của Word cho phần thân bài, không được xử lý theo cách đó —
markitdown chuyển đổi trung thực những gì thực sự có trong file ở cả hai trường hợp; khác
biệt hoàn toàn nằm ở cách file `.docx` nguồn được soạn thảo.

**Hệ quả thực tế:** đối với 58/60 tài liệu bị ảnh hưởng, không có cách nào khôi phục cấu
trúc theo từng khoản chỉ từ đầu ra của markitdown — ranh giới `Điều`/`Khoản` tồn tại trong
văn bản nguồn (dưới dạng đánh dấu in đậm, `**Điều 1.-**`) nhưng không phải dưới dạng dòng
hay đoạn văn riêng biệt, nên regex neo-theo-dòng của `document-node.parser.ts` (đã biết
từ đánh giá trước là cần một adapter loại bỏ `#` cho đầu ra của các công cụ *khác*) sẽ
không khớp được gì ở đây cả — toàn bộ tài liệu là một dòng. Một cách khắc phục sẽ cần hoặc
xử lý hậu kỳ đầu ra dạng ô-bảng của markitdown để tách lại theo các đánh dấu in đậm
`Điều`/`Khoản`, hoặc bỏ qua hoàn toàn việc chuyển đổi bảng của markitdown đối với các bảng
một-ô-chứa-toàn-bộ-tài-liệu và thay vào đó đọc trực tiếp các đoạn văn (paragraph run) từ
XML của file `.docx`.

### Lưu ý về thành phần kho ngữ liệu

Phát hiện này chỉ đúng với phạm vi tổng thể thực tế có thể kiểm tra được, không phải với
`.docx` như một định dạng nói chung: 58 trong 60 mẫu là tài liệu cũ được phiên âm, cùng
chia sẻ một quy ước soạn thảo bất thường, bởi vì đó thực sự gần như là toàn bộ nguồn cung
`.docx` mà nguồn dữ liệu của dự án này (vanban.chinhphu.vn) có. 2 tài liệu hiện đại trong
mẫu không cho thấy dấu hiệu nào của vấn đề này. Nếu sau này kho ngữ liệu của dự án có thêm
nhiều tài liệu `.docx` sinh ra trực tiếp dạng số (loại văn bản mới hơn, hoặc tài liệu lấy
từ nguồn khác), lỗi cụ thể này có thể hóa ra hiếm hơn nhiều so với 97% — nhưng đối với các
tài liệu `.docx` thực sự tồn tại trong `laws/` hiện nay, nó gần như phổ biến tuyệt đối.

## Kết luận

Việc trích xuất cốt lõi của markitdown đáng tin cậy ở cấp ký tự — không phát hiện vấn đề
gì về dấu hay độ chính xác nội dung ở bất kỳ đâu trong 60 tài liệu, khép lại khoảng trống
một-tài-liệu-duy-nhất mà đánh giá trước để ngỏ. Nhưng phát hiện về cấu trúc làm thay đổi ý
nghĩa thực tế của "công cụ chính cho `.docx`" đối với kho ngữ liệu cụ thể này: đầu ra thô
của markitdown không thể dùng trực tiếp cho một trình phân tích theo dòng ở phía sau đối
với phần lớn nguồn cung `.docx` thực tế của dự án, không phải vì markitdown trích xuất sai
điều gì, mà vì chính quy ước soạn thảo của tài liệu nguồn đã nhốt cấu trúc hữu ích bên
trong một ô bảng không thể đọc được. Điều này cần một bước tiền xử lý riêng — tách biệt
và phức tạp hơn — so với adapter loại-bỏ-`#` chung mà đánh giá trước đã xác định là cần
thiết cho đầu ra dạng heading Markdown của các công cụ khác.

## Files

- `samples/markitdown/`, `samples/markitdown_manifest.json` — mẫu 60 tài liệu `.docx`
  (5 đã có sẵn cục bộ + 27 + 26 tải về qua `/laws/downloads/batch`, xem phần thiết lập
  sandbox)
- `outputs/markitdown/*.md` — markdown đầu ra của từng tài liệu
- `outputs/markitdown/_timings.json` — trạng thái/thời gian/cờ theo từng tài liệu
- `scripts/run_markitdown.py` — harness đánh giá
