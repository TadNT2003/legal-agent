# Plan B: Extend Test Coverage — Controllers, Modules & Persistence Layers

**Branch:** `test/service-unit-test`
**Goal:** Add test coverage for controllers (0%), module wiring, and persistence layer integration using supertest HTTP-layer tests and SQLite-backed repository tests. DTOs are explicitly excluded from testing.

---

## Current State

All controllers, modules, and the persistence layer show **0% coverage** (except helper-only specs for repositories). The four controllers delegate to services but have no HTTP-layer tests.

| Controller | Lines | Methods |
|-----------|-------|---------|
| `law-index.controller.ts` | 113 | 5 endpoints |
| `retrieve.controller.ts` | 115 | 4 endpoints |
| `law-catalog.controller.ts` | 122 | 3 endpoints |
| `law-download.controller.ts` | 70 | 5 endpoints |

---

## Design Decisions

- **Controller tests:** supertest HTTP layer via `@nestjs/testing` + `Test.createTestingModule`. Tests verify route bindings, HTTP methods, status codes, DTO validation, and response shapes.
- **Persistence tests:** In-memory SQLite with Drizzle (see Plan A, tasks 2-3).
- **Module tests:** Verify module composition and dependency injection correctness.

---

## Tasks

### 1. Controller Tests — LawIndexController

Create `server/src/law-index/law-index.controller.spec.ts`:

- [ ] **1.1** Set up TestingModule with `LawIndexController` and mocked `LawIndexService`
- [ ] **1.2** Test `POST /laws/index/crawl/url` — valid URL body returns 201 with sync result
- [ ] **1.3** Test `POST /laws/index/crawl/url` — missing URL body returns 400 (class-validator pipe)
- [ ] **1.4** Test `POST /laws/index/crawl/batch` — valid batch body returns sync summary
- [ ] **1.5** Test `POST /laws/index/crawl/batch` — exceeds max URLs returns 400
- [ ] **1.6** Test `POST /laws/index/crawl/all` — with limit parameter passes through
- [ ] **1.7** Test `GET /laws/index/crawl/search` — query params passed to service, returns 200
- [ ] **1.8** Test `POST /laws/index/crawl/search` — search-and-sync body passed through, returns 200
- [ ] **1.9** Test service method error propagation — when service throws, controller returns 500/503

**Pattern:**
```ts
const module: TestingModule = await Test.createTestingModule({
  controllers: [LawIndexController],
  providers: [
    { provide: LawIndexService, useValue: mockService },
  ],
}).compile();
const app = module.createNestApplication();
await app.init();
await request(app.getHttpServer()).post('/laws/index/crawl/url').send({ url: '...' });
```

### 2. Controller Tests — RetrieveController

Create `server/src/law-index/retrieve/retrieve.controller.spec.ts`:

- [ ] **2.1** Set up TestingModule with `RetrieveController` and mocked `RetrieveService`
- [ ] **2.2** Test `GET /laws/index/retrieve` — search with keyword, scope filters
- [ ] **2.3** Test `GET /laws/index/retrieve` — search with date range filters
- [ ] **2.4** Test `GET /laws/index/retrieve/nodes` — retrieveNode with documentId
- [ ] **2.5** Test `GET /laws/index/retrieve/nodes` — nodeType and number filters
- [ ] **2.6** Test `GET /laws/index/retrieve/nodes` — nodeId filter
- [ ] **2.7** Test `GET /laws/index/retrieve/references` — outgoing direction
- [ ] **2.8** Test `GET /laws/index/retrieve/references` — incoming direction, all direction
- [ ] **2.9** Test `GET /laws/index/retrieve/references` — referenceType filter
- [ ] **2.10** Test `GET /laws/index/retrieve/issuing-bodies` — no filters
- [ ] **2.11** Test `GET /laws/index/retrieve/issuing-bodies` — keyword filter, scope filter

### 3. Controller Tests — LawCatalogController

Create `server/src/law/catalog/law-catalog.controller.spec.ts`:

- [ ] **3.1** Set up TestingModule with `LawCatalogController` and mocked `LawCatalogService`
- [ ] **3.2** Test `GET /laws/catalog/overview` — no tier parameter returns tier overview
- [ ] **3.3** Test `GET /laws/catalog/overview?tier=2` — scoped tier stats returned
- [ ] **3.4** Test `GET /laws/catalog/documents/status` — citation query, returns status
- [ ] **3.5** Test `GET /laws/catalog/documents/status` — missing citation and title returns 400
- [ ] **3.6** Test `GET /laws/catalog/documents` — single file document streamed
- [ ] **3.7** Test `GET /laws/catalog/documents` — multi-file document returns zip
- [ ] **3.8** Test `GET /laws/catalog/documents` — missing citation and title returns 400

