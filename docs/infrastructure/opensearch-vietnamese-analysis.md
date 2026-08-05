# OpenSearch Vietnamese analysis: support, impact, and alternatives

**Status: analysis note, not a plan.** Written after installing `analysis-icu` in [Phase 1 of the OpenSearch projector plan](../plan/opensearch-projector-plan.md) (the `analysis-icu` plugin, `vi_analyzer`/`vi_folded` analyzer definitions). Nothing in this document is implemented — §4's synonym-filter sketch is a proposal for a later increment, not code that exists in this repo. See the plan for what's actually shipped.

## 1. What OpenSearch supports for Vietnamese today

OpenSearch has no first-party Vietnamese word segmentation, and `analysis-icu` does not fill that gap.

- `analysis-icu` gives Unicode normalization, case folding, and diacritic folding (`icu_normalizer` + `icu_folding` — what `vi_folded` uses in the plan). That's real value: it's what lets a diacritic-stripped query like `phap luat` still match `pháp luật`.
- What it does **not** give is compound-word tokenization. ICU's tokenizer only performs dictionary-based segmentation for scripts that lack whitespace between words (Thai, Lao, Khmer, CJK). Vietnamese already has whitespace — just between *syllables*, not words — so both `standard` and `icu_tokenizer` fall back to splitting on whitespace/punctuation. Swapping the tokenizer name (`standard` → `icu_tokenizer`) would not fix segmentation; it's a genuine gap, not a config oversight.
- The only OpenSearch-ecosystem plugin that does real Vietnamese word segmentation is the community [`duydo/opensearch-analysis-vietnamese`](https://github.com/duydo/opensearch-analysis-vietnamese) (wraps CocCoc's C++ tokenizer). It has zero published releases against current OpenSearch and would need to be built from source — this is why the plan rejected it for v1 (see plan §"Decisions taken", item 1).

This confirms the limitation already flagged in [the plan](../plan/opensearch-projector-plan.md#phase-1--opensearch-infrastructure):

> `standard` splits Vietnamese per *syllable*, so "quy phạm pháp luật" is 4 tokens, not 1 term. Recall is unaffected; precision on multi-syllable legal terminology suffers, and IDF is computed over syllables. Positions are preserved, so `match_phrase` stays available as a later knob.

Note: [`database-design.md` §3c](../schema/database-design.md) still describes `vi_analyzer` as backed by the CocCoc plugin — that narrative predates the plan's `analysis-icu` decision and hasn't been reconciled yet. The plan's own "Files to modify" table already schedules a §3b correction in Phase 2; §3c likely needs the same treatment. Not fixed here — out of scope for an analysis note.

## 2. How much this actually affects keyword search

Vietnamese legal terminology is dense with Hán-Việt (Sino-Vietnamese) compounds — short, 2-4 syllable technical terms built from a small set of highly reused morphemes: *quy phạm pháp luật* (legal norm), *trách nhiệm hình sự* (criminal liability), *hiệu lực thi hành* (effective date/force), *thẩm quyền* (competence/authority). Syllable-level tokenization hits this domain harder than general Vietnamese text for two concrete reasons:

- **IDF corruption.** Syllables like *pháp*, *luật*, *quy*, *định*, *sự* appear across a large fraction of a legal corpus, so BM25 assigns them near-zero weight — even when they're the semantically loaded part of a compound the user searched for. A rare syllable elsewhere in the same query gets outsized influence on ranking instead.
- **Precision collapse under `multi_match`.** A syllable-level match on *"trách nhiệm hình sự"* also matches any document containing *hình* (form/image/situation) or *sự* (near-functional, appears almost everywhere) anywhere in the text, pulling in noise ahead of the actual match.

The plan's "recall is unaffected" claim is true narrowly — every syllable is indexed, so any document containing all query syllables is retrievable in principle. But that's not the same as unaffected *retrieval quality*: in a RAG pipeline with a fixed top-K cutoff, false positives from partial syllable overlap compete for ranking slots, so **effective recall@K** for the correct provision can drop even when raw recall doesn't. `match_phrase` recovers exact-sequence precision but breaks on trivial reordering (*"xử lý vi phạm hành chính"* vs. *"vi phạm hành chính bị xử lý"*) or a synonymous compound segmented differently.

## 3. Alternatives considered

| # | Option | Fixes segmentation? | New infra/deps | Effort |
|---|---|---|---|---|
| 1 | Ship as-is; lean on the planned ChromaDB semantic leg + RRF to compensate | No (sidesteps it) | None — already the target architecture | None |
| 2 | Domain-specific compound dictionary via `synonym_graph` (§4 sketch below) | Partially — only dictionary terms | None (core OpenSearch feature) | Low |
| 3 | `duydo/opensearch-analysis-vietnamese`, built from source | Yes, generally | Native C++ build, ongoing version-compat maintenance | High |
| 4 | External pre-segmentation (pyvi / underthesea / VnCoreNLP) before indexing | Yes, generally | Python NLP service, consistent index+query preprocessing | Medium-high |
| 5 | Shingle bigrams as a precision compensator | No (heuristic only) | None (core OpenSearch feature) | Low |

Option 1 already reflects the project's own stated long-term architecture (hybrid BM25 + semantic + graph, fused via RRF) — embedding models don't care about syllable boundaries, so the semantic leg is likely to absorb a good share of this weakness once ChromaDB exists. Option 3 is correctly out of scope for v1 per the plan's own reasoning: a solo/small team maintaining a native plugin build against every future OpenSearch upgrade is a real ongoing cost, not a one-time one. Option 4 gets the best segmentation quality but adds a whole new service to the stack and requires that service to be called identically on every index *and* query path — a real coupling cost for a project that doesn't have one yet.

Option 2 is the best-leverage incremental step if BM25-only precision turns out to matter before the semantic leg lands: legal terminology is a comparatively closed vocabulary (unlike general Vietnamese prose), so a curated dictionary covers a meaningful share of the compounds that actually show up in this corpus, using only a core OpenSearch feature already available after Phase 1's plugin install.

## 4. Sketch: domain synonym filter for the current analyzers

**Not implemented — illustrative only.** This shows how a `synonym_graph` filter would slot into the `vi_analyzer`/`vi_folded` pair from the plan without displacing anything already decided (no new plugin, same analyzer names, same alias/reindex machinery in plan §"Phase 2" / database-design.md §3e-3f).

### Mechanism

Use the **equivalence-set** form of the synonym filter (comma-separated, no `=>`), not the one-directional mapping form. An equivalence set indexes *every* term in the set at the same token position, so the original syllables are preserved (unigram queries on *pháp* or *luật* alone still match) **and** a joined compound token is added at that span (so the compound gets its own accurate document frequency / IDF):

```text
quy phạm pháp luật, quy_phạm_pháp_luật
```

`synonym_graph` (not the plain `synonym` filter) is required here because the rule maps a 4-token span to a 1-token span — `synonym_graph` correctly encodes that as a graph with proper position increments, which is what keeps `match_phrase`/highlighting sane downstream. The plain `synonym` filter mishandles differing-length multi-word rules.

### Analyzer settings

```json
PUT /legal_provisions_v2
{
  "settings": {
    "index": {
      "number_of_shards": 1,
      "number_of_replicas": 0
    },
    "analysis": {
      "char_filter": {
        "icu_normalizer_cf": { "type": "icu_normalizer" }
      },
      "filter": {
        "icu_folding_filter": { "type": "icu_folding" },
        "vi_legal_synonyms": {
          "type": "synonym_graph",
          "synonyms_path": "analysis/legal_synonyms_vi.txt",
          "updateable": false
        },
        "vi_legal_synonyms_folded": {
          "type": "synonym_graph",
          "synonyms_path": "analysis/legal_synonyms_vi_folded.txt",
          "updateable": false
        }
      },
      "analyzer": {
        "vi_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "vi_legal_synonyms"]
        },
        "vi_folded": {
          "type": "custom",
          "tokenizer": "standard",
          "char_filter": ["icu_normalizer_cf"],
          "filter": ["lowercase", "icu_folding_filter", "vi_legal_synonyms_folded"]
        }
      }
    }
  }
}
```

Two separate synonym files are needed, not one shared file: by the time the synonym filter runs in `vi_folded`, `icu_folding` has already stripped diacritics from the token stream, so that file's rules must be written in diacritic-free form. Generate `legal_synonyms_vi_folded.txt` from `legal_synonyms_vi.txt` mechanically (run each line through the same folding step used at index time) rather than hand-maintaining two dictionaries that can drift apart.

### Synonym file (`legal_synonyms_vi.txt`)

```text
# Equivalence sets: original syllables are kept AND a joined compound token
# is added at the same position — unigram queries and compound-aware
# queries both keep working.
quy phạm pháp luật, quy_phạm_pháp_luật
văn bản quy phạm pháp luật, văn_bản_quy_phạm_pháp_luật
trách nhiệm hình sự, trách_nhiệm_hình_sự
hiệu lực thi hành, hiệu_lực_thi_hành
thẩm quyền, thẩm_quyền
chế tài, chế_tài
xử lý vi phạm hành chính, xử_lý_vi_phạm_hành_chính
```

### Where the dictionary would live

Phase 1 already introduced [`docker/opensearch/Dockerfile`](../../docker/opensearch/Dockerfile) as a custom image, so this is a natural extension of it rather than new infrastructure:

```dockerfile
FROM opensearchproject/opensearch:2.19.1

RUN opensearch-plugin install --batch analysis-icu

COPY analysis/legal_synonyms_vi.txt        /usr/share/opensearch/config/analysis/legal_synonyms_vi.txt
COPY analysis/legal_synonyms_vi_folded.txt /usr/share/opensearch/config/analysis/legal_synonyms_vi_folded.txt
```

with the source files versioned at `docker/opensearch/analysis/*.txt` in the repo — diffable, and reviewable the same way any other config change is.

### Where the initial term list would come from

1. **Manual seed** (~50-200 terms): core terms already named in [`vn-legal-document-structure.md`](../vn-legal-document-structure.md) and standard legal-glossary sources.
2. **Corpus-mined extension**, once Phase 2's backfill exists: frequency/collocation analysis (e.g. PMI over adjacent syllable pairs) across `document_node.heading`/text to surface recurring multi-syllable phrases beyond the manual seed.

### Caveats

- **Targeted patch, not general segmentation.** Only dictionary terms benefit; anything outside it still has the syllable-soup problem. This is option 2 from §3, not option 3/4.
- **`match`/`multi_match` need no query-side changes.** Both are graph-aware; a user query typed as raw syllables is analyzed through the same `vi_legal_synonyms` filter and will match documents indexed with the compound token, since equivalence-set synonyms are symmetric — no separate `search_analyzer` split is needed for this pattern.
- **Dictionary changes require a real reindex**, not just a live filter reload — `updateable: false` because the filter is applied at index time (to bake the compound token into postings/IDF, not just at query time). This is not new operational cost: it reuses the blue/green alias-swap path already scoped in the plan for any analyzer change.
- **Curation burden.** A hand/semi-automated dictionary needs periodic review as legal terminology usage evolves; stale entries are silent (no error, just a missed compound) rather than loud.

## 5. Recommendation

Keep the plan's `analysis-icu`-only analyzer for v1 as decided — reasonable MVP scope, and rebuilding a native plugin or standing up an external NLP service isn't justified before there's a measured precision problem to fix. Treat §4's synonym-filter sketch as the first thing to reach for if lexical-only precision turns out to matter in practice before the ChromaDB semantic leg lands — it's additive to the shipped Phase 1 image, costs no new dependency, and is scoped to exactly the domain vocabulary that matters here.
