# Improve Test Coverage for Business-Critical Services

**Goal**: Raise coverage from ~25% to 60-70% on business-critical services by adding targeted unit tests for the core algorithms and business logic. DTOs, controllers, modules, schemas, and config are explicitly out of scope.

## Current State

| Metric | Coverage |
|---|---|
| Statements | 25.1% (404/1,610) |
| Branches | 27.7% (229/827) |
| Functions | 23.2% (63/271) |
| Tests | 105 passing across 7 suites |

7 spec files exist, all testing pure functions. No service-level or repository-level tests exist.

## Testing Strategy

- **Pure standalone functions** (module-scoped helpers in repository files): Test directly via import, matching the existing pattern in `document-matcher.spec.ts`.
- **Service classes with injected dependencies**: Mock the injected services/repositories and test the service logic in isolation.
- **Repository classes with DB dependency**: Mock the Drizzle DB object. Test the standalone helper functions outside the class directly. The repository methods themselves are thin wrappers around Drizzle queries and hard to meaningfully unit-test without an integration DB — skip class-method tests, test the exported helpers instead.

## Ordered Task List

### 1. `RetrieveService` — Tree Algorithms (213 lines)

The most testable service: all recursive logic lives here, and the two repositories are injected dependencies with simple interfaces.

**Create**: `server/src/law-index/retrieve/retrieve.service.spec.ts`

Mock `DocumentRepository` and `DocumentNodeRepository`. Test:

- `search()` — delegates to repo, verify passthrough
- `retrieveNode()` with `nodeId` — exercises `findNodeById` + `enrichNodeWithFullText`
- `retrieveNode()` with `nodeType`/`number` filter — exercises `extractMatchedNodes` subtree extraction
- `retrieveNode()` with no filters — returns full tree with enriched `fullText`
- `buildTreeFromFlatNodes()` — flat rows with parent/child relationships build correct nested tree; handles orphan nodes; handles deep nesting (3+ levels)
- `enrichNodeWithFullText()` — recursive full-text computation: label + heading + text + all descendants; handles null textContent; handles null heading
- `extractMatchedNodes()` — prunes unmatched branches; preserves unmatched parents of matched children
- `findNodeById()` — finds node at root, at depth 2, returns null for missing ID

**Target**: ~25 tests, 95%+ coverage on this file.

### 2. `DocumentRepository` Standalone Functions (510 lines, ~100 lines of pure helpers)

Test the module-scoped helper functions directly (no DB needed).

**Create**: `server/src/law-index/persistence/document.repository.spec.ts`

- `nullSafeEq()` — returns `isNull` for null value, returns `eq` for non-null value (verify function behavior, not Drizzle SQL)
- `estimateAuthorityRank()` — all issuing body name variants: Quốc Hội (rank 2), UBTVQH (3), Chủ tịch nước (4), Chính phủ (5), Thủ tướng (6), Hội đồng thẩm phán (7), default ministry (8)
- `computeContentVersion()` — same input produces same hash; changing fullText changes hash; changing validityStatusRaw changes hash; null effectiveDateRaw handled
- `mapValidityStatus()` — all 7 known Vietnamese status strings map correctly; null returns null; unrecognized string throws
- `formatDateFromYYYYMMDD()` — standard date conversion; verify dd/mm/yyyy output
- `mapDbStatusToDisplay()` — all 5 DB enum values map back to Vietnamese; null status returns 'Chưa xác định'; unknown enum returns itself

**Target**: ~20 tests. Repository class methods themselves are skipped (thin DB wrappers).

### 3. `DocumentNodeRepository` Standalone Functions (211 lines, ~15 lines of pure helpers)

**Create**: `server/src/law-index/persistence/document-node.repository.spec.ts`

- `computeNodeContentHash()` — deterministic output; null heading/textContent handled; same input produces same hash
- `sanitizeOrdinalForLtree()` — strips non-alphanumeric chars; clean ordinal passes through unchanged

**Target**: ~8 tests.

### 4. `LawManifestService` (215 lines)

File I/O heavy, but mockable with `fs/promises`. Critical shared service.

**Create**: `server/src/law/utils/law-manifest.service.spec.ts`

Mock `fs/promises` and config. Test:

- `fileExists()` — returns true/false for existing/missing files
- `readManifest()` — reads JSON file; returns empty array for missing file; handles malformed JSON
- `upsertEntry()` — inserts new entry; updates existing entry by citation; handles missing manifest file
- `moveEntry()` — moves entry between tiers; handles missing entry
- `appendLogEntry()` — appends CSV row; creates file if missing
- `ensureTargetDir()` — creates directory if missing; no-op if exists

**Target**: ~15 tests.

### 5. `LawIndexService` (160 lines)

Orchestrator with good test seams — all dependencies are injected.

**Create**: `server/src/law-index/law-index.service.spec.ts`

Mock `VbplSitemapService`, `VbplClientService`, `DocumentRepository`, `DocumentNodeRepository`, and parser functions. Test:

