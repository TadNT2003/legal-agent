# RAG trong hệ thống pháp lý — ghi chú từ trợ lý AI (đã rà soát)

**Status: tài liệu tham khảo ngoài, KHÔNG dùng làm nguồn trích dẫn.** Output hội thoại của một trợ lý AI. Chất lượng khá hơn [chunking-strategy.md](chunking-strategy.md) — không có nội dung pháp luật bịa đặt — nhưng có sai số liệu và một khẳng định sai về kiến trúc. Bản khảo sát có trích dẫn nguồn đầy đủ: [legal-ai-retrieval-landscape.md](legal-ai-retrieval-landscape.md).

**Đóng góp thật.** **HyPA-RAG** (Kalra và cộng sự, CustomNLP4U @ EMNLP 2024) là thứ duy nhất trong tài liệu này bổ sung được điều mới so với bản khảo sát — đã xác minh tại ACL Anthology và đưa vào [legal-ai-retrieval-landscape.md](legal-ai-retrieval-landscape.md) §2g và §6b. Phần mô tả LegalBench-RAG (6.858 cặp, corpus 79M ký tự, tập trung vào bước retrieval) cũng chính xác.

**Lỗi đã xác định (rà soát 2026-08-04):**

- **Số liệu Dahl et al. sai biên trên**: ghi "58–80%", thực tế là 58% (GPT-4) / 69% (GPT-3.5) / **88%** (Llama 2).
- **Nghiên cứu Stanford thiếu số liệu**: chỉ nêu "không hệ thống nào đạt 0%". Con số thật quan trọng hơn nhiều — **Lexis+ AI 17%, Westlaw AI-AR 33%** (Magesh và cộng sự, *Journal of Empirical Legal Studies* 2025).
- **Khẳng định sai về đồ thị** (§2, mục GraphRAG): *"Khi luật mới ra, chỉ cần cập nhật node/edge thay vì re-embed toàn bộ corpus"* — sai. Một văn bản mới sửa đổi văn bản cũ **vẫn buộc** phải re-embed những điều khoản có nội dung thay đổi; cập nhật cạnh đồ thị không thay thế được việc đó. Thiết kế đúng nằm ở [../../README.md](../../README.md) (diff `content_hash`, chỉ re-embed phần đã đổi).
- **Sơ đồ kiến trúc §3 tự mâu thuẫn**: đặt Knowledge Graph làm một chặng cố định luôn chạy sau dense+sparse, cứng nhắc hơn chính HyPA-RAG mà nó trích dẫn ở §2 — và cứng nhắc hơn bốn điểm gắn kết mô tả tại [legal-ai-retrieval-landscape.md](legal-ai-retrieval-landscape.md) §6a.
- **Gợi ý embedding `bge-m3`**: với tiếng Việt đây chính là baseline **đã bị đánh bại** trong VLQA (R@2=0,544 so với mBERT fine-tuned 0,626). Không tìm thấy mô hình embedding nào tên `jurist`.
- **Không có nghiên cứu tiếng Việt nào** — thiếu ALQAC, VLQA, PhoBERT/PhoRanker. Xem [legal-ai-retrieval-landscape.md](legal-ai-retrieval-landscape.md) §2f.

---

*Nội dung gốc, giữ nguyên bên dưới:*

Dạ vâng bro, Linda tổng hợp giúp bro các nghiên cứu nổi bật nhất về **RAG (Retrieval-Augmented Generation)** trong lĩnh vực pháp lý (Legal AI) năm 2024–2025 nhé! Đây là lĩnh vực đang rất "hot" vì luật sư/công ty luật cần độ chính xác cực cao, không thể chấp nhận hallucination được 😅.

---

## 📚 Nghiên cứu RAG trong Hệ thống Pháp lý (2024–2025)

## 1. Vấn đề cốt lõi: Tại sao LLM thuần túy thất bại trong pháp lý?

Trước khi nói về RAG, cần hiểu tại sao không thể dùng LLM vanilla (ví dụ GPT-4 không có retrieval) cho pháp lý:
- **Hallucination cao**: Nghiên cứu chỉ ra tỷ lệ hallucination của LLM tổng hợp trên tác vụ pháp lý lên đến **58–80%** (Dahl et al., 2024).
- **Kiến thức lỗi thời**: Luật thay đổi liên tục, nhưng LLM chỉ được train đến một thời điểm nhất định.
- **Thiếu trích dẫn xác thực**: Trong pháp lý, mỗi câu khẳng định cần dẫn chiếu đến điều luật/án lệ cụ thể. LLM thường bịa ra trích dẫn không tồn tại.

