# Nghiên cứu: kiến trúc truy xuất cho AI pháp lý

**Trạng thái: ghi chép nghiên cứu; một phát hiện đã được thực thi.** Không nội dung nào ở đây là cam kết sẽ xây, với đúng một ngoại lệ: khoảng trống thu thập dữ liệu nêu ở §7b (`document.expiry_date`) đã được triển khai — migration 0005, kèm cờ `force` trên các endpoint PUT để backfill nó. Phần còn lại vẫn thuần phân tích. Tài liệu này ghi lại cách các hệ thống AI pháp lý khác (thương mại, chính phủ, và học thuật) thực sự xây dựng tầng truy xuất (retrieval), những gì tài liệu khoa học đã được bình duyệt cho là hiệu quả, và cả hai so sánh ra sao với kiến trúc đã được thiết kế trong [../../README.md](../../README.md) và [../database-design.md](../database-design.md). Ở những chỗ đưa ra khuyến nghị, khuyến nghị đó được đánh dấu rõ ràng và *không* phải là thay đổi đối với bất kỳ quyết định thiết kế hiện có nào.

> **Về bản dịch.** Đây là bản tiếng Việt của [legal-ai-retrieval-landscape.md](legal-ai-retrieval-landscape.md) — bản tiếng Anh là bản gốc, ưu tiên tham chiếu bản đó khi hai bản có sai khác. Quy ước thuật ngữ: các thuật ngữ kỹ thuật đã chuẩn hóa trong ngành (RAG, retrieval, chunking, embedding, reranking, BM25, RRF, pipeline, agentic) được **giữ nguyên tiếng Anh** kèm chú giải tiếng Việt ở lần xuất hiện đầu, để còn tra ngược được về tài liệu gốc; thuật ngữ pháp lý Việt Nam (Điều, Khoản, Điểm, Chương, hiệu lực, văn bản quy phạm pháp luật) giữ nguyên tiếng Việt; tên hệ thống và tên bài báo giữ nguyên tiếng Anh. Đánh số mục (§) khớp 1:1 với bản tiếng Anh.

Được viết để trả lời bốn câu hỏi nảy sinh trong quá trình thiết kế tầng truy xuất:

1. Phần còn lại của ngành xây dựng RAG pháp lý như thế nào, và dự án này đang đứng ở đâu so với họ?
2. Một cơ sở dữ liệu đồ thị (graph DB) thực sự bổ sung được gì bên trên truy xuất lai (hybrid: BM25 + ngữ nghĩa) hợp nhất bằng RRF?
3. Neo4j có nên phản chiếu cấu trúc phân cấp `document_node` (Chương → Điều) hay chỉ nên giữ đồ thị trích dẫn/sửa đổi?
4. Tầng "phân cấp khái niệm" (conceptual hierarchy) mà tài liệu GraphRAG hay nhắc tới là gì, và nó gắn vào một pipeline hybrid thông thường ra sao?

**Lưu ý về phương pháp và chất lượng bằng chứng.** Nguồn gồm blog kỹ thuật, tài liệu nhà cung cấp, bài báo đã bình duyệt, và bản tiền ấn phẩm (preprint) trên arXiv, thu thập qua nghiên cứu web. Ba giới hạn cần mang theo khi ra bất kỳ quyết định nào từ tài liệu này:

- **Tuyên bố của nhà cung cấp phần lớn không kiểm chứng được.** Hầu hết hệ thống thương mại công bố tài liệu tiếp thị, không phải kiến trúc. Các tuyên bố dưới đây được gắn nhãn *chi tiết kỹ thuật kiểm chứng được* hoặc *chưa xác nhận*.
- **Một số bài báo then chốt là preprint 2025–2026** với đánh giá hạn chế hoặc mang tính định tính. Các *mô hình tích hợp* mà chúng mô tả được lập luận tốt; nhưng bằng chứng rằng từng mô hình cụ thể cải thiện chất lượng truy xuất thì mỏng hơn mong muốn. Được gắn nhãn theo từng mục ở §2 và §6.
- **Đây là kiến trúc-dựa-trên-lập-luận, không phải kiến trúc-dựa-trên-đo-đạc**, ngoại trừ phần lõi hybrid+RRF (§2a) vốn có số liệu so sánh thực tế trong đúng lĩnh vực pháp lý.

---

## 1. Các hệ thống khác được xây dựng ra sao

### 1a. Nhà cung cấp AI pháp lý thương mại

| Hệ thống     | Hướng tiếp cận truy xuất                                 | Mức kiểm chứng                                                           |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Harvey AI      | Hybrid sparse+dense, agentic với độ sâu thích ứng       | Cao — blog kỹ thuật của chính họ                                      |
| Lexis+ AI      | Hybrid + pipeline 5 chốt kiểm, có kiểm định trích dẫn | Trung bình — công bố pipeline, không có nội tại                     |
| vLex / Vincent | RAG + duyệt đồ thị trích dẫn, citator tách riêng      | Trung bình — tài liệu hỗ trợ                                          |
| CoCounsel      | RAG trên kho Westlaw/Practical Law đã biên tập           | Thấp — chỉ tiếp thị                                                    |
| Robin AI       | Hybrid, chunk được bổ sung metadata                       | Cao — có công bố đánh giá                                            |
| Legora         | Đa tác tử (multi-agent) + RAG trên Azure OpenAI           | Thấp — tường thuật sản phẩm                                          |
| Spellbook      | GPT-4o fine-tuned + prompting, không công bố RAG           | Thấp                                                                       |
| DoNotPay       | Cây hội thoại mẫu + sinh văn bản bằng LLM              | Không — coi là chưa kiểm chứng                                        |
| Genie AI       | Tuyên bố có "semantic graph" + "Eidetic Intelligence"      | **Không — thuật ngữ tiếp thị, không có phương pháp luận** |

**Harvey AI** là bên minh bạch kỹ thuật nhất. Truy xuất được nêu rõ là hybrid, với lý do "embedding thuần dense có thể gặp khó với các thuật ngữ hiếm như mã số vụ án và thực thể có tên" — đúng lập luận mà dự án này dùng để giữ OpenSearch song song với vector store. Vector store trong môi trường production là LanceDB Enterprise và Postgres+pgvector. Harvey hợp tác với Voyage AI để fine-tune `voyage-law-2-harvey` trên hơn 20 tỷ token án lệ (tự giám sát trên án lệ thô, cộng giám sát có nhãn trên cặp truy vấn/nội dung do chuyên gia gán nhãn), đánh giá bằng NDCG@10 và Recall@100, tuyên bố giảm ~25% kết quả top không liên quan với số chiều embedding chỉ bằng một phần ba mô hình đa dụng. Điều phối là vòng lặp kiểu ReAct 5 giai đoạn (lập kế hoạch → chọn công cụ/truy xuất → suy luận/tổng hợp → kiểm tra đầy đủ → trích dẫn) với **độ sâu truy xuất co giãn theo độ phức tạp truy vấn** (3–10 lượt gọi công cụ). Chiến lược chunking không hề được công bố qua cả ba bài blog, dù có mô tả việc bổ sung metadata vào chunk.

**Lexis+ AI** công bố mô tả pipeline cụ thể nhất trong nhóm các ông lớn: (1) tìm kiếm kết hợp từ khóa + ngữ nghĩa, (2) xếp hạng lại có ưu tiên độ mới, (3) xếp hạng theo thẩm quyền dùng chỉ báo Shepard's Signal, (4) nâng hạng tòa có thẩm quyền cao, (5) **kiểm định trích dẫn đối chiếu Shepard's trước khi trích dẫn được hiển thị**. Bước 5 mới là điểm đáng chú ý — kiểm tra hiệu lực là một giai đoạn hậu-truy-xuất riêng biệt, dựa trên một sản phẩm citator tách rời, chứ không phải việc mà xếp hạng truy xuất được kỳ vọng tự lo.

**vLex / Vincent** là hệ thương mại gần nhất với hướng tăng cường bằng đồ thị: phân tích trích dẫn "lên cây và xuống cây" (vụ án này trích dẫn gì, và gì trích dẫn nó) như một phần của việc neo câu trả lời vào nguồn. Hiệu lực do một citator riêng xử lý (vCite, kế thừa SmartCite của Casetext) cộng thêm "Cert" để phát hiện các xử lý tiêu cực. Một lần nữa: **citator là hệ thống con tách rời, không hợp nhất vào xếp hạng truy xuất.**

**Robin AI** công bố đánh giá chunking/embedding thực chất duy nhất tìm được từ phía nhà cung cấp. Họ thử ~12 mô hình embedding (OpenAI, Cohere, Voyage, Amazon, Qwen2, ME5, Snowflake); Voyage 3 Large thắng về chất lượng đa ngôn ngữ với số chiều linh hoạt xuống tới 256. Phát hiện chính: bổ sung vào chunk **nhãn điều khoản (clause-label) và tóm tắt liên-điều-khoản** thay vì để văn bản thô giúp tăng độ chính xác truy xuất tới 6%, và cho phép hệ thống đạt recall >90% chỉ với ~15% toàn văn hợp đồng — giảm 85% token so với nhồi toàn bộ tài liệu, mà chất lượng sinh vẫn ngang hoặc tốt hơn. Đánh giá bằng Recall@k / Recall@p.

**Chưa xác nhận / cần gắn cờ.** "Eidetic Intelligence", "semantic graph", và benchmark tự công bố 90%-vs-79,3%-vs-37,3% của Genie AI không có phương pháp luận công bố hay kiểm chứng độc lập — nên coi hoàn toàn là tiếp thị. Các tuyên bố kỹ thuật và hiệu quả của DoNotPay chưa được kiểm chứng, và công ty này từng bị cơ quan quản lý xử lý vì tuyên bố "luật sư robot". Không tìm được chi tiết kỹ thuật kiểm chứng được cho "iCourt" như một hệ thống riêng biệt, cũng như cho một sản phẩm trợ lý pháp lý riêng của Alibaba ngoài dòng SeaLLM đa dụng của DAMO Academy.

### 1b. Các hệ thống LLM pháp lý Trung Quốc

