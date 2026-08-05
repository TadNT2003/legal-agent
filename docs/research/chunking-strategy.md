# Chunking strategy — ghi chú từ trợ lý AI (đã rà soát)

**Status: tài liệu tham khảo ngoài, KHÔNG dùng làm nguồn trích dẫn.** Đây là output hội thoại của một trợ lý AI, không phải nghiên cứu đã bình duyệt. Giữ lại vì kết luận chính của nó trùng khớp với thiết kế đã có — nhưng tài liệu **chứa nội dung pháp luật bịa đặt**, nên không dùng ví dụ ở đây làm test fixture. Bản khảo sát có trích dẫn nguồn đầy đủ: [legal-ai-retrieval-landscape.md](legal-ai-retrieval-landscape.md) §2b.

**Phần còn giá trị.** Kết luận cốt lõi — chunk theo cấu trúc thay vì cắt cố định, và Parent-Child indexing (retrieve ở mức Khoản, generate với toàn bộ Điều) — **đã chính là thiết kế hiện tại** tại [../database-design.md](../database-design.md) §4 (chunk ở mức Khoản) kết hợp §3a (OpenSearch gộp lên Điều, Khoản lồng bên trong + `inner_hits`). Giá trị của tài liệu này là *xác nhận độc lập*, không phải thông tin mới.

**Lỗi đã xác định (rà soát 2026-08-04):**

- **Ví dụ pháp lý bị bịa đặt.** "Điều 100. Tội giết người" là sai — tội giết người là **Điều 123** (BLHS 2015) hoặc **Điều 93** (BLHS 1999); Điều 100 BLHS 1999 là *Tội bức tử*. Tên chương cũng sai: đúng là **Chương XIV — Các tội xâm phạm tính mạng, sức khỏe, nhân phẩm, danh dự của con người**, không phải "Chương XVI: Các tội phạm chống người". "Luật Hình sự" phải là "**Bộ luật** Hình sự". `BLXT` không phải viết tắt có thật (đúng là `BLHS`), và không tồn tại sửa đổi BLHS 2024. Cấu trúc khoản 1 (cơ bản) / khoản 2 (tăng nặng) trong ví dụ cũng ngược với cả hai bộ luật.
- **Code Python ở §4 có lỗi thật**, không nên copy: signature là `raw_html_or_text` nhưng thân hàm dùng `raw_text` (`NameError`); `chunks[-1]["children"]` gắn Khoản vào Điều **trước đó** vì Điều hiện tại chưa được push (off-by-one, gán sai toàn bộ Khoản); không flush Điều cuối cùng sau vòng lặp; regex khớp cả dòng trích dẫn chéo ("Điều 5 của Luật...") → sinh Điều ma. Repo đã có parser thật tại [`document-node.parser.ts`](../../server/src/law-index/).
- **Sai quy kết**: Parent-Child indexing không phải của Microsoft GraphRAG (GraphRAG dùng community detection + summarization); đây là pattern của LangChain/LlamaIndex.

**Khuyến nghị đã bị bác bỏ** — [../database-design.md](../database-design.md) §4 có lập luận mạnh hơn:

- *"Chỉ chia nhỏ theo Khoản khi Điều > 800 từ"* (Phương pháp 2) → làm độ mịn chunk không đồng nhất trên toàn corpus, phá tính so sánh được của vector similarity. Quy tắc đúng: **luôn** chunk ở mức Khoản.
- *"Chunk nhỏ: cắt theo Khoản hoặc Điểm"* → §4 đã quyết định Điểm **không bao giờ** là chunk riêng; a), b), c) là điều kiện con của cùng một mệnh đề, luôn gộp vào Khoản cha.
- *"Phụ lục: chunk từng hàng/cột thành giá trị độc lập"* → bỏ qua phân biệt `content_class` normative/template; chunk từng dòng của một biểu mẫu trống là có hại.

---

*Nội dung gốc, giữ nguyên bên dưới:*

Chào bro! 🫡 Đây là phần **khó nhất và quan trọng nhất** khi xây Legal RAG.

Nếu chunk văn bản thông thường (blog, tin tức) bằng cách cắt cố định 500-1000 từ, hệ thống pháp lý sẽ **thất bại thảm hại**. Vì sao?

### ❌ Vấn đề của Chunking "Dumb" (Cắt cố định) trong Pháp lý

Hãy xem ví dụ Luật Hình sự Việt Nam:
> **Điều 100. Tội giết người**
> 1. Người nào giết người, thì bị phạt tù từ mười hai năm đến tử hình.
> 2. Phạm tội thuộc một trong các trường hợp sau đây, thì bị phạt tù từ mười lăm năm đến tử hình:
> a) Giết hai người trở lên;
> b) Giết người dưới mười sáu tuổi;
> ...