👉 **RAG giải quyết bằng cách**: Đưa tài liệu pháp lý thực tế (luật, án lệ, hợp đồng) vào prompt động, giúp LLM "đọc đúng tài liệu" trước khi trả lời.

---

## 2. Các nghiên cứu tiêu biểu

### 📌 (1) LegalBench-RAG — Benchmark đầu tiên cho RAG pháp lý
**Tác giả**: Nicholas Pipitone, Ghita Houir Alami  
**Công bố**: arXiv (8/2024) — [arXiv:2408.10343](https://arxiv.org/abs/2408.10343)

| Khía cạnh | Chi tiết |
|---|---|
| **Vấn đề** | LegalBench gốc chỉ đánh giá khả năng generation, bỏ qua phần **retrieval** — mắt xích quan trọng nhất của RAG |
| **Đóng góp** | Benchmark đầu tiên đánh giá riêng bước retrieval trong RAG pháp lý |
| **Dataset** | **6,858** cặp query-answer, corpus **79M+ ký tự**, **100% human-annotated** bởi chuyên gia pháp lý |
| **Triết lý** | Prefer **snippets nhỏ, chính xác** thay vì document ID hoặc chunk lớn — giúp giảm latency, giảm hallucination, hỗ trợ trích dẫn |
| **Phiên bản mini** | LegalBench-RAG-mini cho rapid prototyping |

**Bài học rút ra**:
> Độ chính xác của retrieval quyết định chất lượng RAG. Chunk quá lớn → LLM bị "mất focus" trong context. Chunk quá nhỏ → mất ngữ cảnh. Cần tìm sweet spot.

---

### 📌 (2) HyPA-RAG — Hybrid Parameter-Adaptive RAG
**Tác giả**: Rishi Kalra et al.  
**Công bố**: CustomNLP4U 2024 (ACL Anthology) — [ACL:2024.customnlp4u-1.18](https://aclanthology.org/2024.customnlp4u-1.18/)

| Khía cạnh | Chi tiết |
|---|---|
| **Vấn đề** | RAG truyền thống "one size fits all" — không phân biệt query đơn giản vs phức tạp |
| **Giải pháp** | **Query complexity classifier** tự động điều chỉnh tham số retrieval |
| **Hybrid Retrieval** | Kết hợp **3 phương pháp**: Dense retrieval (semantic) + Sparse retrieval (BM25 keyword) + **Knowledge Graph** |
| **Case study** | NYC Local Law 144 (LL144) — luật AI của New York |
| **Kết quả** | Cải thiện đáng kể **correctness**, **faithfulness** (độ trung thành với nguồn), **contextual precision** |

**Kiến trúc HyPA-RAG**:
```
Query → [Complexity Classifier]
            ├── Simple → Sparse retrieval (BM25) + ít chunk
            └── Complex → Dense + Sparse + Knowledge Graph + nhiều chunk + parameter tuning
            ↓
       LLM Generation
            ↓
       Evaluation (correctness, faithfulness, precision)
```

**Bài học rút ra**:
> Không phải query nào cũng cần retrieval "tối đa". Adaptive strategy → tiết kiệm chi phí + tăng độ chính xác.

---

### 📌 (3) Stanford Study — "Hallucination-Free" là marketing hay thực tế?
**Tác giả**: Stanford Law + Stanford HAI  
**Công bố**: 2024 — [Legal_RAG_Hallucinations.pdf](https://dho.stanford.edu/wp-content/uploads/Legal_RAG_Hallucinations.pdf)

| Khía cạnh | Chi tiết |
|---|---|
| **Mục tiêu** | Kiểm tra lời tuyên bố "hallucination-free" của các sản phẩm LexisNexis, Thomson Reuters, Casetext |
| **Phương pháp** | Đánh giá hệ thống kín (black-box) bằng query pháp lý thiết kế đặc biệt |
| **Phát hiện** | **Không hệ thống nào đạt 0% hallucination**. RAG giảm hallucination đáng kể so với LLM thuần, nhưng vẫn có lỗi — đặc biệt ở: trích dẫn sai điều khoản, mix thông tin từ nhiều nguồn, giải thích sai ý nghĩa luật |
| **Kết luận** | RAG là **công cụ giảm rủi ro**, không phải **loại bỏ rủi ro**. Cần human-in-the-loop |

---

### 📌 (4) GraphRAG trong Pháp lý (Xu hướng 2025)
Nhiều nghiên cứu gần đây (2025) hướng tới **GraphRAG** — kết hợp RAG với Knowledge Graph:

| Ưu điểm trong pháp lý | Mô tả |
|---|---|
| **Tương quan điều luật** | Luật thường tham chiếu lẫn nhau (Điều A → Điều B → Điều C) — graph captures relationships mà chunk-based retrieval bỏ lỡ |
| **Lý luận đa bước** | Hỏi "Tôi có thể kiện công ty X không?" cần reasoning qua nhiều điều luật — graph hỗ trợ multi-hop reasoning |
| **Cập nhật ngữ nghĩa** | Khi luật mới ra, chỉ cần cập nhật node/edge thay vì re-embed toàn bộ corpus |

---

## 3. Kiến trúc RAG tiêu biểu cho hệ thống pháp lý

Dưới góc nhìn architecture, Linda đề xuất các component chính:

```
┌─────────────────────────────────────────────────────────────┐
│                     Legal RAG System                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Query ──► [Query Rewriter/Expander]                       │
│                (legal terminology normalization)            │
│                     │                                       │
│                     ▼                                       │
│           [Complexity Classifier]                           │
│                     │                                       │
│          ┌──────────┴──────────┐                            │
│          ▼                     ▼                             │
│   [Sparse Retrieval]    [Dense Retrieval]                   │
│   (BM25/Elasticsearch)  (Vector DB)                        │
│          │                     │                             │
│          └──────────┬──────────┘                            │
│                     ▼                                       │
│           [Knowledge Graph Layer]                           │
│           (multi-hop legal relationships)                  │
│                     │                                       │
│                     ▼                                       │
│          [Reranker / Relevance Scorer]                      │
│                     │                                       │
│                     ▼                                       │
│         [Context Assembly + Citation Tracking]              │
│                     │                                       │
│                     ▼                                       │
│          [LLM Generator]                                    │
│        (with "cite only retrieved" constraint)              │
│                     │                                       │
│                     ▼                                       │
│         [Faithfulness Checker]                              │
│          (cross-reference every claim ↔ source)            │
│                     │                                       │
│                     ▼                                       │
│              [Response + Citations]                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Thách thức còn lại & Hướng nghiên cứu tương lai

| Thách thức | Chi tiết |
|---|---|
| **Hallucination không thể loại bỏ hoàn toàn** | Stanford đã chứng minh — cần human review cho high-stakes use case |
| **Chunking strategy** | Làm thế nào chia tài liệu pháp lý (có cấu trúc phức tạp: điều, khoản, mục) thành chunk mà vẫn giữ ngữ cảnh? |
| **Cross-jurisdiction reasoning** | Hỏi về luật Việt Nam nhưng retrieval trả về luật Mỹ → cần jurisdiction-aware retrieval |
| **Temporal reasoning** | "Luật này còn hiệu lực vào ngày X?" — cần versioning + temporal metadata trong retrieval |
| **Evaluation framework** | Thiếu metric chuẩn cho legal RAG — LegalBench-RAG đang lấp khoảng trống này |
| **Cost vs Accuracy trade-off** | Query phức tạp → nhiều chunk → token nhiều → chi phí cao. Cần adaptive strategy (HyPA-RAG) |

---

## 5. Gợi ý công nghệ nếu bro muốn xây Legal RAG

| Component | Gợi ý công nghệ |
|---|---|
| **Vector DB** | Qdrant / Milvus / Weaviate / pgvector |
| **Sparse Retrieval** | Elasticsearch / OpenSearch |
| **Embedding Model** | Legal-specific: `BAAI/bge-m3`, `jurist` (fine-tuned cho pháp lý), hoặc `text-embedding-3-large` |
| **LLM** | GPT-4o / Claude 3.5 Sonnet (tốt ở reasoning) + constraint "only cite retrieved documents" |
| **Knowledge Graph** | Neo4j / Amazon Neptune |
| **Reranker** | Cohere Rerank / BGE Reranker / Cross-encoder |
| **Citation Tracking** | Tự xây: map mỗi câu trong output về chunk gốc qua attention weights hoặc self-check mechanism |
| **Evaluation** | LegalBench-RAG + RAGAS framework |

---

**Tóm lại**: RAG trong pháp lý là **hứa hẹn nhưng không phải "set and forget"**. Điều khác biệt so với RAG thông thường là:
1. **Độ chính xác yêu cầu cao hơn nhiều** — sai một điều khoản = rủi ro pháp lý
2. **Cần trích dẫn xác thực** — không chỉ "đúng" mà còn "chứng minh được từ đâu"
3. **Kiến thức thay đổi liên tục** — cần update corpus thường xuyên
4. **Multi-hop reasoning** — cần Knowledge Graph bổ trợ

Bro muốn Linda đi sâu vào phần nào không? Ví dụ: cách chunk tài liệu pháp lý, cách build Knowledge Graph cho luật, hay benchmark cụ thể? 🫡