**Note:** The `serveDocument` method streams files and creates zips. Mock `fs/promises`, `fs`, `archiver`, and `stream` modules to avoid I/O.

### 4. Controller Tests — LawDownloadController

Create `server/src/law/download/law-download.controller.spec.ts`:

- [ ] **4.1** Set up TestingModule with `LawDownloadController` and mocked `LawDownloadService`
- [ ] **4.2** Test `POST /laws/downloads/url` — valid URL body delegates to service
- [ ] **4.3** Test `GET /laws/downloads/status` — URL query param passed through
- [ ] **4.4** Test `POST /laws/downloads/batch` — batch documents passed through
- [ ] **4.5** Test `GET /laws/downloads/search` — search query params passed through
- [ ] **4.6** Test `POST /laws/downloads/search` — search-and-download body passed through

### 5. Module Wiring Tests

Create `server/src/law-index/law-index.module.spec.ts`:

- [ ] **5.1** Test `LawIndexModule` compilation — all providers are instantiated
- [ ] **5.2** Verify `LawIndexService` is available from the module
- [ ] **5.3** Verify dependency chain: `LawIndexService` → `VbplClientService` → config
- [ ] **5.4** Verify `DbModule` is imported and `DRIZZLE` token is provided
- [ ] **5.5** Verify `RetrieveModule` is imported
- [ ] **5.6** Verify `LawIndexController` is registered

Create `server/src/law-index/retrieve/retrieve.module.spec.ts`:

- [ ] **5.7** Test `RetrieveModule` compilation — providers and controller instantiated
- [ ] **5.8** Verify `RetrieveService` is available and wired to repositories

**Pattern:**
```ts
const module: TestingModule = await Test.createTestingModule({
  imports: [LawIndexModule],
}).compile();
expect(module.get(LawIndexService)).toBeDefined();
expect(module.get(DRIZZLE)).toBeDefined();
```

### 6. Persistence Layer — SQLite Integration Tests

These are shared between Plan A and Plan B. See Plan A tasks 2 and 3 for detailed task list. This plan adds the test infrastructure:

- [ ] **6.1** Add `better-sqlite3` and `drizzle-orm/better-sqlite` as devDependencies
- [ ] **6.2** Create `server/test/setup-test-db.ts` — shared SQLite setup/teardown with schema migration
- [ ] **6.3** Create a SQLite-compatible schema variant in `server/src/law-index/persistence/schema/` (or a test-only schema file) that maps Postgres-specific types to SQLite equivalents:
  - `ltree` → `text`
  - `jsonb` → `text` (JSON stringified)
  - PostgreSQL enums → `text` with check constraints (or plain text)
- [ ] **6.4** Create `server/src/law-index/persistence/db.module.spec.ts` — test that DbModule creates drizzle instance with correct config

---

## File Summary

New test files to create:
1. `server/src/law-index/law-index.controller.spec.ts`
2. `server/src/law-index/retrieve/retrieve.controller.spec.ts`
3. `server/src/law/catalog/law-catalog.controller.spec.ts`
4. `server/src/law/download/law-download.controller.spec.ts`
5. `server/src/law-index/law-index.module.spec.ts`
6. `server/src/law-index/retrieve/retrieve.module.spec.ts`
7. `server/src/law-index/persistence/db.module.spec.ts`
8. `server/test/setup-test-db.ts` (shared test infrastructure)

Existing test files to expand:
- `server/src/law-index/persistence/document.repository.spec.ts` (Plan A task 2)
- `server/src/law-index/persistence/document-node.repository.spec.ts` (Plan A task 3)

---

## Validation

Run `npm run test:cov` after all changes. Target:
- All controllers: **80%+** statement coverage each
- All modules: **70%+** statement coverage each
- Persistence layer: covered by Plan A integration tests
- Zero existing test failures
- All controller routes verified against actual HTTP methods and paths

---

## Risks

1. **File-streaming controller tests**: `LawCatalogController.serveDocument()` pipes file streams and creates zips. These must be thoroughly mocked — supertest can verify headers and content-type, but the actual stream body will be mocked.
2. **Module test limitations**: NestJS module tests via `Test.createTestingModule` only verify that modules compile and providers are injected. They don't verify runtime behavior (that's covered by service/controller tests).
3. **SQLite schema compatibility**: Same risk as Plan A — Postgres-specific types (ltree, JSONB, enums) need SQLite-compatible alternatives.