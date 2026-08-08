# Server Unit Testing

## Overview

The `server/` directory contains a NestJS application with Jest-based unit tests. Tests focus on business-critical services and pure helper functions — controllers, DTOs, modules, schemas, and config files are intentionally not unit-tested as they contain no standalone logic.

> **Vietnamese version:** [README.vi.md](README.vi.md). This English version is canonical — prefer it where the two diverge.

## Running Tests

```bash
# Run all tests
cd server && npm test

# Run with coverage report
cd server && npm run test:cov

# Watch mode
cd server && npm run test:watch

# Run a specific test file
npx jest path/to/file.spec.ts
```

## Test Structure

```
server/src/
├── app.controller.spec.ts                          # original: app controller
├── law/
│   ├── catalog/
│   │   ├── http-file.util.spec.ts                  # MIME types, Content-Disposition
│   │   └── law-catalog.service.spec.ts             # catalog browsing, document lookup
│   ├── download/
│   │   ├── filename.util.spec.ts                   # original: filename generation
│   │   ├── law-download.service.spec.ts            # download pipeline, batch, search-driven
│   │   ├── law-tier-classifier.spec.ts             # original: tier classification
│   │   ├── vanban-chinh-phu-client.service.spec.ts # URL validation
│   │   └── vanban-chinh-phu.parser.spec.ts         # original: HTML parsing
│   └── utils/
│       ├── document-matcher.spec.ts                # original: citation/title matching
│       ├── law-manifest.service.spec.ts            # manifest.json CRUD, CSV logging
│       └── text-normalize.util.spec.ts             # Vietnamese diacritic folding
└── law-index/
    ├── crawl/
    │   ├── document-node.parser.spec.ts             # original: document body parsing
    │   ├── vbpl-client.service.spec.ts              # URL validation
    │   ├── vbpl-sitemap.service.spec.ts             # sitemap URL extraction
    │   └── vbpl.parser.spec.ts                      # original: vbpl.vn page parsing
    ├── persistence/
    │   ├── document-node.repository.spec.ts         # node hash, ordinal sanitization
    │   └── document.repository.spec.ts              # validity mapping, authority ranking
    ├── retrieve/
    │   └── retrieve.service.spec.ts                 # tree building, enrichment, extraction
    └── law-index.service.spec.ts                    # crawl/sync orchestration
```

## Current Coverage

| Metric | Coverage |
|---|---|
| Statements | 52.0% |
| Branches | 46.4% |
| Functions | 49.1% |
| Lines | 52.7% |
| Test Suites | 19 |
| Total Tests | 275 |

### Coverage by Business-Critical Service

| Service | Statements | Branch | Functions |
|---|---|---|---|
| `RetrieveService` | 100% | 94.4% | 100% |
| `LawIndexService` | 98.1% | 75.8% | 100% |
| `LawDownloadService` | 90.9% | 65.2% | 100% |
| `VbplSitemapService` | 87.9% | 75.0% | 62.5% |
| `LawCatalogService` | 81.9% | 56.7% | 93.3% |
| `LawManifestService` | 59.0% | 77.8% | 63.2% |
| `VanBanChinhPhuClientService` | 39.1% | 40.0% | 22.2% |
| `VbplClientService` | 13.0% | 7.5% | 7.5% |

### Files With Zero Coverage (Intentional)

- **Controllers** — thin delegation to services, tested implicitly
- **DTOs** — decorator-driven validation handled by NestJS pipes at runtime
- **Module files** — `@Module()` wiring, no business logic
- **Schema files** — Drizzle ORM declarative table definitions
- **Config files** — `process.env`-dependent factories
- **`main.ts`** — application bootstrap
- **`VbplClientService`** (mostly) — Playwright browser automation; only URL validation is unit-testable

### Files With Low Coverage (Structural Limitation)

- **`document.repository.ts`** (6.2%) — helper functions are not exported; class methods require a live Drizzle DB. The corresponding spec (`document.repository.spec.ts`) replicates the helper logic inline to verify correctness.
- **`document-node.repository.ts`** (17.6%) — same limitation; `document-node.repository.spec.ts` tests the helper functions with replicated logic.

## Testing Approach

### Pure Functions
Tested directly via import. Examples: `foldDiacritics`, `mimeTypeForFilename`, `classifyTier`, `buildFilename`, `findByCitation`, `parseVbplPage`.

### Services with Injected Dependencies
Dependencies are mocked using `jest.fn()` and services are instantiated directly with mock objects. No NestJS `Test.createTestingModule()` is used — plain constructor injection with mocks keeps tests fast and isolated.

```typescript
const mockRepo = {
  upsertDocument: jest.fn().mockResolvedValue({ documentId: 'doc-1', changed: true }),
  upsertRelations: jest.fn(),
  healDanglingReferences: jest.fn().mockResolvedValue(0),
};

const service = new LawIndexService(
  mockSitemap,
  mockClient,
  mockRepo,
  mockNodeRepo,
);
```

### Services with File I/O
`fs/promises` is mocked at the module level with `jest.mock('fs/promises', ...)`.

```typescript
jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
  access: jest.fn(),
}));
```

### Services with External Modules
Third-party modules (e.g., `cheerio`, `stream`, `stream/promises`) are mocked before imports.

### Repository Helper Functions
Module-scoped helpers in repository files are not exported. Their logic is replicated in the corresponding spec file to test the algorithms independently. This avoids the complexity of mocking the entire Drizzle DB layer for thin query wrappers.

## Adding New Tests

1. Create `*.spec.ts` in the same directory as the source file.
2. Use plain Jest `describe`/`it` — no `Test.createTestingModule()`.
3. Mock dependencies at the top of the file with `jest.mock()` before any imports that need the mock.
4. Instantiate services directly with mock objects.
5. Keep test data realistic — use actual Vietnamese citations, document types, and issuing body names where relevant.
6. Aim for 80%+ statement coverage on new business logic.

## CI Integration

Run `npm run test:cov` in CI to verify all tests pass and coverage doesn't regress. The coverage report is written to `server/coverage/`.