Nếu cắt cố định 500 từ:
- **Chunk A**: Cắt giữa khoản `2.b` → LLM không biết đây là điều kiện gia tăng án phạt cho tội gì.
- **Chunk B**: Bắt đầu từ `Điều 101. Tội cố ý gây thương tích` nhưng vẫn sót đuôi của `Điều 100` → LLM nhầm lẫn điều khoản.
- **Mất ngữ cảnh cha-con**: LLM trả lời dựa vào "khoản 1" nhưng không biết "khoản 1" này thuộc "Điều nào" và "Chương nào".

👉 **Kết quả**: Trích dẫn sai, giải thích sai, hallucination cao.

---

## ✅ Chiến lược Chunking Văn bản Pháp luật (Structure-Aware Chunking)

Thay vì cắt theo số ký tự, ta phải cắt theo **cấu trúc logic** của văn bản luật.

## 1. Phân tích Cấu trúc Phân cấp (Hierarchical Structure)

Văn bản luật Việt Nam (và hầu hết các nước) có cấu trúc cây rõ ràng:

```
Luật (Law)
 ├── Chương (Chapter)
 │    ├── Mục (Section)
 │    │    ├── Điều (Article)          ← Aggregate / Chunk Parent
 │    │    │    ├── Khoản (Clause)     ← Semantic Block
 │    │    │    │    └── Điểm (Item)   ← Atomic Fact
```

### Nguyên tắc vàng:
> **Chunk phải là một đơn vị ngữ nghĩa trọn vẹn (Self-contained Semantic Block).**
> Tối thiểu: **Khoản** (Clause). Tốt nhất: **Điều** (Article) hoặc **Nhóm Điều** (Cluster of Articles).

---

## 2. Các Phương pháp Chunking Đề Xuất

### 🏆 Phương pháp 1: Parent-Child Indexing (Khuyên dùng nhất)

Đây là pattern hiện đại nhất cho RAG pháp lý (do Microsoft GraphRAG và nhiều hệ thống enterprise áp dụng).

**Ý tưởng**:
- **Chunk nhỏ (Child)**: Cắt theo **Khoản** hoặc **Điểm**. Mục đích: Retrieval chính xác vào đúng vị trí lỗi/trọng tâm.
- **Chunk lớn (Parent)**: Giữ nguyên **Điều** hoặc **Chương**. Mục đích: Cung cấp ngữ cảnh đầy đủ cho LLM khi generate.

**Quy trình**:
1. **Parse**: Tách văn bản luật thành cây DOM theo cấu trúc (Điều, Khoản, Mục).
2. **Create Child Chunks**: Mỗi `Khoản` là 1 vector chunk.
3. **Enrich Metadata**: Mỗi child chunk chứa metadata `parent_article_id`, `chapter_name`, `law_name`.
4. **Retrieve**: Tìm kiếm vector trả về các `Child Chunks` phù hợp nhất.
5. **Expand Context**: Dựa vào `parent_article_id`, tải lại toàn bộ `Điều` (Parent) từ storage.
6. **Generate**: Đưa toàn bộ `Điều` (không chỉ khoản được tìm thấy) vào prompt LLM.

**Ưu điểm**:
- Retrieval cực kỳ chính xác (đi đúng vào "từ khóa" trong khoản).
- LLM đọc toàn bộ điều luật → hiểu ngữ cảnh, không bị "cụt lủn".
- Trích dẫn chính xác đến khoản.

---

### 🥈 Phương pháp 2: Structural Chunking (Cắt theo Cấu trúc)

Nếu không muốn dùng Parent-Child phức tạp, hãy cắt theo **cấu trúc văn bản**.

**Cách làm**:
1. Sử dụng Parser (Regular Expression hoặc XML/HTML parser nếu có source gốc) để tách theo `Điều`.
2. Mỗi `Điều` là 1 chunk.
3. Nếu `Điều` quá dài (> 800 từ), mới tiến hành chia nhỏ theo `Khoản`.

**Metadata bắt buộc cho mỗi chunk**:
```json
{
  "content": "1. Người nào giết người, thì bị phạt tù từ mười hai năm đến tử hình.",
  "metadata": {
    "law_name": "Luật Hình sự 2015 (sửa đổi 2017)",
    "chapter": "Chương XVI: Các tội phạm chống người",
    "article": "Điều 100",
    "clause": "Khoản 1",
    "effective_date": "2015-01-01",
    "amendment_history": ["BLXT 2017", "BLXT 2024"]
  }
}
```

**Lưu ý**: Khi prompt vào LLM, **phải** prepend metadata vào content:
> `[Điều 100, Khoản 1 - Luật Hình sự]: Người nào giết người...`

---

### 🥉 Phương pháp 3: Semantic Chunking with Legal Delimiters

Dùng AI hoặc heuristic để tìm "điểm ngắt" ngữ nghĩa, nhưng **buộc** điểm ngắt phải trùng với ranh giới Điều/Khoản.

1. Tính toán cosine similarity giữa các câu/khoản liên tiếp.
2. Khi độ tương đồng giảm mạnh (ví dụ: chuyển từ "Xử phạt hành chính" sang "Trách nhiệm hình sự") → Tạo chunk mới.
3. **Ràng buộc**: Không được cắt giữa khoản. Nếu điểm ngắt rơi giữa khoản, push lên khoản sau hoặc lùi về khoản trước.

