/**
 * Pure constants — no config, no client, no DI. index-admin.service.ts
 * combines these with runtime shard/replica counts (opensearch.config.ts)
 * to build the actual `PUT /<index>` request body.
 *
 * Converts docs/schema/database-design.md §3b's field mapping to real JSON,
 * with two corrections verified against the live cluster and shipped schema
 * (see docs/plan/opensearch-projector-plan.md "Index definition"):
 *   - content_version is `keyword`, not `long` — document.contentVersion is a
 *     SHA-256 hex string (document.schema.ts), not a number.
 *   - number_of_replicas is a runtime setting (opensearch.config.ts), not
 *     baked in here — a single-node cluster needs 0, not §3b's unstated default.
 */

/**
 * `vi_analyzer`/`vi_folded` from Phase 1 (docker/opensearch/Dockerfile
 * installs analysis-icu). Known limitation, recorded here rather than
 * re-discovered later: `standard` splits Vietnamese per *syllable* ("quy
 * phạm pháp luật" is 4 tokens, not 1 term) — precision-only impact on
 * multi-syllable legal terminology, recall is unaffected, `match_phrase`
 * stays available. See docs/infrastructure/opensearch-vietnamese-analysis.md
 * for the full analysis and a synonym-filter sketch that's a candidate
 * follow-up but not implemented.
 */
export const LEGAL_PROVISIONS_ANALYSIS_SETTINGS = {
  char_filter: {
    icu_normalizer_cf: { type: 'icu_normalizer' },
  },
  filter: {
    icu_folding_filter: { type: 'icu_folding' },
  },
  analyzer: {
    vi_analyzer: {
      type: 'custom',
      tokenizer: 'standard',
      filter: ['lowercase'],
    },
    vi_folded: {
      type: 'custom',
      tokenizer: 'standard',
      char_filter: ['icu_normalizer_cf'],
      filter: ['lowercase', 'icu_folding_filter'],
    },
  },
} as const;

/**
 * The largest phụ lục measured at 993,902 chars (plan's "Measured starting
 * point"), just under Lucene's 1,000,000 default — left at that default,
 * highlighting would silently stop working on exactly the documents that
 * need it most.
 */
export const LEGAL_PROVISIONS_MAX_ANALYZED_OFFSET = 2_000_000;

export const LEGAL_PROVISIONS_MAPPINGS = {
  properties: {
    document_id: { type: 'keyword' },
    citation_id: { type: 'keyword' },
    // Raw Vietnamese text from vbpl.vn's "Loại văn bản" (e.g. "Nghị định"),
    // not a tier slug — document.schema.ts's own documentType column comment.
    document_type: { type: 'keyword' },
    issuing_body_id: { type: 'keyword' },
    authority_rank: { type: 'short' },

    // This index only ever holds these two top-level node_types (§3a) —
    // khoan/diem are folded in, phan/chuong/muc/tieu_muc are never emitted.
    node_type: { type: 'keyword' },
    path: { type: 'keyword' },
    label: { type: 'keyword' },
    heading: {
      type: 'text',
      analyzer: 'vi_analyzer',
      fields: { folded: { type: 'text', analyzer: 'vi_folded' } },
    },
    // Điều's own text + every khoan[].text — heading is deliberately
    // excluded (separately boosted in the query shape; folding it in here
    // would double-count it in BM25).
    body: {
      type: 'text',
      analyzer: 'vi_analyzer',
      term_vector: 'with_positions_offsets',
      fields: { folded: { type: 'text', analyzer: 'vi_folded' } },
    },

    khoan: {
      type: 'nested',
      properties: {
        khoan_id: { type: 'keyword' },
        label: { type: 'keyword' },
        text: {
          type: 'text',
          analyzer: 'vi_analyzer',
          term_vector: 'with_positions_offsets',
          fields: { folded: { type: 'text', analyzer: 'vi_folded' } },
        },
        status: { type: 'keyword' },
        valid_from: { type: 'date' },
        valid_to: { type: 'date' },
      },
    },

    status: { type: 'keyword' },
    valid_from: { type: 'date' },
    valid_to: { type: 'date' },
    enacted_date: { type: 'date' },
    effective_date: { type: 'date' },

    content_hash: { type: 'keyword', index: false },
    content_version: { type: 'keyword', index: false },
  },
} as const;
