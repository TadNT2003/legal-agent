# Research: legal AI retrieval architectures

**Status: research notes; one finding has since been acted on.** Nothing here is a commitment to build, with a single exception: the capture gap identified in §7b (`document.expiry_date`) was implemented — migration 0005, plus a `force` flag on the PUT endpoints to backfill it. Everything else remains analysis. This document records how other legal-AI systems (commercial, government, and academic) actually build retrieval, what the peer-reviewed literature says works, and how both compare to the architecture already designed in [../../README.md](../../README.md) and [../database-design.md](../database-design.md). Where it makes a recommendation, that recommendation is explicitly marked as such and is *not* a change to any existing design decision.

> **Bản tiếng Việt:** [legal-ai-retrieval-landscape.vi.md](legal-ai-retrieval-landscape.vi.md). This English version is canonical — prefer it where the two diverge. Section (§) numbering is 1:1 across both.

Written to answer four questions that came up while planning the retrieval layer:

1. How does the rest of the field build legal RAG, and where does this project sit relative to it?
2. What does a graph database actually add on top of hybrid (BM25 + semantic) retrieval fused with RRF?
3. Should Neo4j mirror the `document_node` structural hierarchy (Chương → Điều), or only the citation/amendment graph?
4. What is the "conceptual hierarchy" layer the GraphRAG literature keeps referring to, and how would it attach to a conventional hybrid pipeline?

**Method and evidence caveats.** Sources are engineering blogs, vendor documentation, peer-reviewed papers, and arXiv preprints, gathered via web research. Three honest limitations to carry into any decision made from this:

- **Vendor claims are mostly unverifiable.** Most commercial systems publish marketing, not architecture. Claims are flagged below as *verifiable engineering detail* vs. *unconfirmed*.
- **Several key papers are 2025–2026 preprints** with limited or qualitative evaluation. The integration *patterns* they describe are well-argued; the evidence that each specific pattern improves retrieval quality is thinner than one would want. Flagged per-item in §2 and §6.
- **This is architecture-by-argument, not architecture-by-benchmark**, except for the hybrid+RRF core (§2a), which does have real comparative numbers in-domain.

---

## 1. How other systems are built

### 1a. Commercial legal AI vendors

| System         | Retrieval approach                                   | Verifiability                                           |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Harvey AI      | Hybrid sparse+dense, agentic adaptive depth          | High — own engineering blog                            |
| Lexis+ AI      | Hybrid + 5-checkpoint pipeline w/ citator validation | Medium — published pipeline, no internals              |
| vLex / Vincent | RAG + citation-graph traversal, separate citator     | Medium — support docs                                  |
| CoCounsel      | RAG over curated Westlaw/Practical Law corpus        | Low — marketing only                                   |
| Robin AI       | Hybrid, metadata-augmented chunks                    | High — published evaluation                            |
| Legora         | Multi-agent + RAG on Azure OpenAI                    | Low — product narrative                                |
| Spellbook      | Fine-tuned GPT-4o + prompting, no disclosed RAG      | Low                                                     |
| DoNotPay       | Templated conversation trees + LLM generation        | None — treat as unverified                             |
| Genie AI       | Claims "semantic graph" + "Eidetic Intelligence"     | **None — marketing terminology, no methodology** |

**Harvey AI** is the most technically transparent. Retrieval is explicitly hybrid, with the stated reason that "purely dense embeddings might struggle with rare terms such as case identifiers and named entities" — the same argument this project uses for keeping OpenSearch alongside a vector store. Production vector stores are LanceDB Enterprise and Postgres+pgvector. Harvey partnered with Voyage AI to fine-tune `voyage-law-2-harvey` on 20B+ tokens of case law (self-supervised on raw case law plus supervised on expert-annotated query/content pairs), evaluated on NDCG@10 and Recall@100, claiming ~25% fewer irrelevant top results at one-third the embedding dimensionality of general-purpose models. Orchestration is a 5-stage ReAct-style loop (plan → tool-select/retrieve → reason/synthesize → completeness-check → cite) with **retrieval depth scaled to query complexity** (3–10 tool calls). Chunking strategy is never disclosed across three separate blog posts, though metadata-augmented chunks are described.

**Lexis+ AI** publishes the most concrete pipeline description among the majors: (1) joint lexical+semantic search, (2) recency-boost reranking, (3) authority ranking via Shepard's Signal indicators, (4) authoritative-court elevation, (5) **citation validation against Shepard's before a citation is surfaced**. Step 5 is the notable one — validity checking is a distinct post-retrieval stage backed by a separate citator product, not something the retrieval ranking is expected to handle.