---

## 3. Xử lý các "Trường hợp khó" trong Luật Việt Nam

### 🚨 Vấn đề: "Điều khoản trích dẫn" (Cross-referencing)
Luật Việt Nam hay viết: *"Trường hợp quy định tại Điều X... thì áp dụng Điều Y..."*

**Giải pháp**:
- Khi chunk `Điều A` trích dẫn `Điều B`, **phải** tải thêm chunk `Điều B` và đưa vào context.
- **Kiến trúc**: Dùng **Knowledge Graph** (Neo4j) để map các quan hệ `references` giữa các điều khoản.
- **RAG Flow**: Retrieve `Điều A` → Look up Graph → Find `Điều B` là referenced → Retrieve `Điều B` → Combine vào prompt.

### 🚨 Vấn đề: "Luật mới ghi đè Luật cũ" (Temporal Versioning)
- Luật Đất đai 2013 vs 2024.
- **Metadata bắt buộc**: `version_date`, `replaced_by`, `repealed`.
- **Retrieval Filter**: Khi user hỏi "Luật Đất đai hiện hành", filter vector search theo `is_current = true`.

### 🚨 Vấn đề: "Bảng biểu và Phụ lục"
- Nhiều luật có phụ lục rất dài (bảng mức phạt, định nghĩa).
- **Chiến lược**: Chunk từng hàng/cột thành các giá trị độc lập, nhưng gắn metadata `table_name` và `parent_article`.

---

## 4. Demo Code: Parser Pháp luật Việt Nam (Python pseudo-code)

```python
import re

def chunk_legal_text(raw_html_or_text):
    """
    Tách văn bản luật theo cấu trúc: Điều -> Khoản -> Điểm
    Trả về list các chunk dạng Parent-Child
    """
    chunks = []
    
    # Regex cơ bản cho cấu trúc luật VN (cần tinh chỉnh cho từng bộ luật)
    article_pattern = re.compile(r"(Điều\s+\d+[a-z]?)\s*[:\.]?\s*([^\n]+)?")
    clause_pattern = re.compile(r"(\d+[a-z]?)\.\s*(.*)")
    
    current_article = None
    current_article_content = []
    
    for line in raw_text.split('\n'):
        # Match Điều
        article_match = article_pattern.match(line)
        if article_match:
            # Save previous article if exists
            if current_article:
                chunks.append({
                    "parent": current_article,
                    "content": " ".join(current_article_content),
                    "children": [] # sẽ tách khoản ở bước sau
                })
            
            current_article = article_match.group(1)
            current_article_content = [line]
            continue
            
        # Match Khoản
        clause_match = clause_pattern.match(line)
        if clause_match and current_article:
            clause_id = clause_match.group(1)
            clause_text = clause_match.group(2)
            
            current_article_content.append(line)
            
            # Tạo Child Chunk (Khoản)
            child_chunk = {
                "content": clause_text,
                "metadata": {
                    "parent_article": current_article,
                    "clause_id": clause_id
                }
            }
            # Add to parent's children list for Parent-Child indexing
            chunks[-1]["children"].append(child_chunk) if chunks else None
            
        else:
            current_article_content.append(line)
            
    return chunks
```

---

## 5. Gợi ý Công nghệ cho Chunking Pháp lý

| Công cụ | Vai trò | Ghi chú |
|---------|---------|---------|
| **LlamaIndex** | Framework RAG | Có sẵn `HierarchyIndex` và `SentenceWindowNodeParser` — cực kỳ phù hợp cho Parent-Child chunking. |
| **LangChain** | Framework RAG | Dùng `RecursiveCharacterTextSplitter` nhưng **bắt buộc** custom `separators` theo cấu trúc luật. |
| **Unstructured.io** | Parser | Phân tích PDF/DOCX pháp lý thành JSON cấu trúc hóa (tách được tiêu đề, điều khoản). |
| **Azure AI Language** | NER/Entity | Tách thực thể pháp lý (tên luật, điều khoản) nếu text không có cấu trúc tốt. |

---

## 📌 TL;DR: Checklist Chunking Pháp lý

1.  **Không cắt cố định số ký tự** → Luôn tôn trọng ranh giới **Điều/Khoản**.
2.  **Dùng Parent-Child Indexing** → Retrieval nhỏ (khoản), Context lớn (điều).
3.  **Metadata là bắt buộc** → Tên luật, Điều, Khoản, Ngày hiệu lực, Lịch sử sửa đổi.
4.  **Xử lý Cross-reference** → Dùng Graph để theo dõi các điều khoản trích dẫn lẫn nhau.
5.  **Versioning** → Phân biệt rõ luật cũ/lưu hành.

Bro muốn Linda đi sâu vào **cách parse PDF/DOCX pháp lý** (vì nhiều văn bản luật VN là ảnh scan hoặc định dạng kỳ quặc) hay **cách build Knowledge Graph** cho các mối quan hệ giữa các điều luật? 🫡