**ChatLaw** (Đại học Bắc Kinh, [arXiv:2306.16092](https://arxiv.org/abs/2306.16092)) là thiết kế KG + đa tác tử được công bố rõ ràng nhất trong toàn bộ khảo sát này — một hệ hình thực sự khác với hybrid-RAG của phương Tây. Nó dùng hệ **Role-Aligned Mixture-of-Experts (RA-MoE)** mô phỏng các vai trong hãng luật (trợ lý / nghiên cứu viên / luật sư cấp cao), mỗi vai ánh xạ tới một expert MoE riêng, cộng thêm tích hợp đồ thị tri thức nhằm giảm ảo giác (hallucination) sinh ra từ trí nhớ tham số thuần túy. Được báo cáo là vượt GPT-4 trên các chỉ số kiểu LawBench: ghi nhớ 43,86 so với 35,29; hiểu 62,11 so với 54,41; vận dụng 61,60 so với 54,05; và hơn 11 điểm ở một kỳ thi hành nghề luật.

**LawGPT** ([arXiv:2406.04614](https://arxiv.org/abs/2406.04614)) đi hướng ngược lại — thích ứng miền thay vì truy xuất: tiền huấn luyện tiếp tục theo định hướng pháp lý cộng tinh chỉnh có giám sát trên LLaMA-7B. Không có tầng truy xuất, KG, hay kiểm định trích dẫn nào. Được đóng khung như lời giải cho căng thẳng "mô hình mã nguồn mở thiếu kiến thức pháp lý / mô hình độc quyền rủi ro về quyền riêng tư dữ liệu".

**Hạ tầng tư pháp quốc gia Trung Quốc** (cơ sở dữ liệu "Faxin", nền tảng dữ liệu lớn của Tòa án Nhân dân Tối cao) được xây trên ~320 triệu đơn vị dữ liệu pháp lý/vụ án, dùng kỹ thuật dữ liệu lớn và đồ thị tri thức để gợi ý vụ án tương tự. Mức công bố kỹ thuật chỉ ở dạng tổng hợp và qua truyền thông nhà nước; không có chi tiết ở tầng pipeline.

### 1c. Hệ thống thông tin pháp luật của chính phủ / quốc gia

Nhóm này giải quyết bài toán *quản lý phiên bản* chặt chẽ hơn hẳn bất kỳ nhà cung cấp AI nào, và là tiền lệ liên quan trực tiếp nhất tới mô hình hiệu lực của dự án này.

**EUR-Lex (EU)** — không phải hệ thống AI, nhưng là kiến trúc tham chiếu cho đồ thị trích dẫn kết hợp quản lý phiên bản. Dùng định danh CELEX và lược đồ URI **ELI (European Legislation Identifier)** (`/eli/{loại}/{năm}/{số}/{ngày-bắt-đầu}`) để định địa chỉ theo thời điểm. **Văn bản hợp nhất** gộp văn bản gốc với mọi sửa đổi sau đó thành một tài liệu phản ánh hiện trạng đang có hiệu lực, được đánh dấu rõ là **không có giá trị pháp lý chính thức** — nguồn chính thức luôn là văn bản gốc cộng chuỗi sửa đổi của nó. Các quan hệ (`cdm:work_related_to`, `cdm:consolidated_by`) được mô hình hóa thành metadata có cấu trúc trong kho CELLAR, khiến phả hệ sửa đổi trở nên truy vấn được. **Hiệu lực là một quan hệ đồ thị tường minh cộng một khung nhìn hợp nhất dẫn xuất, không bao giờ là suy diễn.**

**legislation.gov.uk (Anh, The National Archives)** — có thể còn chi tiết hơn EUR-Lex. API REST định địa chỉ xuống tới từng điều/phụ lục, và có **quản lý phiên bản theo thời điểm** đúng nghĩa: bất kỳ điều khoản nào cũng có thể được yêu cầu ở đúng trạng thái tại một ngày lịch sử bất kỳ, kèm danh sách "effects/changes" riêng theo dõi từng sự kiện sửa đổi đã áp lên điều khoản đó theo thời gian. Phiên bản được mô hình hóa như **một chuỗi các sự kiện sửa đổi rời rạc**, không phải ảnh chụp toàn văn theo chu kỳ. Đây là tương đồng bên ngoài gần nhất với những gì [../database-design.md](../database-design.md) §1a mô tả bằng `valid_from`/`valid_to`/`superseded_by_node_id` trên từng `document_node`.

**Singapore — LawNet 4.0 / GPT-Legal Q&A** (Singapore Academy of Law phối hợp IMDA) — LLM + RAG trên kho đóng gồm bản án, tuyển tập án lệ, văn bản pháp luật. Lựa chọn thiết kế đáng chú ý được công bố: mô hình được "thiết kế để chỉ trích dẫn tài liệu đã được huấn luyện và **từ chối câu hỏi ngoài phạm vi**" — dùng cơ chế từ chối theo phạm vi như một chiến lược giảm ảo giác, thay vì chỉ dựa vào việc neo vào kết quả truy xuất.

**Ấn Độ — SUPACE / e-Courts** — SUPACE hướng tới thẩm phán và được xác định rõ là **hỗ trợ, không sinh nội dung**: pipeline 4 giai đoạn (lập chỉ mục hồ sơ → trích xuất theo hội thoại → phân loại thành tóm tắt/dòng thời gian/chứng cứ/án được viện dẫn → sổ tay thẩm phán), tức là làm nổi tài liệu vụ án sẵn có thay vì tổng hợp văn bản mới, qua đó né phần lớn rủi ro ảo giác ngay từ thiết kế. Ngoài ra, một số hệ RAG pháp lý học thuật của Ấn Độ có công bố chi tiết kiến trúc thực chất — đáng chú ý là hybrid RAG phân vùng theo miền ([arXiv:2602.23371](https://arxiv.org/pdf/2602.23371)) chia kho theo lĩnh vực pháp luật trước khi truy xuất, kết hợp tìm kiếm từ khóa + ngữ nghĩa, và phủ thêm một đồ thị tri thức trên các đạo luật/vụ án/khái niệm.

### 1d. Các mô thức xuyên suốt

Sáu mô thức đúng với gần như mọi hệ thống có chi tiết kiểm chứng được:

1. **Hybrid từ khóa + ngữ nghĩa trên kho đóng, đã biên tập, là mặc định của ngành.** Không phải RAG thuần vector, và cũng không phải fine-tuning thay thế truy xuất. Fine-tuning (embedding riêng của Harvey, Spellbook, LawGPT) được dùng để cải thiện chất lượng *bên trong* pipeline RAG, hiếm khi để thay thế nó.
2. **Chunking là chi tiết bị giấu kín nhất một cách nhất quán.** Nhà cung cấp duy nhất có công bố (Robin AI) phát hiện rằng việc bổ sung metadata/cấu trúc quan trọng hơn kích thước chunk hay độ chồng lấn.
3. **Theo dõi hiệu lực là một hệ thống con riêng, không phải mối bận tâm của xếp hạng truy xuất.** Shepard's, vCite/Cert, SmartCite — tất cả đều là citator phủ lên trên, phản chiếu đúng sự tách bạch mà dự án này đã có giữa `document.status`/`document_node.status` và độ liên quan tìm kiếm.
4. **Duyệt đồ thị trích dẫn được tuyên bố rộng rãi nhưng triển khai hẹp.** Chỉ vLex/Vincent công bố cơ chế duyệt thực sự; phần lớn còn lại coi "trích dẫn" là con trỏ tới kết quả tìm kiếm, không phải cạnh đồ thị.
5. **Hệ thống chính phủ vượt trội nhà cung cấp AI về độ chặt chẽ trong quản lý phiên bản** — đồ thị sự kiện sửa đổi tường minh và định địa chỉ theo thời điểm, so với hợp nhất kiểu suy diễn hoặc không có.
6. **Điều phối agentic là xu hướng 2025–2026** — truy xuất đa bước động với công sức co giãn theo độ phức tạp truy vấn (Harvey, Legora, ChatLaw), thay thế pipeline cố định một-lượt.

Và một phát hiện đi ngược lại toàn bộ thông điệp tiếp thị: **mọi đánh giá độc lập đã công bố đều cho thấy công cụ pháp lý có RAG vẫn ảo giác ở mức đáng kể** (§2e).

---

## 2. Tài liệu học thuật

### 2a. Truy xuất lai và hợp nhất kết quả

**"Segment First, Retrieve Better"** (Nigam, Dubey, Shallum, Bhattacharya — [arXiv:2508.00679](https://arxiv.org/pdf/2508.00679)) là bằng chứng xác nhận trực tiếp nhất cho phần lõi truy xuất của dự án này. Trên án lệ Indian Kanoon, nhóm tác giả kết hợp BM25 + dense + **Reciprocal Rank Fusion**, đồng thời phân đoạn tài liệu theo vai trò tu từ (tình tiết / phán quyết / ý kiến bất đồng) trước khi truy xuất. Hybrid+RRF vượt từng phương pháp đơn lẻ trên cả precision, recall và nDCG; phân đoạn theo vai trò tu từ mang lại mức tăng thêm nữa bên trên phần hợp nhất.

**Lưu ý riêng về RRF:** các nghiên cứu hybrid tổng quát cho thấy một tổ hợp **tuyến tính có tinh chỉnh tham số α** giữa điểm BM25 và dense có thể vượt RRF khoảng 0,006–0,008 nDCG@10. RRF là mặc định mạnh và không cần tham số — một lựa chọn v1 hợp lý — nhưng không phải trần. Chỉ nên xem lại khi đã có lưu lượng truy vấn thực để tinh chỉnh.

**Các benchmark đáng biết:**

- **LegalBench-RAG** (Pipitone & Houir Alami, [arXiv:2408.10343](https://arxiv.org/abs/2408.10343)) — benchmark đầu tiên tách riêng bước *truy xuất* của RAG pháp lý thay vì đánh giá đầu-cuối. 6.858 cặp truy vấn–đáp án do chuyên gia gán nhãn trên kho 79 triệu ký tự. Luận điểm cốt lõi: truy xuất nên trả về **đoạn tối thiểu và chính xác**, không phải toàn bộ tài liệu hay chunk quá khổ.
- **LexRAG** ([arXiv:2502.20640](https://arxiv.org/abs/2502.20640)) — benchmark đầu tiên cho RAG **tư vấn pháp lý nhiều lượt**: 1.013 hội thoại trên 17.228 điều luật ứng viên. Phát hiện các hệ RAG hiện có suy giảm rõ rệt qua các lượt hội thoại.
- **LegalBench** ([arXiv:2308.11462](https://arxiv.org/abs/2308.11462)) — 162 tác vụ được thiết kế thủ công trên 6 loại lập luận pháp lý, xây dựng cùng luật sư hành nghề.
- **LexGLUE** (Chalkidis và cộng sự, ACL 2022, [arXiv:2110.00976](https://arxiv.org/abs/2110.00976)) — benchmark chuẩn hóa cho hiểu ngôn ngữ pháp lý; mô hình tiền huấn luyện chuyên ngành luật luôn vượt mô hình đa dụng.

### 2b. Chunking theo cấu trúc

Đây là phát hiện nhất quán nhất trong toàn bộ phần rà soát tài liệu. **Cửa sổ token cố định gây hại thực sự với văn bản luật** — chúng truy xuất "thứ có nhắc tới truy vấn" thay vì "đoạn trả lời được truy vấn".

- **"Towards Reliable Retrieval in RAG Systems for Large Legal Datasets"** (Reuter và cộng sự, [arXiv:2510.06999](https://arxiv.org/abs/2510.06999)) chạy các thí nghiệm loại trừ (ablation) về chunking cho kho pháp lý lớn và xác nhận lựa chọn ranh giới phân mảnh làm thay đổi đáng kể độ chính xác truy xuất.
- **LawRAG** (RAG pháp lý Indonesia, *Data Technologies and Applications*) kết hợp chunking theo điều/khoản với reranking.
- Mô thức được khuyến nghị hội tụ từ nhóm này: chunk bám theo ranh giới Điều/Khoản, chia đệ quy theo dấu phân cách cấu trúc pháp lý, và **truy xuất theo tài liệu cha** (lập chỉ mục chunk con nhỏ, trả về mục cha bao ngoài).

Điều này ánh xạ gần như chính xác vào quy tắc gộp (rollup) đã được đặc tả tại [../database-design.md](../database-design.md) §4 (chunk ở mức Khoản, Điểm gộp vào trong, tiền tố bằng tiêu đề tổ tiên) và §3a (OpenSearch gộp lên mức Điều với Khoản lồng bên trong).

### 2c. RAG pháp lý tăng cường bằng đồ thị

Đang sôi động nhưng còn non — chủ yếu 2025–2026, phần lớn tập trung ở Ấn Độ/Trung Quốc, chưa có kiểm chứng ở quy mô production.

- **LegalGraphRAG** ([arXiv:2605.28120](https://arxiv.org/abs/2605.28120), ACL 2026) — xây đồ thị pháp lý phân tầng theo ba lớp (chi tiết ở §5a) và chạy pipeline 3 tác tử: **Researcher** truy xuất → **Auditor** đối chiếu từng luận điểm với văn bản gốc → **Adjudicator** tổng hợp. Động cơ được nêu: "một đồ thị tri thức phẳng không phân biệt đủ giữa chi tiết sự kiện, quy tắc được áp dụng, và nguyên tắc trừu tượng, làm hạn chế độ chính xác truy xuất."
- **"Bridging Legal Knowledge and AI"** (Barron và cộng sự, [arXiv:2502.20364](https://arxiv.org/abs/2502.20364)) — vector store cộng một KG dựng bằng phân rã ma trận không âm phân cấp (hierarchical NMF) để khám phá chủ đề/quan hệ, thay cho ontology soạn thủ công. Đặt tầng đồ thị đúng vào vai trò cơ chế giảm ảo giác.
- **Domain-Partitioned Hybrid RAG / KG-LegalRAG / LexGraph** ([arXiv:2602.23371](https://arxiv.org/pdf/2602.23371)) và **Falkor-IRAC** ([arXiv:2605.14665](https://arxiv.org/abs/2605.14665)) — mô hình hóa đạo luật/bản án/trích dẫn thành nút đồ thị nhằm giảm "trôi dạt truy xuất" so với tìm kiếm vector phẳng.

**Xu hướng quan trọng với dự án này:** ngành đã đi qua giai đoạn cạnh `CITES` phẳng để tiến tới đồ thị nhiều tầng, chính vì một loại cạnh thô không thể nắm bắt được *điều gì* đang được trích dẫn khẳng định, hay *liệu nó còn hiệu lực hay không*. Đây đúng là lập luận đã dẫn tới việc dự án này lệch khỏi enum `reference_type` 8 giá trị ban đầu của DBML sang bản 10 giá trị đã triển khai (xem phần Context của [../plan/law-index-plan.md](../plan/law-index-plan.md)).

### 2d. Hiệu lực theo thời gian và quản lý phiên bản văn bản

Kết luận dứt khoát nhất của tài liệu khoa học, và cũng là nơi phần việc còn lại của dự án này nằm.

- **de Martim, "A Temporal FRBR/FRBRoo-Based Model for Component-Level Versioning of Legal Norms"** ([arXiv:2506.07853](https://arxiv.org/abs/2506.07853)) — dùng ontology LRMoo: mỗi lần sửa đổi sinh ra một Temporal Version mới không phụ thuộc ngôn ngữ ở mức Work, kèm các Language Version đơn ngữ ở mức Expression, cho phép tái dựng chính xác bất kỳ phần nào của văn bản tại bất kỳ thời điểm nào. Minh họa trên Hiến pháp Brazil.
- **de Martim, "Beyond Probabilistic Similarity"** ([arXiv:2606.09724](https://arxiv.org/abs/2606.09724)) — lập luận rằng truy xuất dựa trên độ tương đồng embedding **về mặt cấu trúc là không thể** biểu diễn thứ bậc pháp lý, không thể suy luận lịch đại (diachronic), và không thể biểu diễn chuỗi nhân quả điều kiện→hệ quả. Thiếu metadata thời gian tường minh, RAG sẽ trộn lẫn quy định hiện hành với quy định đã hết hiệu lực.
- **Prior, Schultz, Grabmair, "Asking For An Old Friend"** (ICAIL 2026, [arXiv:2605.23497](https://arxiv.org/abs/2605.23497)) — đo bằng thực nghiệm mức suy giảm độ chính xác khi mô hình trả lời câu hỏi về văn bản đã lỗi thời so với văn bản hiện hành.
- **Legal-GraphRetriever** (Springer) — xếp hạng lại các ứng viên từ truy xuất hybrid bằng đồ thị trích dẫn cộng tinh chỉnh theo thời gian, cụ thể để phân biệt quy định còn hiệu lực với quy định đã bị thay thế. Đây là bài báo sát nhất với việc gắn kiểm tra hiệu lực vào một pipeline hybrid sẵn có.

**Kết luận nhất quán:** hiệu lực theo thời gian phải được cưỡng chế như một **ràng buộc cứng** — trích xuất mốc thời gian rồi lọc phiên bản *trước khi* xếp hạng — và cách này vượt trội hẳn so với phó mặc cho độ tương đồng ngữ nghĩa.

### 2e. Ảo giác và kiểm định trích dẫn

- **Dahl, Magesh, Suzgun, Ho, "Large Legal Fictions"** ([arXiv:2401.01301](https://arxiv.org/abs/2401.01301), *Journal of Legal Analysis* 2024) — trên các câu hỏi kiểm chứng được về án liên bang chọn ngẫu nhiên, tỷ lệ ảo giác **58% (GPT-4), 69% (GPT-3.5), 88% (Llama 2)**. Mô hình không tự phát hiện được ảo giác của chính mình một cách đáng tin, và thể hiện "thiên lệch phản-sự-thật" — không sửa lại tiền đề pháp lý sai của người dùng.
- **Magesh và cộng sự, "Hallucination-Free? Assessing the Reliability of Leading AI Legal Research Tools"** ([arXiv:2405.20362](https://arxiv.org/abs/2405.20362), *Journal of Empirical Legal Studies* 22:216–242, 2025) — nghiên cứu then chốt. Đánh giá tiền đăng ký đầu tiên với các công cụ pháp lý RAG thương mại: **Lexis+ AI, Westlaw AI-Assisted Research, và Ask Practical Law AI đều ảo giác 17–33% số lần.** Lexis+ AI đạt ~65% câu trả lời hoàn toàn chính xác so với ~18% của Westlaw AI-AR trên cùng bộ truy vấn. **Xu nịnh (sycophancy)** — bịa ra căn cứ ủng hộ tiền đề sai của người dùng thay vì đính chính — được nêu như một dạng lỗi riêng biệt và lặp lại.
- **"Citation Grounding: Detecting and Reducing LLM Citation Hallucinations via Legal Citation Graphs"** ([arXiv:2606.00898](https://arxiv.org/abs/2606.00898)) — dùng đồ thị trích dẫn để xác minh rằng trích dẫn được sinh ra thực sự tồn tại và thực sự chống đỡ cho luận điểm đang dẫn, thay vì tin vào độ tự tin của mô hình.

**Điều rút ra:** RAG giảm được ảo giác một cách đo đếm được nhưng không loại bỏ nó. Kiểm định trích dẫn như một giai đoạn hậu-sinh tường minh là thực hành chuẩn, không phải tính năng có-thì-tốt.

### 2f. NLP pháp lý tiếng Việt

Một mảng nghiên cứu thực sự tồn tại và khá sôi động — đáng khai thác trước khi chọn mô hình embedding.

- **ALQAC** (Automated Legal Question Answering Competition, [alqac.github.io](https://alqac.github.io/)) — chạy từ 2021 trên luật thành văn Việt Nam. Các tác vụ: truy xuất văn bản pháp luật, suy luận kéo theo văn bản, hỏi đáp. Kết quả tốt nhất công bố năm 2024: ~87% F2 cho truy xuất, ~98% độ chính xác cho hỏi đáp. ALQAC 2026 chuyển hướng sang dự đoán kết quả vụ án theo hướng agentic có dùng công cụ/API.
- **VLQA** ([arXiv:2507.19995](https://arxiv.org/abs/2507.19995), JAIST / ĐHQG Hà Nội / NII Tokyo) — 3.129 bộ ba hỏi–đáp do chuyên gia gán nhãn trên 59.636 điều luật thuộc 27 lĩnh vực, xây từ 2.162 văn bản và 430 nghìn câu hỏi thô từ diễn đàn của người dân. Truy xuất: BGE-m3 đạt R@2=0,544 / P@2=0,322; **mBERT sau fine-tune đạt R@2=0,626 / P@2=0,374**. Hỏi đáp: GPT-4o-mini tốt nhất (ROUGE-1 0,698; BERTScore 0,834); đánh giá bởi con người ghi nhận 13/100 lỗi cho GPT-4o-mini so với 52/100 cho Qwen2.5-14B.
- **Truy xuất đa giai đoạn cho văn bản pháp luật tiếng Việt** (Phạm, Nguyễn, Đỗ — [arXiv:2209.14494](https://arxiv.org/abs/2209.14494)) — giai đoạn từ khóa BM25+ → xếp hạng lại bằng sentence-transformer, học tương phản 3 vòng với mẫu âm khó dần, trên 8.436 văn bản / 114.177 điều. Hệ tốt nhất (SPhoBERT-large có tách từ): **F2=0,741; Recall@20=0,970** — cải thiện F2 tương đối 55% so với baseline Attentive-CNN (0,477). Lưu ý đây bản thân nó đã là một hệ hybrid hai giai đoạn, tức là độc lập đi tới cùng hình dạng với thiết kế của dự án này.
- **Khai thác mẫu âm bán khó cho truy xuất pháp lý tiếng Việt** ([arXiv:2507.14619](https://arxiv.org/abs/2507.14619)) — Bi-Encoder chuyên tiếng Việt kết hợp PhoRanker.
- **Dữ liệu tổng hợp cho truy xuất pháp lý tiếng Việt** ([arXiv:2412.00657](https://arxiv.org/abs/2412.00657)) — 507.152 truy vấn tổng hợp sinh bằng Llama3-70B để bổ sung dữ liệu huấn luyện truy xuất, xử lý tình trạng tài nguyên thấp của tiếng Việt.

**Hàm ý cho quyết định vector store còn bỏ ngỏ** ([../database-design.md](../database-design.md) §4): các mô hình tinh chỉnh cho tiếng Việt (nền PhoBERT/PhoRanker, hoặc bi-encoder đã fine-tune) vượt rõ rệt embedding đa ngôn ngữ đa dụng trên bài toán truy xuất pháp lý tiếng Việt. Ghi chú hiện có rằng mô hình embedding "phải hỗ trợ tiếng Việt thực chất, không chỉ là tokenizer đa ngôn ngữ" là có cơ sở vững; phiên bản mạnh hơn của kết luận đó là: fine-tune trên cặp dữ liệu pháp lý tiếng Việt mới là nơi tạo ra mức cải thiện lớn nhất, và sinh truy vấn tổng hợp là cách đã được kiểm chứng để có dữ liệu huấn luyện.

Không tồn tại nhánh COLIEE dành riêng cho Việt Nam — COLIEE vẫn chỉ có luật Nhật Bản/Canada. ALQAC là tương đương gần nhất và được xây dựng theo mô hình COLIEE.

### 2g. Điều phối agentic

- **"Agentic Retrieval-Augmented Generation: A Survey"** (Singh và cộng sự, [arXiv:2501.09136](https://arxiv.org/abs/2501.09136)) — phân loại agentic RAG theo số lượng tác tử, cấu trúc điều khiển, mức tự chủ, và cách biểu diễn tri thức. Gọi công cụ (tác tử tự chọn công cụ truy xuất nào cần dùng) là một mô thức cốt lõi, đặt đối lập với pipeline tĩnh luôn-chạy-tất-cả.
- **HyPA-RAG: A Hybrid Parameter Adaptive RAG System for AI Legal and Policy Applications** (Kalra, Wu, Gulley, Hilliard, Guan, Koshiyama, Treleaven — CustomNLP4U @ EMNLP 2024, [ACL:2024.customnlp4u-1.18](https://aclanthology.org/2024.customnlp4u-1.18/)) — hệ thống đã công bố gần với ngăn xếp mục tiêu của dự án này nhất: một **bộ phân loại độ phức tạp truy vấn** điều khiển việc tinh chỉnh tham số thích ứng trên một tổ hợp lai **dense + sparse + đồ thị tri thức**, đánh giá trên NYC Local Law 144. Báo cáo cải thiện correctness, faithfulness và contextual precision, nhưng nêu ở dạng định tính chứ không công bố số liệu theo từng chỉ số — nên hãy coi đây là một *thiết kế* đã được kiểm chứng, không phải một mức cải thiện đã đo được. Đáng chú ý vì nó định tuyến theo *độ phức tạp* truy vấn (tiêu tốn bao nhiêu công truy xuất), một trục trực giao với việc SAT-Graph định tuyến theo *hình dạng* truy vấn (nhánh nào dẫn đầu) — xem §6b.
- **"All for Law and Law for All: Adaptive RAG Pipeline for Legal Research"** (NLLP 2025, [arXiv:2508.13107](https://arxiv.org/abs/2508.13107)) — một bộ chuyển ngữ truy vấn có nhận thức ngữ cảnh quyết định độ sâu và kiểu truy xuất cho từng truy vấn, kết hợp embedding mã nguồn mở SBERT/GTE; tuyên bố đạt ngang các công cụ RAG pháp lý độc quyền với chi phí thấp hơn nhiều. Đây là bằng chứng rõ nhất rằng việc điều chỉnh *chiến lược* truy xuất theo từng truy vấn có tác dụng trong lĩnh vực pháp lý.

**Cảnh báo lặp lại đáng ghi nhớ:** gắn bừa cơ chế chọn công cụ agentic lên một pipeline có sẵn **không** tự động vượt được một pipeline cố định đã tinh chỉnh tốt. Lợi ích tập trung ở nơi độ đa dạng truy vấn là có thật (tư vấn nhiều lượt, nhu cầu độ sâu truy xuất khác nhau) và gần như biến mất nếu không thiết kế tác tử và công cụ riêng cho miền. Nên kiểm chứng bằng log truy vấn thật thay vì mặc định tin.

---

## 3. Dự án này so sánh ra sao

### 3a. Những chỗ thiết kế đã khớp với ngành

| Hạng mục                | Đồng thuận của ngành                                               | Dự án này                                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Truy xuất                | Hybrid từ khóa + ngữ nghĩa, có hợp nhất                          | OpenSearch + vector store qua RRF ([../../README.md](../../README.md)) — khớp, và được Nigam và cộng sự kiểm chứng ngay trong miền pháp lý                                                      |
| Chunking                  | Bám cấu trúc, không dùng token cố định                          | `document_node` ở mức Khoản / Điều trần (§4) — **đi trước phần lớn hệ production**, vốn không công bố hoặc vẫn dùng cửa sổ cố định                                         |
| Đơn vị lập chỉ mục  | Trả về đoạn tối thiểu chính xác; truy xuất theo tài liệu cha | Tài liệu ở mức Điều với Khoản lồng bên trong +`inner_hits` (§3a, §3d) — trích dẫn chính xác tới đoạn nhưng vẫn có ngữ cảnh đọc được                                          |
| Độ mịn của hiệu lực | Theo thời điểm, theo từng điều khoản (legislation.gov.uk)        | `status`/`valid_from`/`valid_to`/`superseded_by_node_id` theo từng `document_node` — **gần với độ mịn của legislation.gov.uk hơn là mức hợp nhất theo tài liệu của EUR-Lex** |
| Mô hình hóa quan hệ   | Ngành đang rời bỏ cạnh`CITES` phẳng                             | `reference_type` 10 giá trị + `change_type` đã mã hóa sẵn đúng thứ mà tài liệu khoa học phê phán đồ thị phẳng là thiếu                                                             |
| Hiệu lực vs. truy xuất | Citator là hệ thống con tách rời                                   | Hiệu lực nằm ở Postgres/đồ thị, không nằm trong xếp hạng độ liên quan — khớp với cách tách Shepard's/vCite                                                                                |
| Điều phối              | Agentic gọi công cụ (xu hướng 2025–26)                            | Kiến trúc mục tiêu là agentic — đã khớp, chưa xây                                                                                                                                                 |

Tóm lại: **các quyết định về hợp nhất truy xuất và chunking đã đưa ra đều được cả thực tiễn ngành lẫn nghiên cứu hiện tại xác nhận**, và về độ mịn chunking cùng độ biểu đạt của kiểu quan hệ, dự án này đang đi trước một số nhà cung cấp thương mại.

### 3b. Các khoảng trống — và đó là những bài toán khó của ngành, không chỉ là phần hạ tầng chưa làm

1. **CDC + sync-state + đối soát (chưa bắt đầu).** Thiết kế `content_version` + `document_sync_state` đã có trong [../../README.md](../../README.md). Cảnh báo từ tài liệu khoa học là: phần khó hơn không phải khâu lan truyền mà là **cưỡng chế tại thời điểm truy xuất** — một kho đồng bộ hoàn hảo vẫn sẽ tự tin trả về một Điều đã hết hiệu lực nếu không có gì lọc theo hiệu lực trước khi xếp hạng. Nên viết ràng buộc lọc hiệu lực vào hợp đồng của công cụ truy xuất *trước khi* tầng agent được xây.
2. **Chưa có giai đoạn kiểm định trích dẫn.** Với tỷ lệ ảo giác 17–33% ở các công cụ thương mại có RAG, và [arXiv:2606.00898](https://arxiv.org/abs/2606.00898) đề xuất đúng việc này, lược đồ hiện tại đã sẵn sàng: phân giải mọi `citation_id`/`node_key` được sinh ra ngược về một hàng `document_node` thật rồi đối chiếu nội dung được khẳng định với `text_content`.
3. **Mô hình embedding vẫn còn bỏ ngỏ.** §2f cho thấy nên rời khỏi embedding đa ngôn ngữ đa dụng để hướng tới mô hình tinh chỉnh cho tiếng Việt.
4. **Rủi ro của điều phối agentic.** Kiểm chứng bằng log truy vấn thật thay vì mặc định tin rằng agentic luôn thắng pipeline cố định đã tinh chỉnh tốt.

---

## 4. Cơ sở dữ liệu đồ thị thực sự bổ sung được gì

### 4a. Neo4j không nên là đầu vào thứ ba của RRF

Thiết kế hiện tại không làm vậy — [../../README.md](../../README.md) chỉ hợp nhất OpenSearch + vector store — và như thế là đúng. Đáng ghi lại *lý do*, vì các hướng dẫn GraphRAG phổ thông thường gợi ý điều ngược lại:

- BM25 và embedding đều trả lời câu hỏi "**văn bản nào liên quan tới truy vấn này**". RRF là cách tốt để kết hợp hai tín hiệu *độ liên quan*.
- Đồ thị trả lời một loại câu hỏi khác hẳn về bản chất — "**điều khoản này đang ở trạng thái pháp lý nào và quan hệ ra sao với các điều khoản khác**" — vốn không phải điểm số độ liên quan.
- Về mặt cơ chế, **một lượt duyệt đồ thị trả về một tập hợp, không phải một thứ hạng.** Một điều khoản cách hai bước có kém liên quan hơn cách một bước không? Đôi khi; nhưng thường là không. Tiền đề của RRF là mỗi danh sách đầu vào mang một thứ tự xếp hạng *có ý nghĩa*; đưa vào một tập hợp có thứ tự tùy tiện sẽ bơm nhiễu vào một bước hợp nhất vốn đang chạy tốt.

Không bài báo graph-RAG pháp lý nào trong phần khảo sát hợp nhất kết quả đồ thị như danh sách xếp hạng thứ ba. Tất cả đều dùng đồ thị làm bộ lọc, bộ mở rộng, bộ xếp hạng lại, hoặc bộ kiểm định.

### 4b. Ba vai trò đồ thị nên đảm nhận

Theo Legal-GraphRetriever, vLex Vincent, và LegalGraphRAG:

1. **Mở rộng trước truy xuất.** Khi truy vấn phân giải được về một trích dẫn cụ thể, duyệt `MODIFIES`/`IMPLEMENTS` *trước khi* chạy tìm kiếm hybrid, để phạm vi tìm kiếm phủ cả văn bản đã sửa đổi hiện hành lẫn Nghị định/Thông tư hướng dẫn. Tìm kiếm hybrid đơn thuần có thể bỏ sót hoàn toàn khi văn bản sửa đổi dùng từ ngữ khác với văn bản gốc.
2. **Xếp hạng lại và lắp ghép ngữ cảnh sau truy xuất.** Với mỗi kết quả, một bước nhảy đồ thị cung cấp thứ mà độ tương đồng văn bản về cấu trúc không thể có: nó còn hiệu lực không, cái gì đã thay thế nó, và liệu có văn bản thẩm quyền cao hơn nào đang xung đột với nó (truy vấn `authority_rank` tại [../database-design.md](../database-design.md) §2b).
3. **Kiểm định trích dẫn sau khi sinh.** Phân giải mọi trích dẫn được sinh ra bằng một lệnh `MATCH` thật — quan hệ được khẳng định có tồn tại không, đích đến có còn hiệu lực không.

Về mặt thực hành, điều này ủng hộ việc phơi bày Neo4j thành **2–3 công cụ agent riêng biệt** (`get_amendment_chain`, `check_still_in_force`, `verify_citation`) thay vì thêm một thứ nữa gộp vào bước truy xuất.

### 4c. Phân cấp cấu trúc ở lại Postgres

**Câu hỏi:** Neo4j có nên hiện thực hóa cấu trúc `document_node` — một nút Điều với cạnh `PART_OF` tới Chương của nó?

**Kết luận: không, và thiết kế hiện tại tại [../database-design.md](../database-design.md) §2b (khoảng dòng 172) loại trừ Phần/Chương/Mục/Tiểu mục là đúng.** Lý do:

- **Quan hệ chứa đựng là bài toán cây, không phải bài toán đồ thị.** `ltree` của Postgres với chỉ mục GiST đã trả lời truy vấn tổ tiên/hậu duệ một cách tối ưu. Phản chiếu nó sang Neo4j không mở ra dạng truy vấn mới nào, chỉ nhân bản một cái cây mà Postgres giữ tốt hơn — vi phạm nguyên tắc thiết kế rằng Postgres là nguồn chân lý cấu trúc duy nhất.
- **Nó tái lập đúng kiểu phình mà tài liệu đã bác bỏ với Khoản/Điểm** — một nút Chương sẽ có cạnh `PART_OF` vào và ra, và không bao giờ là nguồn hay đích của cạnh `MODIFIES`/`CITES`/`IMPLEMENTS`, tức là thêm gánh nặng đồng bộ CDC mà không đem lại lợi ích duyệt nào.
- **"Các Điều anh em trong cùng một Chương"**, nếu có lúc cần làm tín hiệu xếp hạng lại, chỉ là một truy vấn Postgres có chỉ mục theo tiền tố `path`.

**Một phản biện cần ghi nhận trung thực**, đến từ SAT-Graph RAG (§5d): hệ đó *có* đưa phân cấp cấu trúc vào đồ thị, vì nó cần cấu trúc để phân tích tác động theo thứ bậc và để gộp phiên bản theo thời gian. Ngã rẽ nằm ở chỗ **việc tái dựng theo thời điểm diễn ra ở đồ thị hay ở Postgres.** Thiết kế hiện tại giao việc đó cho Postgres, và điều đó nhất quán nội tại, hoàn toàn ổn. Nếu sau này thay đổi, §4c cần được xem lại — nhưng phải là một quyết định có chủ đích, không phải trôi dạt.

---

## 5. Tầng khái niệm

"Phân cấp khái niệm" gộp lẫn ba tầng khác biệt trong tài liệu khoa học. Chúng giải quyết những kiểu thất bại khác nhau và có chi phí xây dựng chênh lệch rất lớn. **Cả ba đều bổ trợ cho truy xuất hybrid, không thay thế nó.**

### 5a. Trục 1 — phân cấp chủ đề / mức trừu tượng

**Những gì LegalGraphRAG thực sự xây:** ba tầng — **chunk → khái niệm → góc nhìn (perspective)**. Các chunk nối nhau bằng cạnh tương đồng embedding; một tầng khái niệm gồm các thực thể pháp lý do LLM trích xuất; và một tầng góc nhìn dựng bằng **phát hiện cộng đồng Louvain** trên mạng lưới khái niệm. Truy xuất đi từ trên xuống: khớp góc nhìn, thu hẹp về khái niệm, đáp xuống chunk, thu nhỏ không gian tìm kiếm ở mỗi bước.

Về bản chất đây là ý tưởng tóm tắt-theo-cộng-đồng của Microsoft GraphRAG khoác áo pháp lý. Thứ nó mang lại là các truy vấn *theo chủ đề* mà không Điều đơn lẻ nào trả lời được — "pháp luật Việt Nam quy định thế nào về dữ liệu cá nhân nói chung?" — trong khi hybrid+RRF trả về một nhúm Điều rời rạc và không có tổng hợp.

**Kết luận: dự án này phần lớn đã có sẵn tầng này miễn phí.** vbpl.vn cung cấp `Ngành` và `Lĩnh vực` như một phân loại do con người biên tập, đã được nạp vào [`document.schema.ts:48-49`](../../server/src/law-index/persistence/schema/document.schema.ts#L48-L49) dưới dạng `industry`/`field`. Một phân loại do Bộ Tư pháp biên tập vượt trội các cộng đồng Louvain suy ra từ thực thể do LLM trích xuất ở đúng khía cạnh quan trọng nhất ở đây — tính chính danh pháp lý. Phát hiện cộng đồng không giám sát sẽ sẵn sàng gom chung các điều khoản chỉ vì chúng đồng xuất hiện về mặt từ vựng nhưng lại thuộc những chế định pháp luật khác nhau. **Khuyến nghị: coi Trục 1 như đã được giải quyết chủ yếu ở khâu nạp dữ liệu; chỉ dùng tới phân cụm nếu `field` tỏ ra quá thô trong thực tế.**

### 5b. Trục 2 — ontology thuật ngữ được định nghĩa (trục đáng làm nhất)

Đây là dòng dõi **LKIF-Core** — một ontology bậc trên gồm các khái niệm pháp lý nền tảng (quy phạm, hành vi, vai trò), phát triển trong dự án ESTRELLA, lấy cảm hứng từ lý thuyết pháp luật và logic deontic, đến nay vẫn là điểm quy chiếu để căn chỉnh các ontology pháp lý mới. GraphRAG tổng quát cần LLM để đoán ra tầng này.

**Luật Việt Nam cung cấp tầng này một cách tất định.** Văn bản luật Việt Nam có điều *"Giải thích từ ngữ"* bắt buộc (thường là Điều 3) với hình thức rất quy củ — `Trong Luật này, các từ ngữ dưới đây được hiểu như sau: 1. {thuật ngữ} là {định nghĩa};`. Đây nhiều khả năng thuộc phạm vi regex chứ không phải phạm vi LLM.

Đây chính xác là mục đích mà `defines_term` được dành sẵn tại [`document-reference.schema.ts:30`](../../server/src/law-index/persistence/schema/document-reference.schema.ts#L30) — hiện đã nằm trong enum đã triển khai kèm chú thích đánh dấu là dành cho "trường hợp sử dụng trích xuất định nghĩa bằng LLM trong tương lai", và **hiện chưa có gì ghi vào nó** (nó vắng mặt trong `RELATION_LABEL_MAP` tại [`vbpl.parser.ts`](../../server/src/law-index/crawl/vbpl.parser.ts), vì tab Lược đồ của vbpl.vn không phơi bày quan hệ này). **Chú thích đó có thể đang đánh giá thấp cơ hội: với VBQPPL Việt Nam, đây trông giống một parser tất định, đặt cạnh phần parse trích dẫn và `Căn cứ` hiện có, hơn là một lượt LLM riêng.** Cần kiểm chứng lại trên kho văn bản đã crawl trước khi dựa vào.

Hai tính chất khiến trục này giá trị hơn vẻ ngoài của nó:

- **Chuyện phạm vi hiệu lực của định nghĩa là một tính năng, không phải phiền toái.** "Trong Luật này" có nghĩa các định nghĩa **bị giới hạn phạm vi theo từng văn bản ngay từ cấu trúc**. Cùng một thuật ngữ có thể được định nghĩa khác nhau ở các luật khác nhau — nên một nút `(:Term)` toàn cục dùng chung cho mọi văn bản sẽ *sai về mặt pháp lý*. Hình dạng đúng là `(:Term)-[:DEFINED_IN]->(:Document)`, và khi đó đồ thị trả lời được câu hỏi mà không công cụ truy xuất nào trả lời nổi: *"định nghĩa 'người lao động' nào đang điều chỉnh trường hợp này?"* Đó là lợi ích về độ chính xác, không đơn thuần về độ bao phủ.
- **Nó xử lý tận gốc vấn đề lệch từ vựng.** Người dùng gõ theo ngôn ngữ đời thường; văn bản luật dùng thuật ngữ chuyên môn. Embedding che lấp khoảng cách này một cách không đáng tin, còn BM25 thì hoàn toàn không. Một cạnh định nghĩa cho phép mở rộng truy vấn sang thuật ngữ pháp lý *và* trích dẫn được lý do.

**Khác biệt với `explains`,** vốn đã được [`vbpl.parser.ts:132-141`](../../server/src/law-index/crawl/vbpl.parser.ts#L132-L141) ghi nhận — đó là *giải thích pháp luật chính thức* (ở mức văn bản, theo Điều 60 Luật 64/2025/QH15), một quan hệ khác ở một tầng khác.

### 5c. Trục 3 — cấu trúc deontic / quy tắc (khuyến nghị: không xây)

Nhánh lâu đời nhất: **LegalRuleML**, một ngôn ngữ đánh dấu XML cho quy phạm pháp luật, biểu diễn nghĩa vụ, cho phép, cấm đoán và ngoại lệ kèm đặc tính thời gian và khả năng bị bác bỏ (defeasible); cùng hậu duệ năm 2026 của nó là **Span-Grounded Deontic Trees** ([arXiv:2606.08932](https://arxiv.org/html/2606.08932)), phân rã điều khoản thành neo (anchor) + phương thức (modality) + cây điều kiện + hệ quả, mã hóa ngoại lệ dưới dạng loại trừ tương hỗ tường minh (nhánh chung mang một lá `Exclusion` trỏ tới điều kiện kích hoạt ngoại lệ; nhánh ngoại lệ mang chính điều kiện đó như tiền điều kiện dương).

Về mặt khái niệm đây là tầng sâu nhất — chính là cấu trúc điều kiện→hệ quả→ngoại lệ mà de Martim lập luận rằng embedding về cấu trúc không thể biểu diễn. **Kết quả thực nghiệm là một biển báo dừng:**

| Chỉ số (NormBench, 2.290 mục / 9.019 nhánh)                       | LLM tiên tiến      |
| --------------------------------------------------------------------- | -------------------- |
| Độ trung thực của đoạn trích (span faithfulness)               | 0,77–0,79           |
| NodeSpan-F1 (có lấy đúng các đoạn không)                      | ~0,45                |
| **Edge-F1 (các đoạn có gắn đúng nút cha logic không)** | **0,21–0,24** |
| Edge-F1 ở độ lồng ≥ 2                                            | **0,07**       |
| DefRec@Gold (khôi phục được điều kiện ngoại lệ)             | 0,55–0,64           |
| DefRec@Gold, LLM*đã tinh chỉnh chuyên ngành luật*             | **~0,006**     |
| Đẳng cấu cấu trúc liên ngôn ngữ (Iso-F1)                      | < 0,40               |

Nhận định của nhóm tác giả: mô hình "lấy đúng văn bản nhưng nối dây sai" — khoảng trống *structure-grounding*. Hai phát hiện đặc biệt đáng lưu tâm ở đây: hiệu năng sụp đổ với ngoại lệ lồng nhau (văn bản luật Việt Nam đầy các mệnh đề `trừ trường hợp...` lồng nhau), và mô hình đã tinh chỉnh chuyên ngành luật lại *kém hơn hẳn* mô hình đa dụng ở khâu phân tích cấu trúc. **Trục này chưa sẵn sàng.** Theo dõi tài liệu; đừng xây.

### 5d. SAT-Graph RAG — tương đồng bên ngoài gần nhất với dự án này

**"An Ontology-Driven Graph RAG for Legal Norms: A Hierarchical, Temporal, and Deterministic Approach"** (Hudson de Martim, Thượng viện Liên bang Brazil — [arXiv:2505.00039](https://arxiv.org/abs/2505.00039), [JURIX 2025](https://journals.sagepub.com/doi/10.3233/FAIA251598)) hội tụ về kiến trúc của dự án này từ hướng ngược lại và là bài báo liên quan nhất tìm được. Cách họ đặt vấn đề: "truy xuất văn bản phẳng tiêu chuẩn mù trước cấu trúc thứ bậc, lịch đại và nhân quả của pháp luật, dẫn tới những câu trả lời lỗi thời và không đáng tin."

**Ontology** (dẫn xuất từ LRMoo):

| Nút                                 | Vai trò                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Norm (Work)**                | Quy phạm pháp luật ở dạng trừu tượng — ví dụ chính bản Hiến pháp (LRMoo F1)                                           |
| **Component (Component Work)** | Các thành phần thứ bậc (phần, chương, điều)**giữ nguyên danh tính khái niệm xuyên suốt các lần sửa đổi** |
| **Temporal Version (TV/CTV)**  | Ảnh chụp không phụ thuộc ngôn ngữ của một Norm hoặc Component tại một thời điểm (LRMoo F2 Expression)                 |
| **Language Version (LV/CLV)**  | Hiện thực hóa văn bản cụ thể trong một ngôn ngữ                                                                            |
| **Action**                     | Sự kiện lập pháp được vật thể hóa thành nút                                                                              |
| **Theme**                      | Phân loại chủ đề                                                                                                                |

**Hai ý tưởng liên quan trực tiếp tới các quyết định đã có ở đây:**

1. **Danh tính điều khoản được tách khỏi phiên bản điều khoản.** Một Component Work là "Điều 5 của Luật X" ổn định, tồn tại xuyên mọi lần sửa đổi, với các Temporal Version treo bên dưới. Thiết kế hiện tại tại [../database-design.md](../database-design.md) §2b đặt `valid_from`/`valid_to` trực tiếp lên `:Provision`, làm hai thứ nhập một — `MERGE` theo `node_key` nghĩa là nút chỉ có thể giữ phiên bản hiện hành, còn lịch sử được tái dựng gián tiếp từ các cạnh `MODIFIES` cộng ngày tháng (đúng như §2b thừa nhận). Cách đó chạy được, nhưng có nghĩa "Điều 5 nói gì hồi năm 2020" vĩnh viễn là một truy vấn Postgres, không bao giờ là truy vấn đồ thị. **Đây là ngã rẽ thực sự, đáng quyết định có chủ đích khi `:Provision` còn chưa được xây — sửa lại sau khi projector Neo4j đã tồn tại sẽ rất tốn kém.**
2. **Sự kiện lập pháp được vật thể hóa thành nút `Action` hạng nhất.** Thay vì để việc sửa đổi là một *thuộc tính trên cạnh* (`MODIFIES {change_type, effective_date}`), bản thân sự kiện sửa đổi là một nút nối điều khoản nguồn → phiên bản bị chấm dứt → phiên bản được tạo, kèm một Text Unit mô tả được sinh ra để nó trở nên truy xuất được. Điều này khiến câu hỏi *"cái gì đã gây ra thay đổi này?"* truy vấn được trực tiếp thay vì phải suy diễn. Liên quan: **trạng thái thời gian được mô hình hóa bằng gộp (aggregation), không phải hợp thành (composition)** — khi Điều 6 bị sửa, phiên bản mới ở cấp Chương *tái sử dụng* phiên bản chưa đổi của Điều 7 thay vì nhân bản nó, cho phép tái dựng theo thời điểm một cách tất định mà không trùng lặp dữ liệu. Đây là một câu trả lời hữu ích cho nỗi lo trùng lặp trong bất kỳ thiết kế theo thời điểm nào.

**Luận điểm cốt lõi của bài báo xác nhận độc lập hướng đi ở đây:** duyệt đồ thị tất định xác định chính xác các phiên bản còn hiệu lực, lấy về text unit tương ứng, và lắp ghép chuỗi xuất xứ thành dữ liệu có cấu trúc; **LLM chỉ tổng hợp từ ngữ cảnh đã bị ràng buộc sẵn bởi các thao tác tất định.** Đánh giá của bài báo được nêu rõ là *định tính, dựa trên vết thực thi (trace-based)*, nên hãy coi kiến trúc này là được lập luận tốt chứ chưa được đo đạc.

---

## 6. Tầng khái niệm gắn vào pipeline hybrid ra sao

Các bài báo khá nhất quán về *chỗ* đồ thị gắn vào, và **không bài nào đặt nó bên trong bước hợp nhất RRF**. Hybrid+RRF giữ nguyên như thiết kế; đồ thị bọc quanh nó.

```text
                   ┌── (A) phía truy vấn: mở rộng thuật ngữ, phân giải trích dẫn, phạm vi
                   │
truy vấn ─► router ┤
       (chọn chiến │   (B) ràng buộc hiệu lực ──┐
        lược)      │                            ▼
                   │        ┌───────────────────────────────┐
                   │        │ OpenSearch (BM25)             │
                   ├───────►│ Vector store (ngữ nghĩa)      │──► RRF ──► top-k
                   │        └───────────────────────────────┘            │
                   │                                                     ▼
                   └── (C) làm giàu / xếp hạng lại bằng đồ thị ◄─────────┘
                                        │
                                        ▼
                                    sinh câu trả lời
                                        │
                                        ▼
                            (D) kiểm định trích dẫn
```

### 6a. Bốn điểm gắn kết

**(A) Phía truy vấn — đồ thị chạy trước tìm kiếm.** Đồ thị viết lại hoặc thu hẹp truy vấn thay vì trả lời nó. Hai bước đầu trong pipeline của SAT-Graph chính là việc này: *chuẩn hóa* các ràng buộc cấu trúc/thời gian/văn bản, rồi *phân giải phạm vi* theo thứ bậc. Cụ thể: mở rộng thuật ngữ được định nghĩa (§5b), phân giải trích dẫn (`Điều 5 Luật 45/2019/QH14` → `node_key`, không cần xếp hạng), và thu hẹp phạm vi qua `field`/`industry`. Chi phí là một bước nhảy độ trễ; lợi ích là độ chính xác, biến khớp mờ thành tra cứu chính xác ở mọi chỗ truy vấn có chứa thứ phân giải được.

**(B) Hiệu lực như bộ lọc trước xếp hạng.** Nói cho đúng thì phần này không hẳn là "đồ thị" — nó là metadata đi kèm — nhưng SAT-Graph tách nó thành một bước riêng và nhấn mạnh nó phải chạy trước truy xuất, thông qua các chính sách thời gian tường minh. Trong dự án này đó chính là khối `filter` tại [../database-design.md](../database-design.md) §3d và bộ lọc payload của vector store tại §4. Kỷ luật mà bài báo bổ sung: *chính sách* dùng để chọn phiên bản được **công bố kèm trong đầu ra**, để câu trả lời nêu rõ nó đang đọc theo mốc thời gian nào thay vì âm thầm chọn một mốc.

**(C) Làm giàu và xếp hạng lại sau truy xuất.** Cách nối phổ biến nhất và ít xâm lấn nhất — đầu ra của RRF đơn giản trở thành đầu vào của một bước khác. Legal-GraphRetriever xếp hạng lại các ứng viên hybrid bằng đồ thị trích dẫn cộng tinh chỉnh theo thời gian để tách quy định còn hiệu lực khỏi quy định đã bị thay thế; phân tích lên/xuống cây của vLex Vincent là bản thương mại tương đương. Ngoài ra: kéo theo chuỗi sửa đổi (lấy được Điều 5 → đi theo `MODIFIES` → gắn văn bản sửa đổi và nội dung hiện hành vào ngữ cảnh). **Đây là điểm khởi đầu được khuyến nghị**, vì nó không đòi hỏi thay đổi gì ở nhánh truy xuất.

**(D) Kiểm định sau khi sinh.** Tác tử Auditor của LegalGraphRAG đối chiếu từng luận điểm với văn bản gốc trước khi Adjudicator tổng hợp; SAT-Graph lắp chuỗi xuất xứ thành đồ thị có hướng không chu trình (DAG); [arXiv:2606.00898](https://arxiv.org/abs/2606.00898) thực hiện neo trích dẫn vào đồ thị trích dẫn. Mọi trích dẫn được sinh ra phải phân giải ngược về một nút thật; cái nào không phân giải được thì bị loại bỏ hoặc gắn cờ.

### 6b. Chọn chiến lược ánh xạ vào tầng agent

Bước thứ ba trong pipeline của SAT-Graph là **chọn chiến lược — ưu tiên cấu trúc / ưu tiên đoạn văn / ưu tiên thời gian** — mô tả rõ ràng nhất hiện có về việc tầng agentic đang được lên kế hoạch thực sự cần quyết định điều gì:

| Dạng truy vấn                               | Chiến lược         | Nhánh chạy trước                                                            |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| "Điều 5 Luật 45/2019/QH14 quy định gì?" | ưu tiên cấu trúc  | Đồ thị phân giải trích dẫn; tìm kiếm hybrid có thể không cần chạy |
| "quy định về bảo vệ dữ liệu cá nhân" | ưu tiên đoạn văn | Hybrid+RRF dẫn đầu; đồ thị làm giàu sau                                 |
| "quy định này năm 2020 thế nào?"        | ưu tiên thời gian  | Chọn phiên bản theo thời gian thu hẹp kho, rồi tìm trong đó            |

**Một trục thứ hai, trực giao: độ phức tạp.** HyPA-RAG (§2g) định tuyến theo *tiêu tốn bao nhiêu công truy xuất* thay vì *nhánh nào dẫn đầu* — truy vấn đơn giản chỉ dùng sparse retrieval với ít chunk, truy vấn phức tạp dùng toàn bộ ngăn xếp dense+sparse+KG với nhiều chunk hơn và tham số được tinh chỉnh. Hai trục này ghép với nhau rất gọn: **hình dạng quyết định nhánh nào dẫn đầu, độ phức tạp quyết định đi sâu tới đâu.** Đây là đặc tả cụ thể hơn cho bộ định tuyến so với chỉ dùng hình dạng, và nó có tương đồng trong production — "3–10 lượt gọi công cụ co giãn theo độ phức tạp truy vấn" của Harvey (§1a) chính là ý tưởng này. Nó cũng là trục *đo đạc được* hơn trong hai trục: định tuyến theo độ phức tạp có sẵn một đánh đổi chi phí/độ chính xác để đo, trong khi định tuyến theo hình dạng chủ yếu phải đánh giá qua độ đúng của câu trả lời.

Cách nhìn này định khung lại công việc của agent một cách hữu ích: không phải "chọn gọi công cụ nào trong ba bộ truy xuất", mà là "**chọn nhánh nào dẫn đầu**", với hybrid+RRF vẫn là ngựa thồ mặc định cho mọi thứ thuần từ khóa hoặc ngữ nghĩa. Nó cũng trả lời trực tiếp cảnh báo ở §2g — điều phối agentic có lợi ở nơi độ đa dạng truy vấn là có thật, và truy vấn dạng-trích-dẫn / dạng-khái-niệm / dạng-thời-gian đúng là như vậy.

### 6c. Cái bẫy hấp dẫn

Hợp nhất lượt duyệt đồ thị vào như một **danh sách xếp hạng thứ ba** bên cạnh BM25 và dense. Xem §4a để biết vì sao đây là lựa chọn không phù hợp: một lượt duyệt trả về tập hợp không có thứ tự xếp hạng có ý nghĩa, trong khi RRF cần thứ tự có ý nghĩa mới hoạt động đúng. Hãy giữ đồ thị ở vai trò lọc / mở rộng / xếp hạng lại / kiểm định.

---

## 7. Áp dụng vào codebase hiện tại

### 7a. Giai đoạn hiện tại ràng buộc những gì, và không ràng buộc những gì

Repo đang ở một điểm cụ thể: `law-index` cào vbpl.vn vào Postgres, chưa chiếu sang đâu cả — không CDC, không projector OpenSearch/vector/Neo4j. Điều đó ràng buộc ít hơn nhiều so với vẻ ngoài.

**Không kỹ thuật nào trong §2–§6 đòi hỏi thay đổi thứ crawler thu thập.** Crawl thu nguyên liệu thô; mọi thứ tài liệu khoa học đề xuất đều là *diễn giải* chồng lên nguyên liệu đó. Chừng nào `document.rawSource.fullText`, cây `document_node`, và `document_reference` còn được lưu trung thực, thì chunking theo cấu trúc, chiếu sang đồ thị, trích xuất thuật ngữ định nghĩa, và kiểm định trích dẫn đều là những phép suy dẫn lại chạy offline, không bao giờ phải đụng tới vbpl.vn nữa.

| Kỹ thuật | Đổi crawl | Đổi schema |
| - | - | - |
| Chunking parent-child / theo cấu trúc (§2b) | không — `document_node` đã giữ cây | không |
| Hiệu lực làm bộ lọc cứng trước xếp hạng (§2d) | không — đã parse sẵn | **`expiry_date` — xem §7b** |
| Kiểm định trích dẫn (§6a, điểm D) | không | không — `document_reference` là đủ |
| Định tuyến theo độ phức tạp/hình dạng (§6b) | không | không — thuần tầng agent |
| Tách danh tính/phiên bản điều khoản (§5d) | không | chỉ phía Neo4j; Postgres không đụng |
| Embedding tinh chỉnh tiếng Việt (§2f) | không | không |
| Tầng thuật ngữ định nghĩa (§5b) | không — suy ra từ `document_node.textContent` | sau này cần một thực thể thuật ngữ |
| Tầng chủ đề (§5a) | không — `industry`/`field` đã lưu | không |

Hệ quả thực tế: **kiến trúc truy xuất hoãn được mà không mất gì; phần audit ở §7b thì không.**

### 7b. Loại thay đổi duy nhất đắt nếu để chậm

Chia các thay đổi khả dĩ làm hai nhóm:

- **Thay đổi diễn giải thì rẻ.** Bất cứ thứ gì suy dẫn lại được từ dữ liệu đã lưu — ranh giới chunk, embedding, cạnh đồ thị, định nghĩa thuật ngữ — đều dựng lại offline được bao nhiêu lần tuỳ ý. Làm sai thì tốn compute, không tốn quyền truy cập.
- **Thay đổi thu thập thì đắt.** Một trường hiện trên trang vbpl.vn nhưng không được lưu chỉ có thể khôi phục bằng cách cào lại từng văn bản qua headless browser. Làm sai thì tốn nguyên một lượt crawl.

Chỉ nhóm thứ hai cần quyết sớm, nên đáng rà soát parser đối chiếu schema *trước khi* xây bất kỳ projector nào. Rà soát đó tìm được đúng một trường hợp, cộng thêm ảnh phản chiếu của nó:

**`expiry_date` — đã parse nhưng bị vứt đi** (đã sửa, migration 0005). "Ngày hết hiệu lực" của vbpl.vn được parse vào `ParsedVbplAttributes.expiryDateRaw` và đưa vào hash `content_version`, nhưng không có cột để chứa, nên giá trị bị bỏ trên mọi lượt cào. Nó quan trọng đúng vì §2d: một bộ lọc hiệu lực cứng cần **cả hai** đầu của khoảng. `document.status` trả lời "còn hiệu lực *bây giờ*"; chỉ `effective_date`/`expiry_date` mới trả lời "còn hiệu lực *vào ngày X*" — đúng truy vấn mà tài liệu khoa học khẳng định phải là ràng buộc trước xếp hạng, chứ không phải thứ giao cho độ tương đồng tự lo.

**`gazette_published_date` — ảnh phản chiếu.** Một cột không ai ghi, vì vbpl.vn không render ngày công báo. Null ở mọi hàng, nhưng vẫn được các endpoint retrieve đọc ra như thể là dữ liệu. Cả hai nửa của cuộc rà soát này (đã-parse-mà-không-lưu, đã-lưu-mà-không-ai-ghi) đều đáng chạy lại trước mỗi projector mới.

Ba bài học từ việc triển khai bản sửa đó, tổng quát hoá được cho mọi cột thêm sau này:

1. **`content_version` không "nhìn thấy" được thay đổi schema.** Hash tính từ trang đã cào chứ không phải từ hàng đã lưu, nên thêm cột không bao giờ làm hash đổi — một lượt cào lại thông thường sẽ ngắt mạch vì "không đổi" và để cột mới NULL vĩnh viễn. Backfill cần một lối thoát tường minh (`force` trên các endpoint PUT) bỏ qua chỗ ngắt mạch đó. Hãy tính trước điều này mỗi khi thêm cột lấy từ dữ liệu đã cào.
2. **Kiểm `rawSource` trước khi kết luận là phải cào lại.** Thường thì đúng là phải: `rawSource` chỉ giữ `fullText` cộng thông tin provenance, không có tab thuộc tính, nên các trường thuộc tab đó thực sự không khôi phục được nếu không quay lại trang.
3. **Giới hạn tập backfill bằng ngữ nghĩa pháp lý, không bằng số hàng.** Đã xác nhận trên trang thật rằng văn bản `het_hieu_luc_mot_phan` và `ngung_hieu_luc` hoàn toàn không có ngày hết hiệu lực — loại thứ nhất vẫn còn hiệu lực xét toàn văn bản (hết hiệu lực một phần là trạng thái ở mức `document_node`), loại thứ hai là ngưng tạm thời chứ không phải điểm kết thúc. Chỉ hết hiệu lực toàn bộ mới đóng khoảng, điều này cắt backfill từ toàn bộ 3.338 hàng xuống 368. Một giá trị NULL đúng về ngữ nghĩa thì không cần backfill chút nào, và chính phần phân tích xác định "NULL nào là đúng" mới đáng giá hơn bản thân bộ máy backfill.

### 7c. Thứ tự triển khai

Xếp theo giá trị trên công sức, đối chiếu với phần việc đã lên lịch trong mục Sequencing của [../../README.md](../../README.md). **Đây là khuyến nghị, không phải quyết định.**

1. **CDC + sync-state + đối soát** (đã là bước kế tiếp trong trình tự của README) — vẫn là bước đúng tiếp theo. Bổ sung một điểm mà thiết kế hiện tại chưa nêu: **lọc theo hiệu lực thuộc về hợp đồng của công cụ truy xuất**, được cưỡng chế như bộ lọc cứng trước xếp hạng. Đây là bài toán tin cậy trung tâm còn bỏ ngỏ của ngành (§2d), không phải chi tiết hạ tầng. Phần *dữ liệu* của việc này đã xong (§7b) — `expiry_date` giờ đã đóng khoảng hiệu lực — nên thứ còn lại là cưỡng chế ở thời điểm truy vấn, không phải khâu thu thập.
2. **Quyết định việc tách danh tính/phiên bản cho `:Provision`** (§5d) — rẻ nếu làm bây giờ, đau đớn nếu làm sau khi projector Neo4j đã tồn tại.
3. **Đồ thị làm bộ xếp hạng lại sau truy xuất** (§6a, điểm C) — cách tích hợp ít xâm lấn nhất, không đụng tới nhánh truy xuất.
4. **Kiểm định trích dẫn** (§6a, điểm D) — giá trị cao với tỷ lệ ảo giác 17–33%; lược đồ hiện tại đã hỗ trợ sẵn.
5. **Mô hình embedding tinh chỉnh cho tiếng Việt** (§2f) — quyết định trước khi viết projector ChromaDB/Qdrant.
6. **Tầng thuật ngữ định nghĩa / `defines_term`** (§5b) — giá trị trên công sức cao nhất trong các trục khái niệm và có tính tất định với tiếng Việt, nhưng vẫn phải *sau* phần việc hiệu lực: một đồ thị định nghĩa phủ lên những điều khoản chưa biết còn hiệu lực hay không là một cái bẫy về độ chính xác.
7. **Tầng chủ đề** (§5a) — gần như miễn phí qua `industry`/`field`; chỉ xem lại nếu quá thô.
8. **Cấu trúc deontic / quy tắc** (§5c) — không xây. Theo dõi tài liệu.

**Điều cần cưỡng lại:** coi một tầng khái niệm như cách *né* phần việc về thời gian. Mọi bài báo được khảo sát, rõ nhất là SAT-Graph, đều áp hiệu lực như ràng buộc *trước khi* việc duyệt theo khái niệm chạy — một đồ thị giàu hơn không làm cho hiệu lực bớt cần thiết.

---

## 8. Thư mục tài liệu tham khảo

### Hệ thống và benchmark RAG pháp lý

| Tài liệu                                                      | Liên kết                                          |
| --------------------------------------------------------------- | --------------------------------------------------- |
| LegalBench-RAG — benchmark tách riêng bước truy xuất      | [arXiv:2408.10343](https://arxiv.org/abs/2408.10343) |
| LexRAG — benchmark tư vấn pháp lý nhiều lượt            | [arXiv:2502.20640](https://arxiv.org/abs/2502.20640) |
| LegalBench — 162 tác vụ lập luận pháp lý                 | [arXiv:2308.11462](https://arxiv.org/abs/2308.11462) |
| LexGLUE — benchmark hiểu ngôn ngữ pháp lý (ACL 2022)      | [arXiv:2110.00976](https://arxiv.org/abs/2110.00976) |
| DISC-LawLLM — LLM pháp lý Trung Quốc dùng tam đoạn luận | [arXiv:2309.11325](https://arxiv.org/abs/2309.11325) |
| SaulLM-7B — LLM pháp lý giấy phép MIT                      | [arXiv:2403.03883](https://arxiv.org/abs/2403.03883) |
| ChatLaw — RA-MoE đa tác tử + KG                             | [arXiv:2306.16092](https://arxiv.org/abs/2306.16092) |
| LawGPT — thích ứng miền pháp lý tiếng Trung              | [arXiv:2406.04614](https://arxiv.org/abs/2406.04614) |

### Truy xuất, hợp nhất, chunking

| Tài liệu                                                                          | Liên kết                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Segment First, Retrieve Better — BM25+dense+RRF, phân đoạn theo vai trò tu từ | [arXiv:2508.00679](https://arxiv.org/pdf/2508.00679) |
| Towards Reliable Retrieval in RAG for Large Legal Datasets — ablation chunking     | [arXiv:2510.06999](https://arxiv.org/abs/2510.06999) |

### RAG pháp lý tăng cường bằng đồ thị

| Tài liệu                                                                              | Liên kết                                                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **SAT-Graph RAG — dựa ontology, phân cấp, theo thời gian, tất định**      | [arXiv:2505.00039](https://arxiv.org/abs/2505.00039) · [JURIX 2025](https://journals.sagepub.com/doi/10.3233/FAIA251598) |
| LegalGraphRAG — chunk/khái niệm/góc nhìn + kiểm định 3 tác tử                 | [arXiv:2605.28120](https://arxiv.org/abs/2605.28120)                                                                     |
| Bridging Legal Knowledge and AI — vector store + KG dựng bằng NMF phân cấp         | [arXiv:2502.20364](https://arxiv.org/abs/2502.20364)                                                                     |
| Domain-Partitioned Hybrid RAG / KG-LegalRAG / LexGraph                                  | [arXiv:2602.23371](https://arxiv.org/pdf/2602.23371)                                                                     |
| Falkor-IRAC                                                                             | [arXiv:2605.14665](https://arxiv.org/abs/2605.14665)                                                                     |
| LKIF-Core — ontology các khái niệm pháp lý nền tảng                             | [CEUR Vol-321](https://ceur-ws.org/Vol-321/paper3.pdf)                                                                   |
| Biểu diễn quy phạm pháp luật với phạm vi và phương thức deontic tường minh | [Springer](https://link.springer.com/chapter/10.1007/978-981-92-0071-9_20)                                               |

### Hiệu lực theo thời gian

| Tài liệu                                                                                             | Liên kết                                          |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Mô hình FRBR/FRBRoo theo thời gian cho quản lý phiên bản ở cấp thành phần                   | [arXiv:2506.07853](https://arxiv.org/abs/2506.07853) |
| Beyond Probabilistic Similarity — giới hạn cấu trúc/thời gian/nhân quả của RAG                | [arXiv:2606.09724](https://arxiv.org/abs/2606.09724) |
| Asking For An Old Friend — kiểu lỗi theo thời gian trong hỏi đáp luật thành văn (ICAIL 2026) | [arXiv:2605.23497](https://arxiv.org/abs/2605.23497) |
| Can LLMs Time Travel? — dùng RL cải thiện nhất quán thời gian                                   | [arXiv:2605.25920](https://arxiv.org/abs/2605.25920) |

### Ảo giác và kiểm định

| Tài liệu                                                                                    | Liên kết                                                                                                                |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Large Legal Fictions — ảo giác 58–88% ở LLM đa dụng**                          | [arXiv:2401.01301](https://arxiv.org/abs/2401.01301)                                                                       |
| **Hallucination-Free? — 17–33% ở công cụ RAG pháp lý thương mại (JELS 2025)** | [arXiv:2405.20362](https://arxiv.org/abs/2405.20362) · [JELS](https://onlinelibrary.wiley.com/doi/full/10.1111/jels.12413) |
| Citation Grounding qua đồ thị trích dẫn pháp lý                                        | [arXiv:2606.00898](https://arxiv.org/abs/2606.00898)                                                                       |
| Span-Grounded Deontic Trees + NormBench                                                       | [arXiv:2606.08932](https://arxiv.org/html/2606.08932)                                                                      |

### NLP pháp lý tiếng Việt

| Tài liệu                                                                            | Liên kết                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| ALQAC — Automated Legal Question Answering Competition                               | [alqac.github.io](https://alqac.github.io/)          |
| VLQA — benchmark hỏi đáp pháp luật tiếng Việt                                 | [arXiv:2507.19995](https://arxiv.org/abs/2507.19995) |
| Truy xuất đa giai đoạn cho văn bản pháp luật tiếng Việt (BM25+ → SPhoBERT) | [arXiv:2209.14494](https://arxiv.org/abs/2209.14494) |
| Khai thác mẫu âm bán khó cho truy xuất pháp lý tiếng Việt                   | [arXiv:2507.14619](https://arxiv.org/abs/2507.14619) |
| Dữ liệu tổng hợp cho truy xuất pháp lý tiếng Việt                            | [arXiv:2412.00657](https://arxiv.org/abs/2412.00657) |
| Mạng nơ-ron sâu có cơ chế chú ý cho truy xuất văn bản pháp luật          | [arXiv:2212.13899](https://arxiv.org/abs/2212.13899) |

### Điều phối agentic

| Tài liệu                                                                                                  | Liên kết                                                                  |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Agentic RAG: A Survey                                                                                       | [arXiv:2501.09136](https://arxiv.org/abs/2501.09136)                         |
| All for Law and Law for All — RAG pháp lý thích ứng (NLLP 2025)                                        | [arXiv:2508.13107](https://arxiv.org/abs/2508.13107)                         |
| **HyPA-RAG — hybrid (dense+sparse+KG) thích ứng theo độ phức tạp truy vấn, CustomNLP4U 2024** | [ACL:2024.customnlp4u-1.18](https://aclanthology.org/2024.customnlp4u-1.18/) |

### Hệ thống thương mại và chính phủ

| Nguồn                                                                | Liên kết                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harvey — RAG cấp doanh nghiệp                                      | [harvey.ai/blog](https://www.harvey.ai/blog/enterprise-grade-rag-systems)                                                                                |
| Harvey — tìm kiếm agentic                                          | [harvey.ai/blog](https://www.harvey.ai/blog/how-agentic-search-unlocks-legal-research-intelligence)                                                      |
| Harvey — BigLaw Bench retrieval                                      | [harvey.ai/blog](https://www.harvey.ai/blog/biglaw-bench-retrieval)                                                                                      |
| Voyage AI — embedding pháp lý riêng cho Harvey                    | [blog.voyageai.com](https://blog.voyageai.com/2024/07/31/harvey-partners-with-voyage-to-build-custom-legal-embeddings/)                                  |
| Robin AI — đánh giá chunking/embedding cho RAG                    | [robinai.com](https://robinai.com/news-and-resources/blog/optimizing-rag-for-contract-analysis-our-research-findings-2)                                  |
| LexisNexis — pipeline trích dẫn pháp lý có liên kết           | [lexisnexis.com](https://www.lexisnexis.com/blogs/au/b/insights/posts/hallucination-free-linked-legal-citations)                                         |
| vLex Vincent — mô hình và phân tích vụ án                     | [support.vlex.com](https://support.vlex.com/vincent-by-vlex/vincent/security-privacy-and-compliance/understanding-the-ai-models-used-by-vincent)         |
| EUR-Lex — văn bản hợp nhất                                       | [eur-lex.europa.eu](https://eur-lex.europa.eu/collection/eu-law/consleg.html)                                                                            |
| legislation.gov.uk — API và quản lý phiên bản theo thời điểm | [legislation.github.io](https://legislation.github.io/data-documentation/api/overview.html)                                                              |
| Singapore LawNet 4.0 / GPT-Legal Q&A                                  | [govinsider.asia](https://govinsider.asia/intl-en/article/singapore-trials-agentic-ai-for-corporate-compliance-launches-genai-search-engine-for-lawyers) |
