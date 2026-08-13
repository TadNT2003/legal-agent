<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

Processing server for the legal-agent project: scrapes/downloads Vietnamese legal documents and will grow into the backend for the law web app. Built with [Nest](https://github.com/nestjs/nest).

See [../laws/README.md](../laws/README.md) for the dataset this server populates, and [../docs/database-design.md](../docs/database-design.md) for the planned Postgres/OpenSearch/ChromaDB/Neo4j schema.

## Configuration

Copy `.env.example` to `.env` and fill in real values — see the file for what each variable does (datastore connections, app port, `LAWS_DOWNLOAD_DIR`).

## Law document downloads

This workflow scrapes [vanban.chinhphu.vn](https://vanban.chinhphu.vn/) — the only source this workflow ever fetches documents from — and files results into `LAWS_DOWNLOAD_DIR` (defaults to the repo-root `../laws/`, see [laws/README.md](../laws/README.md) for the 14-tier folder layout). Every download updates `laws/manifest.json` and `laws/download-log.csv` in place, matching their existing schema. It's split into three top-level modules: `src/download/` (fetching from vanban.chinhphu.vn), `src/catalog/` (browsing/serving what's already downloaded), and `src/utils/` (the manifest read-write layer and other plumbing shared between them) — formerly nested under one `src/law/` umbrella module, now fully flattened.

Document type + issuing body (read off vanban.chinhphu.vn's own detail page) are mapped to one of the 14 tiers by `law-tier-classifier.ts`. When a document doesn't fit a recognized tier (e.g. "Văn bản hợp nhất", which isn't one of the 14 Điều 4 categories), the API returns a clear error instead of guessing — pass `subdirOverride` to force a location. Every Bộ luật/luật document lands in one flat `02-luat-nghi-quyet-quoc-hoi/luat-bo-luat/` folder regardless of validity status or amendment-vs-base-law distinction — the dataset is a text corpus for retrieval, not a "current law" database, so there's no supersession/validity routing to speak of.

Downloading, all under `/downloads`:

- `POST /downloads/url` — download one document from its `vanban.chinhphu.vn` detail page URL.

  ```json
  { "url": "https://vanban.chinhphu.vn/?pageid=27160&docid=219000" }
  ```

- `GET /downloads/status?url=...` — check whether a `vanban.chinhphu.vn` document URL (same shape as above) is already downloaded, without fetching or writing any file. Fetches only the detail page, classifies it the same way a real download would, and reports per-file `downloaded: true/false` — so it exactly predicts what `POST /downloads/url` would do.

- `POST /downloads/batch` — download a list of documents (same shape, up to 100 per call).

  ```json
  { "documents": [{ "url": "https://vanban.chinhphu.vn/?pageid=27160&docid=219000" }] }
  ```

- `GET /downloads/search` — search documents via the "TÌM KIẾM VĂN BẢN" filter form (keyword, Lĩnh vực, Cơ quan ban hành, Năm ban hành) and return matching document detail URLs without downloading.

- `POST /downloads/search` — replays the "TÌM KIẾM VĂN BẢN" filter form at `vanban.chinhphu.vn/?pageid=41852&mode=0` (keyword, Lĩnh vực, Cơ quan ban hành, Năm ban hành) and downloads matches, paginating as needed up to `maxResults`.

  ```json
  { "keyword": "đất đai", "year": "2024", "maxResults": 20, "dryRun": true }
  ```

  Set `dryRun: true` to preview matches without downloading anything.

  **Known site limitation:** for some filter combinations (notably a bare keyword with no year/category/org set), vanban.chinhphu.vn's own "total results" figure is unreliable — it can just echo the selected page size rather than a true count, and the second page can come back empty even though the reported total implied more. This module trusts the site's response as-is (stops paging once it returns zero rows); it isn't something to work around locally, since it's a limitation of the upstream endpoint.

Downloads are sequential with a small delay between requests to `vanban.chinhphu.vn` — this is a shared government server, not a CDN.

## Crawl (vbpl.vn + vanban.chinhphu.vn -> Postgres)

`src/crawl/` is a separate, independent workflow from the download/catalog/utils modules above — see [../CLAUDE.md](../CLAUDE.md) for why the two are deliberately kept decoupled. Where those build a raw-file corpus on disk from vanban.chinhphu.vn, `src/crawl/` writes structured rows into Postgres — the actual ingestion path for the RAG/chatbot system. Its primary source is [vbpl.vn](https://vbpl.vn/) ("Cơ sở dữ liệu quốc gia về pháp luật", Bộ Tư pháp), scoped to **Trung ương only** (tiers 1–9, Điều 4 Luật 64/2025/QH15) — central-issued documents have nationwide effect; local (tiers 10–14) documents don't and aren't in scope. vanban.chinhphu.vn is also indexed here as a **supplementary** source — see its own bullet below for exactly what that does and doesn't cover.

vbpl.vn is a Next.js SPA whose document data (attributes, full text, relationship diagram) is rendered client-side, not present in the raw HTML — this module drives a real headless browser (Playwright) rather than a plain HTTP client for that source. Run `npm run playwright:install` once after `npm install` to fetch the Chromium binary.

Setup:

```bash
npm run playwright:install   # one-time, downloads Chromium
npm run db:generate          # generate a migration from src/persistence/schema/
npm run db:migrate           # apply it (needs postgres up — docker compose up -d postgres)
```

Endpoints:

- `POST /crawl/url` — scrape and upsert one document from its vbpl.vn detail page URL. Full pipeline: attributes, full text, document_node tree, and document_reference relations resolved from vbpl.vn's own "Lược đồ" tab.
- `POST /crawl/chinhphu/url` — scrape and upsert one document from its vanban.chinhphu.vn detail page URL — a **supplementary** source alongside vbpl.vn, never overwriting a document already indexed under the same citation from another source. **Known, permanent limitation:** vanban.chinhphu.vn has no curated relationship graph the way vbpl.vn does, so documents synced through this endpoint get **zero document_reference rows**, in either direction, ever — not just until some feature ships. It also has no server-rendered full text (only downloadable PDF/DOC/RTF attachments), so today every synced document is metadata-only (`indexScope: 'metadata_only'`, no document_node tree) until a document-processing/OCR tool is wired into `DOCUMENT_TEXT_EXTRACTOR` — see `src/crawl/document-text-extractor.ts`.
- `POST /crawl/all` — crawl the trung-ương sitemap block and sync every vbpl.vn document found. Pass `limit` for a smoke test — an unbounded crawl is one very long-running request (no resumable cursor/job-queue yet).
- `GET /crawl/search` — targeted/filtered search against vbpl.vn/van-ban/trung-uong (keyword, Nhóm văn bản / Cơ quan ban hành / Hình thức văn bản checkboxes, Tình trạng hiệu lực, date ranges). Read-only, hits the live site — returns matches with a `sourceUrl` usable as `POST /crawl/url`'s `url`. If vbpl.vn returns zero matches for these filters (or rejects an unrecognized issuing-body value), automatically falls back to a read-only search against vanban.chinhphu.vn using the subset of filters it can express (keyword, one issuing body, one issuing year — see `src/crawl/fallback-search.service.ts`), returning a `{ source, result }` envelope so the caller knows which site actually answered. Either way, this endpoint itself only searches, it never syncs anything.
- `GET /retrieve` — same filter shape as `GET /crawl/search`, but queries already-synced rows in Postgres instead of scraping vbpl.vn. Only a subset of the filters is actually honored against local data: keyword (title or citation), `documentTypes`, `issuingBodies`, `validityStatus`, and the issued/effective date ranges. `documentGroups`, `searchScope`, `exactPhrase`, and `expiredFrom`/`expiredTo` are accepted (same DTO) but silently ignored — there's no persisted document-group or expiry-date field to filter on yet — and an unrecognized `validityStatus` is also silently ignored (matches everything) rather than erroring. `expiryDate` in the response is always `null` for the same reason.

  Array-valued filters (`documentTypes`, `issuingBodies`, `documentGroups`) work as either a single query param (`?documentTypes=Luật`) or a repeated one for multiple values (`?documentTypes=Luật&documentTypes=Bộ+luật`) — both endpoints being `@Query()`-bound now (not `@Body()`), a lone occurrence would otherwise arrive as a bare string and fail `IsArray()` validation; the DTO coerces it into a one-element array first.

Document-level only for now — the Điều/Khoản/Điểm hierarchy (`document_node`) and everything downstream of Postgres (OpenSearch/ChromaDB/Neo4j projectors, CDC) are later, separately-planned phases (except where noted above, vanban.chinhphu.vn is metadata-only regardless of that timeline).

Browsing what's already downloaded (reads `laws/manifest.json` and the filesystem — never touches `vanban.chinhphu.vn`):

- `GET /laws/overview` — document count and total size across every tier folder. Stops at the tier's own known sub-splits (e.g. tier 2's `luat-bo-luat/` vs `nghi-quyet-quoc-hoi/`) — doesn't enumerate every individual downloaded law.
- `GET /laws/tiers/:tier` — same stats, scoped to one tier only, but with the full recursive breakdown down to each individual law folder. `tier` is an integer 1-14 (Điều 4, Luật 64/2025/QH15).
- `GET /laws/documents?citation=...` or `?title=...` (optionally with `dateFrom`/`dateTo`, real date-range filtering, not text matching) — streams back every file belonging to the matching document. `citation` is an exact, case-insensitive match; `title` is a closest-match fuzzy search ([fuse.js](https://fuse.js.org/), diacritics-folded so `"bo luat lao dong"` finds `"Bộ Luật Lao động"`) — no need to type it exactly. A single-file document streams back as-is; a document with phụ lục attachments streams back as a `.zip` of the main text plus every annex. Responds `404` if nothing matches, or if the manifest lists a file that's since gone missing from disk.
- `GET /laws/documents/status` — same citation/title (+ optional dateFrom/dateTo) resolution as the endpoint above, but returns manifest.json metadata and file count as JSON instead of streaming content, with a per-file `existsOnDisk` flag (reports drift instead of throwing `404` on a missing file).

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