**vLex / Vincent** is the closest commercial analogue to a graph-augmented approach: "up-the-tree and down-the-tree" citation analysis (what a case cites, what cites it) as part of answer grounding. Validity is handled by a separate citator (vCite, successor to Casetext's SmartCite) plus "Cert" for negative-treatment detection. Again: **citator as a separate subsystem, not fused into retrieval ranking.**

**Robin AI** published the only real chunking/embedding evaluation found from any vendor. Tested ~12 embedding models (OpenAI, Cohere, Voyage, Amazon, Qwen2, ME5, Snowflake); Voyage 3 Large won on multilingual quality with flexible dimensionality down to 256. Key finding: augmenting chunks with **clause-label metadata and cross-clause summaries** rather than raw text improved retrieval accuracy by up to 6%, and let the system reach >90% recall using only ~15% of a contract's full text — an 85% token reduction versus full-document stuffing, matching or beating full-context generation quality. Evaluated via Recall@k / Recall@p.

**Unconfirmed / flagged.** Genie AI's "Eidetic Intelligence," "semantic graph," and self-reported 90%-vs-79.3%-vs-37.3% accuracy benchmark have no published methodology or independent verification — treat entirely as marketing. DoNotPay's technical and efficacy claims are unverified and the company has faced regulatory action over "robot lawyer" claims. No verifiable technical detail was found for "iCourt" as a distinct system, nor for a distinct Alibaba legal-assistant product beyond DAMO Academy's general-purpose SeaLLM series.

### 1b. Chinese legal LLM systems

**ChatLaw** (PKU, [arXiv:2306.16092](https://arxiv.org/abs/2306.16092)) is the clearest published KG + multi-agent design found anywhere in this survey — a genuinely different paradigm from Western hybrid-RAG. It uses a **Role-Aligned Mixture-of-Experts (RA-MoE)** system mimicking law-firm roles (assistant / researcher / senior lawyer), each mapped to a dedicated MoE expert, plus knowledge-graph integration specifically to reduce hallucination from bare parametric memory. Reported to beat GPT-4 on LawBench-style metrics: memorization 43.86 vs 35.29, understanding 62.11 vs 54.41, application 61.60 vs 54.05; +11 points on a legal professional exam.

**LawGPT** ([arXiv:2406.04614](https://arxiv.org/abs/2406.04614)) takes the opposite approach — domain adaptation instead of retrieval: legal-oriented continued pretraining plus legal supervised fine-tuning on LLaMA-7B. No retrieval, KG, or citation-validation layer. Framed as resolving the "open models lack legal knowledge / proprietary models risk data privacy" tension.

**China's national judicial infrastructure** (the "Faxin" database, the Supreme People's Court's big-data platform) is built on ~320M pieces of legal/case data using big-data and knowledge-graph techniques for similar-case recommendation. Technical disclosure is aggregate and state-media-framed; no pipeline-level detail is publicly available.

### 1c. Government / national legal-information systems

These solve *versioning* far more rigorously than any AI vendor, and are the most directly relevant prior art for this project's validity model.

**EUR-Lex (EU)** — not an AI system, but the reference architecture for citation graphs plus versioning. Uses CELEX identifiers and the **ELI (European Legislation Identifier)** URI scheme (`/eli/{type}/{year}/{number}/{start-date}`) for point-in-time addressing. **Consolidated texts** merge an initial act with all subsequent amendments into a single as-currently-in-force document, explicitly marked non-authoritative — the authoritative source remains the original act plus its amendment chain. Relationships (`cdm:work_related_to`, `cdm:consolidated_by`) are modeled as structured metadata in the CELLAR repository, making amendment lineage queryable. **Validity is an explicit graph relationship plus a derived consolidation view, never inferred.**

**legislation.gov.uk (UK, The National Archives)** — arguably more granular than EUR-Lex. RESTful API with addressing down to section/schedule level, and true **point-in-time versioning**: any provision can be requested as it stood on an arbitrary historical date, with a separate "effects/changes" list tracking each amendment event applied over time. Versioning is modeled as **a sequence of discrete amendment events**, not periodic full-document snapshots. This is the closest external analogue to what [../database-design.md](../database-design.md) §1a describes with `valid_from`/`valid_to`/`superseded_by_node_id` per `document_node`.

**Singapore — LawNet 4.0 / GPT-Legal Q&A** (Singapore Academy of Law with IMDA) — LLM + RAG over a closed corpus of judgments, law reports, legislation. Notable disclosed design choice: the model is "designed to cite only trained materials and to **decline questions outside scope**" — explicit scope-refusal as a hallucination-mitigation strategy, rather than relying purely on retrieval grounding.

**India — SUPACE / e-Courts** — SUPACE is judge-facing and explicitly **assistive, not generative**: a 4-stage pipeline (file indexing → conversational extraction → classification into synopsis/chronology/evidence/cited-cases → judge notebook) that surfaces existing case material rather than synthesizing new text, sidestepping most hallucination risk by design. Separately, several academic Indian legal-RAG systems publish real architectural detail — notably a domain-partitioned hybrid RAG ([arXiv:2602.23371](https://arxiv.org/pdf/2602.23371)) that partitions the corpus by legal domain before retrieval, combines lexical+semantic search, and layers a knowledge graph over statutes/cases/concepts.

### 1d. Cross-cutting patterns

Six patterns hold across effectively every system with verifiable detail:

1. **Hybrid lexical+semantic over a closed, curated corpus is the industry default.** Not vector-only RAG, and not fine-tuning as a substitute for retrieval. Fine-tuning (Harvey's custom embeddings, Spellbook, LawGPT) is used to improve quality *within* a RAG pipeline, rarely to replace it.
2. **Chunking is the most consistently undisclosed detail.** The one vendor that published (Robin AI) found metadata/structure augmentation matters more than chunk size or overlap.
3. **Validity tracking is a separate subsystem, not a retrieval-ranking concern.** Shepard's, vCite/Cert, SmartCite — universally a citator layered on top, mirroring the separation this project already has between `document.status`/`document_node.status` and search relevance.
4. **Citation-graph traversal is claimed widely but implemented narrowly.** Only vLex/Vincent publishes an actual traversal mechanism; most vendors treat "citation" as a search-result pointer, not a graph edge.
5. **Government systems beat AI vendors on versioning rigor.** Explicit amendment-event graphs and point-in-time addressing versus inferred or absent consolidation.
6. **Agentic orchestration is the 2025–2026 trend** — dynamic multi-step retrieval with effort scaled to query complexity (Harvey, Legora, ChatLaw), replacing single-shot fixed pipelines.

And one finding that contradicts the marketing across the board: **every published third-party evaluation shows RAG-grounded legal tools still hallucinate materially** (§2e).

---

## 2. Academic literature

### 2a. Hybrid retrieval and fusion

**"Segment First, Retrieve Better"** (Nigam, Dubey, Shallum, Bhattacharya, [arXiv:2508.00679](https://arxiv.org/pdf/2508.00679)) is the most directly on-point validation of this project's retrieval core. On Indian Kanoon case law it combines BM25 + dense + **Reciprocal Rank Fusion**, and additionally segments documents by rhetorical role (facts / holding / dissent) before retrieval. Hybrid+RRF beats either single method on precision, recall, and nDCG; rhetorical segmentation adds a further gain on top of fusion.

**Caveat on RRF specifically:** generic hybrid-retrieval studies find a *tuned linear-α* combination of BM25 and dense scores can beat RRF by roughly 0.006–0.008 nDCG@10. RRF is a strong, parameter-free default — a defensible v1 choice — but not the ceiling. Worth revisiting only once there is real query traffic to tune against.

**Benchmarks worth knowing:**

- **LegalBench-RAG** (Pipitone & Houir Alami, [arXiv:2408.10343](https://arxiv.org/abs/2408.10343)) — first benchmark isolating the *retrieval* step of legal RAG rather than end-to-end generation. 6,858 expert-annotated query-answer pairs over a 79M-character corpus. Core thesis: retrieval should return **minimal precise spans**, not whole documents or oversized chunks.
- **LexRAG** ([arXiv:2502.20640](https://arxiv.org/abs/2502.20640)) — first benchmark for **multi-turn** legal consultation RAG: 1,013 dialogues over 17,228 candidate articles. Finds existing RAG systems degrade markedly across conversation turns.
- **LegalBench** ([arXiv:2308.11462](https://arxiv.org/abs/2308.11462)) — 162 hand-crafted tasks across 6 legal-reasoning types, built with practicing lawyers.
- **LexGLUE** (Chalkidis et al., ACL 2022, [arXiv:2110.00976](https://arxiv.org/abs/2110.00976)) — standardized legal-NLU benchmark; legal-pretrained models consistently beat generic LMs.

### 2b. Structure-aware chunking

The most consistent finding in the entire literature review. **Fixed-size token windows are actively harmful for statutes** — they retrieve "things mentioning the query" rather than "the passage that answers it."

- **"Towards Reliable Retrieval in RAG Systems for Large Legal Datasets"** (Reuter et al., [arXiv:2510.06999](https://arxiv.org/abs/2510.06999)) runs chunking ablations for large legal corpora and confirms fragmentation-boundary choice materially changes retrieval accuracy.
- **LawRAG** (Indonesian legal RAG, *Data Technologies and Applications*) pairs article/paragraph-aware chunking with reranking.
- Convergent recommended pattern across this cluster: chunk aligned to Article/Section boundaries, recursive splitting on legal-structure separators, and **parent-document retrieval** (index small child chunks, return the enclosing section).

This maps almost exactly onto the rollup already specified in [../database-design.md](../database-design.md) §4 (chunk at Khoản, Điểm folded in, ancestor headings prefixed) and §3a (OpenSearch rolls up to Điều with Khoản nested).

### 2c. Graph-augmented legal RAG

Active but immature research — mostly 2025–2026, largely India/China-focused, with no large-scale production validation yet.

- **LegalGraphRAG** ([arXiv:2605.28120](https://arxiv.org/abs/2605.28120), ACL 2026) — builds a hierarchical legal graph in three layers (detailed in §5a) and runs a 3-agent pipeline: **Researcher** retrieves → **Auditor** verifies each claim against source text → **Adjudicator** synthesizes. Stated motivation: "a flat knowledge graph cannot adequately differentiate between factual details, applied rules, and abstract principles, limiting accurate retrieval."
- **"Bridging Legal Knowledge and AI"** (Barron et al., [arXiv:2502.20364](https://arxiv.org/abs/2502.20364)) — vector store plus a KG built via hierarchical Non-negative Matrix Factorization for topic/relationship discovery, instead of a hand-authored ontology. Positions the graph layer specifically as a hallucination-reduction mechanism.
- **Domain-partitioned hybrid RAG / KG-LegalRAG / LexGraph** ([arXiv:2602.23371](https://arxiv.org/pdf/2602.23371)) and **Falkor-IRAC** ([arXiv:2605.14665](https://arxiv.org/abs/2605.14665)) — model statutes/judgments/citations as graph nodes to reduce "retrieval drift" versus flat vector search.

**The trend that matters for this project:** the field has moved past flat `CITES` edges toward multi-layer graphs, precisely because a coarse edge type cannot capture *what* a citation asserts or *whether it still holds*. That is the same reasoning that drove this project's own deviation from the DBML's original 8-value `reference_type` enum to the shipped 10-value one (see [../plan/law-index-plan.md](../plan/law-index-plan.md) Context section).

### 2d. Temporal validity and law versioning

The literature's most emphatic conclusion, and the area where this project's remaining work sits.

- **de Martim, "A Temporal FRBR/FRBRoo-Based Model for Component-Level Versioning of Legal Norms"** ([arXiv:2506.07853](https://arxiv.org/abs/2506.07853)) — uses the LRMoo ontology: each amendment produces a new language-agnostic Temporal Version at Work level, with monolingual Language Versions at Expression level, enabling exact reconstruction of any part of a legal text as of any date. Demonstrated on the Brazilian Constitution.
- **de Martim, "Beyond Probabilistic Similarity"** ([arXiv:2606.09724](https://arxiv.org/abs/2606.09724)) — argues embedding-similarity retrieval **structurally cannot** represent legal hierarchy, cannot do diachronic reasoning, and cannot represent causal condition→consequence chains. Without explicit temporal metadata, RAG conflates current and superseded provisions.
- **Prior, Schultz, Grabmair, "Asking For An Old Friend"** (ICAIL 2026, [arXiv:2605.23497](https://arxiv.org/abs/2605.23497)) — empirically measures accuracy degradation when models answer questions about outdated versus current statutes.
- **Legal-GraphRetriever** (Springer) — reranks hybrid-retrieval candidates using a citation graph plus temporal refinement, specifically to distinguish active from superseded regulations. The single most on-point paper for wiring validity into an existing hybrid pipeline.

**Consistent conclusion:** temporal validity must be enforced as a **hard constraint** — fact-date extraction plus version filtering applied *before* ranking — and substantially outperforms leaving it to semantic similarity.

### 2e. Hallucination and citation verification

- **Dahl, Magesh, Suzgun, Ho, "Large Legal Fictions"** ([arXiv:2401.01301](https://arxiv.org/abs/2401.01301), *Journal of Legal Analysis* 2024) — on verifiable questions about random federal cases, hallucination rates of **58% (GPT-4), 69% (GPT-3.5), 88% (Llama 2)**. Models cannot reliably self-detect hallucinations and show "contra-factual bias" — failing to correct a user's false legal premise.
- **Magesh et al., "Hallucination-Free? Assessing the Reliability of Leading AI Legal Research Tools"** ([arXiv:2405.20362](https://arxiv.org/abs/2405.20362), *Journal of Empirical Legal Studies* 22:216–242, 2025) — the key study. First preregistered evaluation of production RAG-based legal tools: **Lexis+ AI, Westlaw AI-Assisted Research, and Ask Practical Law AI each hallucinate 17–33% of the time.** Lexis+ AI ~65% fully accurate versus Westlaw AI-AR ~18% on the same query set. **Sycophancy** — fabricating supporting authority for a user's incorrect premise rather than correcting it — is flagged as a distinct recurring failure mode.
- **"Citation Grounding: Detecting and Reducing LLM Citation Hallucinations via Legal Citation Graphs"** ([arXiv:2606.00898](https://arxiv.org/abs/2606.00898)) — uses a citation graph to verify that generated citations actually exist and support the cited proposition, rather than trusting model confidence.

**Takeaway:** RAG measurably reduces but does not eliminate hallucination. Citation verification as an explicit post-generation stage is standard practice, not a nice-to-have.

### 2f. Vietnamese legal NLP

A real and reasonably active literature — worth mining before selecting an embedding model.

- **ALQAC** (Automated Legal Question Answering Competition, [alqac.github.io](https://alqac.github.io/)) — running since 2021 on Vietnamese statute law. Tasks: legal document retrieval, textual entailment, QA. Best reported 2024 results: ~87% F2 on retrieval, ~98% accuracy on QA. ALQAC 2026 pivots to agentic legal-case-outcome prediction with tool/API use.
- **VLQA** ([arXiv:2507.19995](https://arxiv.org/abs/2507.19995), JAIST / VNU Hanoi / NII Tokyo) — 3,129 expert-annotated QA triplets over 59,636 articles across 27 legal domains, built from 2,162 documents and 430K raw citizen-forum questions. Retrieval: BGE-m3 R@2=0.544/P@2=0.322; **fine-tuned mBERT R@2=0.626/P@2=0.374**. QA: GPT-4o-mini best (ROUGE-1 0.698, BERTScore 0.834); human evaluation found 13/100 errors for GPT-4o-mini versus 52/100 for Qwen2.5-14B.
- **Multi-stage IR for Vietnamese Legal Texts** (Pham, Nguyen, Do, [arXiv:2209.14494](https://arxiv.org/abs/2209.14494)) — BM25+ lexical stage → sentence-transformer semantic reranking, 3-round contrastive learning with progressively harder negatives, over 8,436 documents / 114,177 articles. Best system (SPhoBERT-large with word segmentation): **F2=0.741, Recall@20=0.970** — a 55% relative F2 improvement over an Attentive-CNN baseline (0.477). Note this is itself a two-stage hybrid, independently arriving at the same shape as this project's design.
- **Semi-Hard Negative Mining for Vietnamese legal retrieval** ([arXiv:2507.14619](https://arxiv.org/abs/2507.14619)) — Vietnamese-specific Bi-Encoder plus PhoRanker.
- **Synthetic data for Vietnamese legal retrieval** ([arXiv:2412.00657](https://arxiv.org/abs/2412.00657)) — 507,152 synthetic queries generated via Llama3-70B to augment retrieval fine-tuning, addressing Vietnamese's low-resource status.

**Implication for the still-open vector-store decision** ([../database-design.md](../database-design.md) §4): Vietnamese-tuned models (PhoBERT/PhoRanker-based, or a fine-tuned bi-encoder) measurably beat generic multilingual embeddings on Vietnamese legal retrieval. The existing note that the embedding model "must have genuine Vietnamese-language support, not just multilingual tokenization" is well-supported; the stronger version is that fine-tuning on Vietnamese legal pairs is where the largest gains are, and synthetic-query generation is an established way to get training data.

No Vietnam-specific COLIEE track exists — COLIEE remains Japanese/Canadian. ALQAC is the closest analogue and is explicitly modeled on it.

### 2g. Agentic orchestration

- **"Agentic Retrieval-Augmented Generation: A Survey"** (Singh et al., [arXiv:2501.09136](https://arxiv.org/abs/2501.09136)) — taxonomizes agentic RAG by agent cardinality, control structure, autonomy, and knowledge representation. Tool-calling (agent dynamically choosing which retrieval tool to invoke) is a core pattern, positioned against static always-run-everything pipelines.
- **HyPA-RAG: A Hybrid Parameter Adaptive RAG System for AI Legal and Policy Applications** (Kalra, Wu, Gulley, Hilliard, Guan, Koshiyama, Treleaven — CustomNLP4U @ EMNLP 2024, [ACL:2024.customnlp4u-1.18](https://aclanthology.org/2024.customnlp4u-1.18/)) — the closest published system to this project's target stack: a **query complexity classifier** drives adaptive parameter tuning over a hybrid of **dense + sparse + knowledge graph** retrieval, evaluated on NYC Local Law 144. Reports improved correctness, faithfulness, and contextual precision, but states the gains qualitatively rather than publishing per-metric numbers — so treat it as a validated *design*, not a measured delta. Notable because it routes on query *complexity* (how much retrieval to spend), an axis orthogonal to SAT-Graph's routing on query *shape* (which leg leads) — see §6b.
- **"All for Law and Law for All: Adaptive RAG Pipeline for Legal Research"** (NLLP 2025, [arXiv:2508.13107](https://arxiv.org/abs/2508.13107)) — a context-aware query translator decides retrieval depth and style per query, paired with open-source SBERT/GTE embeddings; claims parity with proprietary legal RAG tools at far lower cost. The clearest evidence that adapting retrieval *strategy* per-query helps in the legal domain specifically.

**Recurring caveat worth internalizing:** naively bolting agentic tool-selection onto an off-the-shelf pipeline does **not** automatically outperform a well-tuned fixed pipeline. Gains concentrate where query heterogeneity is genuine (multi-turn consultation, mixed retrieval depth) and largely disappear without domain-specific agent and tool design. This should be validated against real query logs rather than assumed.

---

## 3. How this project compares

### 3a. Where the design already aligns with the field

| Area                   | Field consensus                                           | This project                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Retrieval              | Hybrid lexical+semantic, fused                            | OpenSearch + vector store via RRF ([../../README.md](../../README.md)) — matches, and validated in-domain by Nigam et al.                                                                  |
| Chunking               | Structure-aligned, not fixed-token                        | `document_node` at Khoản / bare-Điều granularity (§4) — **ahead of most production systems**, which don't disclose or use fixed windows                                       |
| Search-index unit      | Retrieve minimal precise spans; parent-document retrieval | Điều-level documents with Khoản nested +`inner_hits` (§3a, §3d) — precise-span citation with readable context                                                                      |
| Validity granularity   | Point-in-time, per-provision (legislation.gov.uk)         | Per-`document_node` `status`/`valid_from`/`valid_to`/`superseded_by_node_id` — **closer to legislation.gov.uk's granularity than EUR-Lex's document-level consolidation** |
| Relationship modeling  | Field moving past flat`CITES` edges                     | 10-value`reference_type` + `change_type` already encodes what the literature criticizes flat graphs for lacking                                                                        |
| Validity vs. retrieval | Separate citator subsystem                                | Validity lives in Postgres/graph, not in relevance ranking — matches Shepard's/vCite separation                                                                                           |
| Orchestration          | Agentic tool-calling (2025–26 trend)                     | Target architecture is agentic — aligned, not yet built                                                                                                                                   |

The short version: **the retrieval-fusion and chunking decisions already made are validated by both industry practice and current research**, and on chunking granularity and reference-type expressiveness this project is ahead of several commercial vendors.

### 3b. Gaps — and they are the field's hard problems, not just unfinished plumbing

1. **CDC / sync-state / reconciliation (not started).** The `content_version` + `document_sync_state` design already exists in [../../README.md](../../README.md). The literature's warning is that the harder half is not propagation but **retrieval-time enforcement**: a perfectly in-sync store will still confidently return a superseded Điều if nothing filtered on validity before ranking. Worth writing validity filtering into the retrieval-tool contract *before* the agent layer is built.
2. **No citation-verification stage planned.** Given 17–33% hallucination rates in grounded commercial tools, and [arXiv:2606.00898](https://arxiv.org/abs/2606.00898) proposing exactly this, the schema is already well-positioned: resolve every emitted `citation_id`/`node_key` back to a real `document_node` row and diff the asserted content against `text_content`.
3. **Embedding model still open.** §2f suggests defaulting away from generic multilingual embeddings toward Vietnamese-tuned or fine-tuned models.
4. **Agentic-orchestration risk.** Validate against real query logs rather than assuming agentic-by-default beats a well-tuned fixed pipeline.

---

## 4. What a graph database actually adds

### 4a. Neo4j should not be a third input to RRF

The current design does not do this — [../../README.md](../../README.md) fuses OpenSearch + the vector store only — and that is correct. Worth recording *why*, because generic GraphRAG tutorials commonly suggest otherwise:

- BM25 and embeddings both answer "**what text is relevant to this query**." RRF is a good way to combine two *relevance* signals.
- A graph answers a categorically different question — "**what is this provision's legal status and its relationship to other provisions**" — which is not a relevance score.
- Mechanically, **a graph traversal returns a set, not a ranking.** Is a provision two hops away less relevant than one hop? Sometimes; often not. RRF's premise is that each input list carries a *meaningful* rank ordering; feeding it an arbitrarily-ordered set injects noise into a fusion step that otherwise works.

None of the legal graph-RAG papers surveyed fuse graph results as a third ranked list. All use the graph as filter, expander, reranker, or verifier.

### 4b. The three roles the graph should play

Following Legal-GraphRetriever, vLex Vincent, and LegalGraphRAG:

1. **Pre-retrieval expansion.** When a query resolves to a specific citation, walk `MODIFIES`/`IMPLEMENTS` *before* running hybrid search, so the search also covers the current amended text and implementing Nghị định/Thông tư. Hybrid search alone can miss this entirely when the amending document uses different vocabulary than the original.
2. **Post-retrieval reranking and context assembly.** Per hit, a graph hop supplies what text similarity structurally cannot: is it still in force, what superseded it, and whether a higher-authority document conflicts with it (the `authority_rank` query at [../database-design.md](../database-design.md) §2b).
3. **Post-generation citation verification.** Resolve every emitted citation against a real `MATCH` — does the claimed relationship exist, is the target still valid.

Practically this argues for exposing Neo4j as **2–3 discrete agent tools** (`get_amendment_chain`, `check_still_in_force`, `verify_citation`) rather than one more thing merged into the retrieval step.

### 4c. Structural containment stays in Postgres

**Question:** should Neo4j materialize the `document_node` hierarchy — an Điều node with a `PART_OF` edge to its Chương?

**Finding: no, and the current design at [../database-design.md](../database-design.md) §2b (line ~172) is right to exclude Phần/Chương/Mục/Tiểu mục.** Reasoning:

- **Containment is a tree problem, not a graph problem.** Postgres `ltree` with GiST indexing already answers ancestor/descendant queries optimally. Mirroring it into Neo4j unlocks no new query shape and duplicates a tree Postgres holds better — violating the design principle that Postgres is the single source of structural truth.
- **It reintroduces exactly the bloat the doc already rejects for Khoản/Điểm** — a Chương node would have `PART_OF` edges in and out and never be the source or target of a `MODIFIES`/`CITES`/`IMPLEMENTS` edge, adding CDC sync burden for zero traversal benefit.
- **"Sibling Điều in the same Chương"**, if ever needed as a reranking signal, is a single indexed Postgres lookup by `path` prefix.

**One honest counter-argument**, from SAT-Graph RAG (§5d): it *does* put structural hierarchy in the graph, because it needs it for hierarchical impact analysis and temporal aggregation. The fork is **whether point-in-time reconstruction happens in the graph or in Postgres.** The current design assigns it to Postgres, which is internally consistent and fine. If that ever changes, §4c should be revisited — but it should be a deliberate decision, not drift.

---

## 5. The conceptual layer

"Conceptual hierarchy" conflates three distinct layers in the literature. They solve different failure modes and have wildly different build costs. **All three are supplementary to hybrid retrieval, not replacements for it.**

### 5a. Axis 1 — topical / abstraction hierarchy

**What LegalGraphRAG actually builds:** three layers — **chunk → concept → perspective**. Chunks connected by embedding-similarity edges; a concept layer of legal entities extracted by LLM; a perspective layer built by running **Louvain community detection** over the concept network. Retrieval descends top-down: match perspectives, refine to concepts, land on chunks, shrinking the search space at each hop.

Essentially Microsoft GraphRAG's community-summarization idea in legal clothing. What it buys is *thematic* queries that no single Điều answers — "what does Vietnamese law say about personal data generally?" — where hybrid+RRF returns a scattered handful of Điều and no synthesis.

**Finding: this project largely gets this for free.** vbpl.vn supplies `Ngành` and `Lĩnh vực` as a human-curated taxonomy, already ingested into [`document.schema.ts:48-49`](../../server/src/law-index/persistence/schema/document.schema.ts#L48-L49) as `industry`/`field`. A curated taxonomy from Bộ Tư pháp beats Louvain communities derived from LLM-extracted entities on the dimension that matters here — legal defensibility. Unsupervised community detection will happily group provisions that co-occur lexically but belong to different legal regimes. **Recommendation: treat Axis 1 as mostly solved by ingestion; reach for clustering only if `field` proves too coarse in practice.**

### 5b. Axis 2 — defined-term ontology (the one worth taking seriously)

This is the **LKIF-Core** lineage — an upper ontology of basic legal concepts (norms, acts, roles) developed in the ESTRELLA project, inspired by legal theory and deontic logic, still the reference point for aligning new legal ontologies. Generic GraphRAG needs an LLM to guess at this layer.

**Vietnamese law supplies it deterministically.** Vietnamese statutes carry a mandated *"Giải thích từ ngữ"* article (typically Điều 3) in a rigidly regular form — `Trong Luật này, các từ ngữ dưới đây được hiểu như sau: 1. {term} là {definition};`. That is plausibly regex territory rather than LLM territory.

This is precisely what `defines_term` was reserved for at [`document-reference.schema.ts:30`](../../server/src/law-index/persistence/schema/document-reference.schema.ts#L30) — currently in the shipped enum with a comment marking it for "the future LLM-based definition-extraction use case," and **with nothing populating it** (it is absent from `RELATION_LABEL_MAP` in [`vbpl.parser.ts`](../../server/src/law-index/crawl/vbpl.parser.ts), because vbpl.vn's Lược đồ tab does not expose it). **The comment may undersell it: for Vietnamese VBQPPL this looks like a deterministic parser, sitting alongside existing citation and `Căn cứ` parsing, not a separate LLM pass.** This should be verified against the already-scraped corpus before being relied on.

Two properties make this more valuable than it first appears:

- **The scoping subtlety is a feature.** "Trong Luật này" means definitions are **document-scoped by construction**. The same term may be defined differently across laws — so a global `(:Term)` node shared across documents would be *legally wrong*. The correct shape is `(:Term)-[:DEFINED_IN]->(:Document)`, which then answers a question no retrieval engine can: *"which definition of 'người lao động' governs here?"* That is a precision win, not merely recall.
- **It fixes vocabulary mismatch at its root.** Users type colloquially; statutes use terms of art. Embeddings paper over this unreliably and BM25 not at all. A definitional edge allows expanding the query to the statutory term *and* citing why.

**Distinct from `explains`,** which [`vbpl.parser.ts:132-141`](../../server/src/law-index/crawl/vbpl.parser.ts#L132-L141) already populates — that is *official legal interpretation* (giải thích pháp luật, document-level, per Điều 60 Luật 64/2025/QH15), a different relation at a different layer.

### 5c. Axis 3 — deontic / rule structure (recommendation: do not build)

The oldest strand: **LegalRuleML**, an XML markup for legal norms expressing obligations, permissions, prohibitions and exceptions with temporal and defeasible characteristics; and its 2026 descendant **Span-Grounded Deontic Trees** ([arXiv:2606.08932](https://arxiv.org/html/2606.08932)), which decomposes provisions into anchor + modality + condition tree + effects, encoding exceptions as explicit mutual exclusion (the general branch carries an `Exclusion` leaf pointing at the exception trigger; the exception branch carries it as a positive precondition).

Conceptually the deepest layer — it is the condition→consequence→exception structure de Martim argues embeddings structurally cannot represent. **The empirical results are a stop sign:**

| Metric (NormBench, 2,290 items / 9,019 branches)                  | Frontier LLMs        |
| ----------------------------------------------------------------- | -------------------- |
| Span faithfulness                                                 | 0.77–0.79           |
| NodeSpan-F1 (are the right spans recovered)                       | ~0.45                |
| **Edge-F1 (do spans attach to the correct logical parent)** | **0.21–0.24** |
| Edge-F1 at nesting depth ≥ 2                                     | **0.07**       |
| DefRec@Gold (exception triggers recovered)                        | 0.55–0.64           |
| DefRec@Gold,*legal-domain-tuned* LLMs                           | **~0.006**     |
| Cross-lingual structural isomorphism (Iso-F1)                     | < 0.40               |

The authors' summary is that models "retrieve text but fail to wire it correctly" — the *structure-grounding gap*. Two findings are especially relevant here: performance collapses on nested exceptions (Vietnamese statutes are full of nested `trừ trường hợp...` clauses), and legal-domain-tuned models drastically *underperform* general ones on structural parsing. **This axis is not ready.** Watch the literature; do not build.

### 5d. SAT-Graph RAG — the closest external analogue to this project

**"An Ontology-Driven Graph RAG for Legal Norms: A Hierarchical, Temporal, and Deterministic Approach"** (Hudson de Martim, Brazilian Federal Senate — [arXiv:2505.00039](https://arxiv.org/abs/2505.00039), [JURIX 2025](https://journals.sagepub.com/doi/10.3233/FAIA251598)) converges on this project's architecture from the other direction and is the single most relevant paper found. Its framing: "standard, flat-text retrieval is blind to the hierarchical, diachronic, and causal structure of law, leading to anachronistic and unreliable answers."

**Ontology** (LRMoo-derived):

| Node                                 | Role                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Norm (Work)**                | The abstract legal norm — e.g. the Constitution itself (LRMoo F1)                                              |
| **Component (Component Work)** | Hierarchical elements (titles, chapters, articles) that**maintain conceptual identity across amendments** |
| **Temporal Version (TV/CTV)**  | Language-agnostic snapshot of a Norm or Component at a point in time (LRMoo F2 Expression)                      |
| **Language Version (LV/CLV)**  | Concrete textual realization in a language                                                                      |
| **Action**                     | Reified legislative event                                                                                       |
| **Theme**                      | Classification                                                                                                  |

**Two ideas bear directly on decisions already made here:**

1. **Provision *identity* is split from provision *version*.** A Component Work is the stable "Điều 5 of Law X" persisting across every amendment, with Temporal Versions hanging off it. The current design at [../database-design.md](../database-design.md) §2b puts `valid_from`/`valid_to` directly on `:Provision`, conflating the two — `MERGE` on `node_key` means the node can only hold the current version, with history reconstructed indirectly from `MODIFIES` edges plus dates (as §2b acknowledges). That works, but it means "what did Điều 5 say in 2020" is permanently a Postgres query, never a graph query. **This is a genuine fork worth deciding deliberately while `:Provision` is still unbuilt — retrofitting after the Neo4j projector exists would be painful.**
2. **Legislative events are reified as first-class `Action` nodes.** Instead of an amendment being an *edge property* (`MODIFIES {change_type, effective_date}`), the amendment event is itself a node linking source provision → terminated version → created version, with a generated descriptive Text Unit making it retrievable. This makes *"what caused this change?"* directly queryable rather than inferred. Related: **temporal states are modeled as aggregations, not compositions** — when Điều 6 is amended, the new Chương-level version *reuses* the unchanged Điều 7 version rather than duplicating it, giving deterministic point-in-time reconstruction without data duplication. That is a useful answer to the duplication concern in any point-in-time design.

**Its core thesis independently validates the direction here:** deterministic graph traversal identifies exact valid versions, retrieves their text units, and assembles provenance chains as structured data; **the LLM only synthesizes from context already constrained by deterministic operations.** Evaluation is explicitly *qualitative and trace-based*, so treat the architecture as well-argued rather than benchmarked.

---

## 6. How the conceptual layer attaches to a hybrid pipeline

The papers are consistent about *where* the graph attaches, and **none of them puts it inside the RRF merge**. Hybrid+RRF stays exactly as designed; the graph wraps around it.

```text
                  ┌── (A) query-side: term expansion, citation resolution, scope
                  │
query ──► router ─┤
      (strategy   │   (B) validity constraint ──┐
       selection) │                             ▼
                  │        ┌───────────────────────────────┐
                  │        │ OpenSearch (BM25)             │
                  ├───────►│ Vector store (semantic)       │──► RRF ──► top-k
                  │        └───────────────────────────────┘            │
                  │                                                     ▼
                  └── (C) graph enrichment / rerank ◄───────────────────┘
                                        │
                                        ▼
                                   generation
                                        │
                                        ▼
                            (D) citation verification
```

### 6a. The four attachment points

**(A) Query-side — graph runs before search.** The graph rewrites or narrows the query rather than answering it. SAT-Graph's first two pipeline steps are exactly this: *canonicalization* of structural/temporal/textual constraints, then *scope resolution* over the hierarchy. Concretely: defined-term expansion (§5b), citation resolution (`Điều 5 Luật 45/2019/QH14` → `node_key`, no ranking needed), and scope narrowing via `field`/`industry`. Cost is a latency hop; payoff is precision, converting fuzzy matching into exact lookup wherever the query contains something resolvable.

**(B) Validity as a pre-ranking filter.** Arguably not "graph" at all — metadata riding along — but SAT-Graph makes it a distinct step and insists it precede retrieval, via explicit temporal policies. In this project this is already the `filter` block at [../database-design.md](../database-design.md) §3d and the vector-store payload filter at §4. The paper's added discipline: the *policy* by which a version was selected is **disclosed in the output**, so an answer states which temporal reading it used rather than silently picking one.

**(C) Post-retrieval enrichment and rerank.** The most common wiring and the least invasive — RRF's output simply becomes another stage's input. Legal-GraphRetriever reranks hybrid candidates using the citation graph plus temporal refinement to separate active from superseded regulations; vLex Vincent's up/down-tree traversal is the commercial equivalent. Also: amendment-chain pull-through (retrieved Điều 5 → follow `MODIFIES` → attach the amending document and current text to context). **Recommended starting point**, since it requires no change to the retrieval leg.

**(D) Post-generation verification.** LegalGraphRAG's Auditor agent verifies each claim against source text before the Adjudicator synthesizes; SAT-Graph assembles provenance chains into DAGs; [arXiv:2606.00898](https://arxiv.org/abs/2606.00898) does citation grounding against a citation graph. Every emitted citation resolves back to a real node; unresolvable ones are stripped or flagged.

### 6b. Strategy selection maps onto the agent layer

SAT-Graph's third pipeline step is **strategy selection — structure-first / span-first / time-first** — the cleanest available description of what the planned agentic layer should actually decide:

| Query shape                                   | Strategy        | What runs first                                               |
| --------------------------------------------- | --------------- | ------------------------------------------------------------- |
| "Điều 5 Luật 45/2019/QH14 quy định gì?" | structure-first | Graph resolves the citation; hybrid search may not run at all |
| "quy định về bảo vệ dữ liệu cá nhân" | span-first      | Hybrid+RRF leads; graph enriches after                        |
| "quy định này năm 2020 thế nào?"        | time-first      | Temporal selection narrows the corpus, then search within it  |

**A second, orthogonal axis: complexity.** HyPA-RAG (§2g) routes on *how much* retrieval a query deserves rather than *which leg leads* — simple queries get sparse retrieval and few chunks, complex ones get the full dense+sparse+KG stack with more chunks and tuned parameters. The two axes compose cleanly: **shape decides which leg leads, complexity decides how deep it goes.** That is a more concrete specification for the router than shape alone, and it has a production analogue — Harvey's "3–10 tool calls scaled to query complexity" (§1a) is the same idea. It is also the more *evaluable* of the two: complexity routing has a natural cost/accuracy trade-off to measure, whereas shape routing mostly has to be judged on answer correctness.

This reframes the agent's job usefully: not "pick which of three retrievers to call," but "**pick which leg leads**," with hybrid+RRF remaining the default workhorse for anything genuinely lexical or semantic. It also addresses the §2g caveat directly — agentic routing pays off where query heterogeneity is real, and citation-shaped vs. concept-shaped vs. time-shaped queries are exactly that.

### 6c. The tempting wrong turn

Fusing graph traversal in as a **third ranked list** alongside BM25 and dense. See §4a for why this is a poor fit: a traversal returns a set without meaningful rank ordering, and RRF needs meaningful orderings to work. Keep the graph as filter / expander / reranker / verifier.

---

## 7. Applying this to the current codebase

### 7a. What the current build stage does and does not constrain

The repo sits at one specific point: `law-index` scrapes vbpl.vn into Postgres, and nothing is projected anywhere else — no CDC, no OpenSearch/vector/Neo4j projector. That constrains far less than it looks.

**None of the techniques in §2–§6 require changing what the crawler collects.** The crawl captures raw material; everything the literature recommends is *interpretation* layered on top of it. As long as `document.rawSource.fullText`, the `document_node` tree, and `document_reference` are captured faithfully, structure-aware chunking, graph projection, defined-term extraction, and citation verification are all offline re-derivations that never touch vbpl.vn again.

| Technique | Crawl change | Schema change |
| - | - | - |
| Parent-child / structure-aware chunking (§2b) | none — `document_node` already holds the tree | none |
| Validity as a hard pre-ranking filter (§2d) | none — already parsed | **`expiry_date` — see §7b** |
| Citation verification (§6a, point D) | none | none — `document_reference` suffices |
| Complexity/shape routing (§6b) | none | none — agent layer only |
| Provision identity/version split (§5d) | none | Neo4j-side only; Postgres unaffected |
| Vietnamese-tuned embeddings (§2f) | none | none |
| Defined-term layer (§5b) | none — derivable from `document_node.textContent` | a term entity, eventually |
| Topical layer (§5a) | none — `industry`/`field` already stored | none |

The practical consequence: **the retrieval architecture can be deferred without penalty; the capture audit in §7b cannot.**

### 7b. The one class of change that is expensive to defer

Split prospective changes in two:

- **Interpretation changes are cheap.** Anything re-derivable from what is already stored — chunk boundaries, embeddings, graph edges, term definitions — can be rebuilt offline as often as needed. Getting these wrong costs compute, not access.
- **Capture changes are expensive.** A field visible on the vbpl.vn page but never persisted can only be recovered by re-scraping every affected document through a headless browser. Getting these wrong costs a crawl.

Only the second class needs deciding early, which makes it worth auditing the parser against the schema *before* any projector is built. Running that audit found exactly one instance, plus its mirror image:

**`expiry_date` — parsed but discarded** (fixed, migration 0005). vbpl.vn's "Ngày hết hiệu lực" was parsed into `ParsedVbplAttributes.expiryDateRaw` and folded into `content_version`'s hash, but had no column, so the value was dropped on every scrape. It matters specifically because of §2d: a hard validity filter needs *both* ends of the interval. `document.status` answers "in force now"; only `effective_date`/`expiry_date` answer "in force on date X" — the query the literature insists must be a pre-ranking constraint rather than something similarity is trusted to sort out.

**`gazette_published_date` — the mirror image.** A column nothing writes, because vbpl.vn renders no công báo date. Null on every row, yet read back by the retrieve endpoints as though it were data. Both halves of this audit (parsed-but-unstored, stored-but-unwritten) are worth re-running before each new projector.

Three lessons from implementing that fix generalise to every future column:

1. **`content_version` cannot see a schema change.** The hash is computed from the scraped page, not from the stored row, so adding a column never changes it — an ordinary re-scrape short-circuits as unchanged and leaves the new column NULL forever. Backfilling needs an explicit escape hatch (`force` on the PUT endpoints) that skips the short-circuit. Budget for this whenever a column is added from already-scraped data.
2. **Check `rawSource` before assuming a re-scrape is required.** It usually will be: `rawSource` holds `fullText` plus provenance, not the attributes tab, so attributes-tab fields are genuinely unrecoverable without returning to the site.
3. **Scope the backfill by legal semantics, not by row count.** Confirmed against live pages that `het_hieu_luc_mot_phan` and `ngung_hieu_luc` documents carry no expiry date at all — the first is still in force as a whole (partial expiry is `document_node`-level state), the second is a temporary suspension rather than an endpoint. Only full expiry closes the interval, which cut the backfill from the whole 3,338-row corpus to 368. A NULL that is semantically correct needs no backfill at all, and the analysis establishing which NULLs those are is worth more than the backfill machinery itself.

### 7c. Sequencing

Ranked by value-per-effort against the work already queued in [../../README.md](../../README.md)'s Sequencing section. **These are recommendations, not decisions.**

1. **CDC + sync-state + reconciliation** (already next in the README's sequence) — remains the correct next step. Add one thing the current design doesn't state: **validity filtering belongs in the retrieval-tool contract**, enforced as a hard pre-ranking filter, not deferred to similarity. This is the field's central unsolved reliability problem (§2d), not a plumbing detail. The *data* side of this has since landed (§7b) — `expiry_date` now closes the validity interval — so what remains is enforcement at query time, not capture.
2. **Decide the `:Provision` identity/version split** (§5d) — cheap now, painful after the Neo4j projector exists.
3. **Graph as post-retrieval reranker** (§6a, point C) — least invasive integration, no change to the retrieval leg.
4. **Citation verification** (§6a, point D) — high value given 17–33% hallucination rates; the schema already supports it.
5. **Vietnamese-tuned embedding model** (§2f) — decide before the ChromaDB/Qdrant projector is written.
6. **Defined-term layer / `defines_term`** (§5b) — highest value-per-effort of the conceptual axes and deterministic for Vietnamese, but still *after* validity work: a definition graph over provisions whose force is unknown is a precision trap.
7. **Topical layer** (§5a) — mostly free via `industry`/`field`; revisit only if too coarse.
8. **Deontic / rule structure** (§5c) — do not build. Watch the literature.

**The thing to resist:** treating a conceptual layer as a way to *skip* the temporal work. Every paper surveyed, SAT-Graph most explicitly, applies validity as a constraint *before* conceptual traversal runs — a richer graph does not make validity less necessary.

---

## 8. Bibliography

### Legal RAG systems and benchmarks

| Work                                                     | Link                                                |
| -------------------------------------------------------- | --------------------------------------------------- |
| LegalBench-RAG — retrieval-isolated legal RAG benchmark | [arXiv:2408.10343](https://arxiv.org/abs/2408.10343) |
| LexRAG — multi-turn legal consultation benchmark        | [arXiv:2502.20640](https://arxiv.org/abs/2502.20640) |
| LegalBench — 162 legal-reasoning tasks                  | [arXiv:2308.11462](https://arxiv.org/abs/2308.11462) |
| LexGLUE — legal NLU benchmark (ACL 2022)                | [arXiv:2110.00976](https://arxiv.org/abs/2110.00976) |
| DISC-LawLLM — Chinese legal LLM w/ syllogism prompting  | [arXiv:2309.11325](https://arxiv.org/abs/2309.11325) |
| SaulLM-7B — MIT-licensed legal LLM                      | [arXiv:2403.03883](https://arxiv.org/abs/2403.03883) |
| ChatLaw — RA-MoE multi-agent + KG                       | [arXiv:2306.16092](https://arxiv.org/abs/2306.16092) |
| LawGPT — Chinese legal domain adaptation                | [arXiv:2406.04614](https://arxiv.org/abs/2406.04614) |

### Retrieval, fusion, chunking

| Work                                                                             | Link                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------- |
| Segment First, Retrieve Better — BM25+dense+RRF, rhetorical segmentation        | [arXiv:2508.00679](https://arxiv.org/pdf/2508.00679) |
| Towards Reliable Retrieval in RAG for Large Legal Datasets — chunking ablations | [arXiv:2510.06999](https://arxiv.org/abs/2510.06999) |

### Graph-augmented legal RAG

| Work                                                                              | Link                                                                                                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **SAT-Graph RAG — ontology-driven, hierarchical, temporal, deterministic** | [arXiv:2505.00039](https://arxiv.org/abs/2505.00039) · [JURIX 2025](https://journals.sagepub.com/doi/10.3233/FAIA251598) |
| LegalGraphRAG — chunk/concept/perspective + 3-agent verification                 | [arXiv:2605.28120](https://arxiv.org/abs/2605.28120)                                                                     |
| Bridging Legal Knowledge and AI — vector store + hierarchical NMF KG             | [arXiv:2502.20364](https://arxiv.org/abs/2502.20364)                                                                     |
| Domain-Partitioned Hybrid RAG / KG-LegalRAG / LexGraph                            | [arXiv:2602.23371](https://arxiv.org/pdf/2602.23371)                                                                     |
| Falkor-IRAC                                                                       | [arXiv:2605.14665](https://arxiv.org/abs/2605.14665)                                                                     |
| LKIF-Core ontology of basic legal concepts                                        | [CEUR Vol-321](https://ceur-ws.org/Vol-321/paper3.pdf)                                                                   |
| Legal norm representation w/ explicit scope and deontic modality                  | [Springer](https://link.springer.com/chapter/10.1007/978-981-92-0071-9_20)                                               |

### Temporal validity

| Work                                                                            | Link                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------- |
| Temporal FRBR/FRBRoo model for component-level versioning                       | [arXiv:2506.07853](https://arxiv.org/abs/2506.07853) |
| Beyond Probabilistic Similarity — structural/temporal/causal limits of RAG     | [arXiv:2606.09724](https://arxiv.org/abs/2606.09724) |
| Asking For An Old Friend — temporal failure modes in statutory QA (ICAIL 2026) | [arXiv:2605.23497](https://arxiv.org/abs/2605.23497) |
| Can LLMs Time Travel? — RL for temporal consistency                            | [arXiv:2605.25920](https://arxiv.org/abs/2605.25920) |

### Hallucination and verification

| Work                                                                               | Link                                                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Large Legal Fictions — 58–88% hallucination in general LLMs**            | [arXiv:2401.01301](https://arxiv.org/abs/2401.01301)                                                                       |
| **Hallucination-Free? — 17–33% in production legal RAG tools (JELS 2025)** | [arXiv:2405.20362](https://arxiv.org/abs/2405.20362) · [JELS](https://onlinelibrary.wiley.com/doi/full/10.1111/jels.12413) |
| Citation Grounding via legal citation graphs                                       | [arXiv:2606.00898](https://arxiv.org/abs/2606.00898)                                                                       |
| Span-Grounded Deontic Trees + NormBench                                            | [arXiv:2606.08932](https://arxiv.org/html/2606.08932)                                                                      |

### Vietnamese legal NLP

| Work                                                          | Link                                                |
| ------------------------------------------------------------- | --------------------------------------------------- |
| ALQAC — Automated Legal Question Answering Competition       | [alqac.github.io](https://alqac.github.io/)          |
| VLQA — Vietnamese legal QA benchmark                         | [arXiv:2507.19995](https://arxiv.org/abs/2507.19995) |
| Multi-stage IR for Vietnamese legal texts (BM25+ → SPhoBERT) | [arXiv:2209.14494](https://arxiv.org/abs/2209.14494) |
| Semi-hard negative mining for Vietnamese legal retrieval      | [arXiv:2507.14619](https://arxiv.org/abs/2507.14619) |
| Synthetic data for Vietnamese legal retrieval                 | [arXiv:2412.00657](https://arxiv.org/abs/2412.00657) |
| Attentive deep neural networks for legal document retrieval   | [arXiv:2212.13899](https://arxiv.org/abs/2212.13899) |

### Agentic orchestration

| Work                                                          | Link                                                |
| ------------------------------------------------------------- | --------------------------------------------------- |
| Agentic RAG: A Survey                                         | [arXiv:2501.09136](https://arxiv.org/abs/2501.09136) |
| All for Law and Law for All — adaptive legal RAG (NLLP 2025) | [arXiv:2508.13107](https://arxiv.org/abs/2508.13107) |
| **HyPA-RAG — query-complexity-adaptive hybrid (dense+sparse+KG), CustomNLP4U 2024** | [ACL:2024.customnlp4u-1.18](https://aclanthology.org/2024.customnlp4u-1.18/) |

### Commercial and government systems

| Source                                                 | Link                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harvey — enterprise RAG                               | [harvey.ai/blog](https://www.harvey.ai/blog/enterprise-grade-rag-systems)                                                                                |
| Harvey — agentic search                               | [harvey.ai/blog](https://www.harvey.ai/blog/how-agentic-search-unlocks-legal-research-intelligence)                                                      |
| Harvey — BigLaw Bench retrieval                       | [harvey.ai/blog](https://www.harvey.ai/blog/biglaw-bench-retrieval)                                                                                      |
| Voyage AI — custom legal embeddings for Harvey        | [blog.voyageai.com](https://blog.voyageai.com/2024/07/31/harvey-partners-with-voyage-to-build-custom-legal-embeddings/)                                  |
| Robin AI — RAG chunking/embedding evaluation          | [robinai.com](https://robinai.com/news-and-resources/blog/optimizing-rag-for-contract-analysis-our-research-findings-2)                                  |
| LexisNexis — linked legal citations pipeline          | [lexisnexis.com](https://www.lexisnexis.com/blogs/au/b/insights/posts/hallucination-free-linked-legal-citations)                                         |
| vLex Vincent — models and case analysis               | [support.vlex.com](https://support.vlex.com/vincent-by-vlex/vincent/security-privacy-and-compliance/understanding-the-ai-models-used-by-vincent)         |
| EUR-Lex — consolidated texts                          | [eur-lex.europa.eu](https://eur-lex.europa.eu/collection/eu-law/consleg.html)                                                                            |
| legislation.gov.uk — API and point-in-time versioning | [legislation.github.io](https://legislation.github.io/data-documentation/api/overview.html)                                                              |
| Singapore LawNet 4.0 / GPT-Legal Q&A                   | [govinsider.asia](https://govinsider.asia/intl-en/article/singapore-trials-agentic-ai-for-corporate-compliance-launches-genai-search-engine-for-lawyers) |
