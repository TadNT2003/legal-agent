# Plan A: Extend Test Coverage — Services & Parsers

**Branch:** `test/service-unit-test`
**Goal:** Increase service and parser test coverage from 46% overall toward 70%+ by targeting the low-coverage gaps.

---

## Current State

| Area | Statements | Functions | Lines |
|------|-----------|-----------|-------|
| `vbpl-client.service.ts` | 12.99% | 7.5% | 12.72% |
| `document.repository.ts` | 4.42% | 0% | 4.27% |
| `document-node.repository.ts` | 17.64% | 0% | 15.21% |
| `law-manifest.service.ts` | 58.97% | 63.15% | 57.53% |
| `vanban-chinh-phu-client.service.ts` | 39.13% | 22.22% | 37.2% |

Existing tests use **replicated function logic** pattern (e.g. `document.repository.spec.ts` replicates unexported helpers) or **mocked dependencies** pattern (e.g. `law-index.service.spec.ts` injects mock repos).

---

## Tasks

### 1. Expand `vbpl-client.service.spec.ts` (12.99% → 70%+)

The service currently only has tests for `assertTrustedDocumentUrl`. Add tests for the remaining methods by mocking Playwright:

- [ ] **1.1** Mock `playwright` module (`require('playwright')`) at top of spec file before importing the service
- [ ] **1.2** Test `fetchDocument(url)` — happy path: mock browser launch → page goto → page content → return raw HTML
- [ ] **1.3** Test `fetchDocument(url)` — network error path: mock page.goto to throw, verify error propagation
- [ ] **1.4** Test `fetchDocument(url)` — timeout path: mock timeout, verify error
- [ ] **1.5** Test `searchDocuments(filters)` — happy path: mock browser navigation + network response interception, verify parsed result structure
- [ ] **1.6** Test `searchDocuments(filters)` — empty results path
- [ ] **1.7** Test request delay behavior (verify delay ms config is respected)

**Pattern:** Follow the existing `law-download.service.spec.ts` approach — mock external modules (Playwright), instantiate service directly, assert method behavior.

### 2. Expand `document.repository.spec.ts` (4.42% → 60%+)

The current spec only tests replicated helper functions. Add integration-style tests using an in-memory SQLite database with Drizzle:

- [ ] **2.1** Add `better-sqlite3` and `drizzle-orm/better-sqlite` as devDependencies
- [ ] **2.2** Create a test setup that initializes a SQLite database with the schema tables (`document`, `issuing_body`, `document_reference`), using the same schema definitions from `./schema/`
- [ ] **2.3** Test `findDocumentIdByCitation` — not found returns null, found returns ID
- [ ] **2.4** Test `resolveOrCreateIssuingBody` — creates new body, returns existing body, handles race condition (onConflictDoNothing → fallback lookup)
- [ ] **2.5** Test `upsertDocument` — new document insert, unchanged content_version skip, update existing document
- [ ] **2.6** Test `upsertDocument` — throws when no parseable enactedDate
- [ ] **2.7** Test `upsertRelations` — outbound relation insert, inbound relation with resolved source, inbound relation with unresolved source (skipped)
- [ ] **2.8** Test `healDanglingReferences` — resolves dangling target, no-op when citation can't be extracted
- [ ] **2.9** Test `extractTextReferences` — preamble "Căn cứ" extraction, body citation extraction with context classification
- [ ] **2.10** Test `findReferences` — outgoing direction, incoming direction, all direction, referenceType filter
- [ ] **2.11** Test `searchLocalDocuments` — keyword search (tieu-de, noi-dung, so-hieu scopes), documentTypes filter, issuingBodies filter, date range filters, pagination
- [ ] **2.12** Test `findIssuingBodies` — keyword filter, scope filter, document count aggregation

**Schema note:** The Postgres-specific types (ltree, JSONB) need SQLite-compatible equivalents. Use `text` for ltree paths, `text` (JSON serialized) for JSONB columns. Create a test-only schema variant if needed.

### 3. Expand `document-node.repository.spec.ts` (17.64% → 60%+)

Current spec only tests replicated helpers. Add SQLite-based integration tests:

- [ ] **3.1** Reuse the SQLite test setup from task 2
- [ ] **3.2** Test `syncNodes` — full tree rebuild on content change, skip when content unchanged and nodes exist, backfill when content unchanged but no nodes
- [ ] **3.3** Test `syncNodes` — recursive insert with correct ltree path construction
- [ ] **3.4** Test `findAllNodes` — all nodes, filtered by nodeType, filtered by number, combined filters
- [ ] **3.5** Test `findNodeSubtree` — valid node ID, node not found throws NotFoundException
- [ ] **3.6** Test `fetchDocumentInfo` — found document, not found throws NotFoundException

### 4. Expand `law-manifest.service.spec.ts` (58.97% → 80%+)

- [ ] **4.1** Test manifest read/write operations with mocked `fs/promises`
- [ ] **4.2** Test manifest entry lookup — citation match, no match, multiple candidates
- [ ] **4.3** Test manifest update — add entry, remove entry, update existing entry
- [ ] **4.4** Test edge cases: corrupted manifest file, empty manifest, concurrent write simulation

### 5. Expand `vanban-chinh-phu-client.service.spec.ts` (39.13% → 70%+)

- [ ] **5.1** Mock Playwright module
- [ ] **5.2** Test `fetchDocumentPage(url)` — happy path with full page content
- [ ] **5.3** Test `fetchDocumentPage(url)` — network error, page not found
- [ ] **5.4** Test `searchDocuments(filters)` — happy path, empty results, pagination handling
- [ ] **5.5** Test URL validation and error handling

---

## Validation

Run `npm run test:cov` after all changes. Target:
- Overall statement coverage: **60%+** (from 46.06%)
- Overall function coverage: **60%+** (from 44.63%)
- Each targeted file: **60%+** statement coverage
- All 275+ existing tests still passing

---

## Risks

1. **SQLite vs Postgres type differences**: The schema uses Postgres-specific types (ltree, enums, JSONB). A SQLite-compatible test schema variant may be needed. The `better-sqlite` Drizzle adapter supports basic types; complex types need manual mapping.
2. **Schema migration compatibility**: The test schema must match the production schema structure closely enough that query composition behaves identically.