- `syncDocument()` — happy path: fetch, parse, upsert document, upsert relations, sync nodes
- `syncDocument()` — content unchanged returns early for node sync
- `syncDocument()` — parse failure propagates error
- `syncDocumentsBatch()` — processes multiple URLs; collects per-URL errors; returns summary with success/error counts
- `syncAll()` — calls sitemap service; respects limit parameter
- `searchDocuments()` — delegates to repository

**Target**: ~15 tests.

### 6. `LawDownloadService` (417 lines)

Largest service. Mock HTTP client and manifest service.

**Create**: `server/src/law/download/law-download.service.spec.ts`

Mock `VanBanChinhPhuClientService`, `LawManifestService`, and utility functions. Test:

- `downloadFromUrl()` — happy path with classification and file download
- `downloadFromUrl()` — dryRun mode skips file persistence
- `downloadFromUrl()` — force mode re-downloads existing file
- `downloadFromUrl()` — classification failure throws
- `checkStatus()` — returns status for known citation; null for unknown
- `downloadBatch()` — processes multiple documents; collects errors
- `search()` and `downloadBySearch()` — search-driven download flow with pagination

**Target**: ~20 tests.

### 7. `LawCatalogService` (236 lines)

Mock `LawManifestService` and `fs/promises`.

**Create**: `server/src/law/catalog/law-catalog.service.spec.ts`

Test:

- `getTierOverview()` — scans tier directories; returns stats per tier
- `getTierStats()` — aggregates total files, total size
- `findDocumentGroup()` — resolves by citation; resolves by title fuzzy match; handles multi-file documents
- `getDocumentStatus()` — returns present/missing/partial status
- `existsOnDisk()` and `resolveOnDisk()` — file existence checks

**Target**: ~15 tests.

### 8. Small Utilities — Quick Wins

**Create**: `server/src/law/utils/text-normalize.util.spec.ts`

- `foldDiacritics()` — Vietnamese diacritic removal; d/Đ folding; passthrough for ASCII

**Create**: `server/src/law/catalog/http-file.util.spec.ts`

- `mimeTypeForFilename()` — common extensions: pdf, doc, docx, html, txt; unknown extension returns octet-stream
- `buildContentDisposition()` — UTF-8 filename encoding; inline vs attachment

**Target**: ~12 tests across both files.

### 9. HTTP Client Services — URL Validation (Partial Coverage)

Full HTTP testing requires integration setup. Focus on the pure URL validation functions.

**Create**: `server/src/law-index/crawl/vbpl-client.service.spec.ts`

- `assertTrustedDocumentUrl()` — accepts vbpl.vn URLs; rejects non-trusted hosts; rejects disallowed paths

**Create**: `server/src/law/download/vanban-chinh-phu-client.service.spec.ts`

- `assertTrustedPageUrl()` and `assertTrustedFileUrl()` — accepts trusted hosts; rejects arbitrary URLs

**Target**: ~10 tests across both files, partial coverage on these services.

### 10. `VbplSitemapService` — `parseLocs` (Partial Coverage)

**Create**: `server/src/law-index/crawl/vbpl-sitemap.service.spec.ts`

- `parseLocs()` — extract `<loc>` elements from XML; handles empty sitemap; handles malformed XML

**Target**: ~5 tests.

## Expected Outcome

| Area | Files Added | Est. Tests | Est. Coverage Impact |
|---|---|---|---|
| RetrieveService | 1 | ~25 | +4% |
| DocumentRepository helpers | 1 | ~20 | +3% |
| DocumentNodeRepository helpers | 1 | ~8 | +1% |
| LawManifestService | 1 | ~15 | +3% |
| LawIndexService | 1 | ~15 | +2% |
| LawDownloadService | 1 | ~20 | +4% |
| LawCatalogService | 1 | ~15 | +3% |
| Small utilities | 2 | ~12 | +2% |
| HTTP client URL validation | 2 | ~10 | +1% |
| SitemapService parseLocs | 1 | ~5 | +0.5% |
| **Total** | **11** | **~150** | **+23% → ~48% overall** |

The weighted coverage will be higher (~60-70%) on the prioritized business-critical files themselves, even if overall project coverage lands around 48%.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Drizzle DB mock is complex | Skip repository class methods; only test module-scoped pure functions |
| File I/O tests are flaky | Use `jest.mock('fs/promises')` consistently; no real filesystem access |
| Parser imports in repository helpers | Mock `vbpl.parser` exports when testing `DocumentRepository` helpers |
| NestJS dependency injection overhead | Use plain Jest imports for standalone functions; only use constructor injection pattern for service tests |

## Out of Scope

- Controllers (thin delegation, covered implicitly by service tests)
- DTOs (decorator-driven validation, tested by NestJS at runtime)
- Module files (no logic)
- Schema files (declarative)
- Config files (environment-dependent)
- E2E/integration tests with real database