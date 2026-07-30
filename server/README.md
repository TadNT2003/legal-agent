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

`src/law/` scrapes [vanban.chinhphu.vn](https://vanban.chinhphu.vn/) — the only source this module ever fetches documents from — and files results into `LAWS_DOWNLOAD_DIR` (defaults to the repo-root `../laws/`, see [laws/README.md](../laws/README.md) for the 14-tier folder layout). Every download updates `laws/manifest.json` and `laws/download-log.csv` in place, matching their existing schema. Internally it's split into `src/law/download/` (fetching from vanban.chinhphu.vn), `src/law/catalog/` (browsing/serving what's already downloaded), and `src/law/utils/` (the manifest read-write layer and other plumbing shared by both).

Document type + issuing body (read off vanban.chinhphu.vn's own detail page) are mapped to one of the 14 tiers by `law-tier-classifier.ts`. When a document doesn't fit a recognized tier (e.g. "Văn bản hợp nhất", which isn't one of the 14 Điều 4 categories), the API returns a clear error instead of guessing — pass `subdirOverride` to force a location (this also skips the supersession check below, since an explicit override means the caller has already decided).

**Automatic supersession detection (`luat/` only).** Standalone laws (not amendments, not Quốc hội resolutions) get one more check: if another document with the same subject already sits in `luat/` — matched by title, folding diacritics/case, since Vietnamese replacement laws (thay thế) keep the same title across versions while amendments get "sửa đổi, bổ sung" prepended instead — whichever one is dated later keeps `luat/`, and the older one (moved if it was the existing occupant, routed directly otherwise) goes to `luat-het-hieu-luc/`. This makes `luat/` self-correcting regardless of the order documents arrive in. It's a heuristic on top of a heuristic — same caveat as the original manual dedup in `laws/README.md`'s Known limitations: vanban.chinhphu.vn exposes no authoritative "this replaces that" relationship, only title text.

Downloading, all under `/laws/downloads`:

- `POST /laws/downloads` — download one document from its `vanban.chinhphu.vn` detail page URL.

  ```json
  { "url": "https://vanban.chinhphu.vn/?pageid=27160&docid=219000" }
  ```

- `GET /laws/downloads/status?url=...` — check whether a `vanban.chinhphu.vn` document URL (same shape as above) is already downloaded, without fetching or writing any file. Fetches only the detail page, classifies it the same way a real download would, and reports per-file `downloaded: true/false` — so it exactly predicts what `POST /laws/downloads` would do.

- `POST /laws/downloads/batch` — download a list of documents (same shape, up to 100 per call).

  ```json
  { "documents": [{ "url": "https://vanban.chinhphu.vn/?pageid=27160&docid=219000" }] }
  ```

- `POST /laws/downloads/search` — replays the "TÌM KIẾM VĂN BẢN" filter form at `vanban.chinhphu.vn/?pageid=41852&mode=0` (keyword, Lĩnh vực, Cơ quan ban hành, Năm ban hành) and downloads matches, paginating as needed up to `maxResults`.

  ```json
  { "keyword": "đất đai", "year": "2024", "maxResults": 20, "dryRun": true }
  ```

  Set `dryRun: true` to preview matches without downloading anything.

  **Known site limitation:** for some filter combinations (notably a bare keyword with no year/category/org set), vanban.chinhphu.vn's own "total results" figure is unreliable — it can just echo the selected page size rather than a true count, and the second page can come back empty even though the reported total implied more. This module trusts the site's response as-is (stops paging once it returns zero rows); it isn't something to work around locally, since it's a limitation of the upstream endpoint.

Downloads are sequential with a small delay between requests to `vanban.chinhphu.vn` — this is a shared government server, not a CDN.

## Law index (vbpl.vn -> Postgres)

`src/law-index/` is a separate, independent workflow from the download module above — see [../CLAUDE.md](../CLAUDE.md) for why the two are deliberately kept decoupled. Where `src/law/` builds a raw-file corpus on disk from vanban.chinhphu.vn, `src/law-index/` scrapes [vbpl.vn](https://vbpl.vn/) ("Cơ sở dữ liệu quốc gia về pháp luật", Bộ Tư pháp) and writes structured rows into Postgres — the actual ingestion path for the RAG/chatbot system. Scoped to **Trung ương only** (tiers 1–9, Điều 4 Luật 64/2025/QH15) — central-issued documents have nationwide effect; local (tiers 10–14) documents don't and aren't in scope.

vbpl.vn is a Next.js SPA whose document data (attributes, full text, relationship diagram) is rendered client-side, not present in the raw HTML — this module drives a real headless browser (Playwright) rather than a plain HTTP client. Run `npm run playwright:install` once after `npm install` to fetch the Chromium binary.

Setup:

```bash
npm run playwright:install   # one-time, downloads Chromium
npm run db:generate          # generate a migration from src/law-index/persistence/schema/
npm run db:migrate           # apply it (needs postgres up — docker compose up -d postgres)
```

Endpoints, under `/laws/index`:

- `POST /laws/index/document` — scrape and upsert one document from its vbpl.vn detail page URL.
- `POST /laws/index/crawl` — crawl the trung-ương sitemap block and sync every document found. Pass `limit` for a smoke test — an unbounded crawl is one very long-running request (no resumable cursor/job-queue yet).
- `POST /laws/index/search` — targeted/filtered search against vbpl.vn/van-ban/trung-uong (keyword, Nhóm văn bản / Cơ quan ban hành / Hình thức văn bản checkboxes, Tình trạng hiệu lực, date ranges). Read-only — returns matches with a `sourceUrl` usable as `document`'s `url`, doesn't sync anything itself.

Document-level only for now — the Điều/Khoản/Điểm hierarchy (`document_node`) and everything downstream of Postgres (OpenSearch/ChromaDB/Neo4j projectors, CDC) are later, separately-planned phases.

Browsing what's already downloaded (reads `laws/manifest.json` and the filesystem — never touches `vanban.chinhphu.vn`):

- `GET /laws/overview` — document count and total size across every tier folder. Stops at the tier's own known sub-splits (e.g. tier 2's `luat/` vs `luat-sua-doi-bo-sung/`) — doesn't enumerate every individual downloaded law.
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
