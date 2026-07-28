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

`src/law-download/` scrapes [vanban.chinhphu.vn](https://vanban.chinhphu.vn/) — the only source this module ever fetches documents from — and files results into `LAWS_DOWNLOAD_DIR` (defaults to the repo-root `../laws/`, see [laws/README.md](../laws/README.md) for the 14-tier folder layout). Every download updates `laws/manifest.json` and `laws/download-log.csv` in place, matching their existing schema.

Document type + issuing body (read off vanban.chinhphu.vn's own detail page) are mapped to one of the 14 tiers by `law-tier-classifier.ts`. When a document doesn't fit a recognized tier (e.g. "Văn bản hợp nhất", which isn't one of the 14 Điều 4 categories), the API returns a clear error instead of guessing — pass `subdirOverride` to force a location.

Three endpoints, all under `/laws/downloads`:

- `POST /laws/downloads` — download one document from its `vanban.chinhphu.vn` detail page URL.

  ```json
  { "url": "https://vanban.chinhphu.vn/?pageid=27160&docid=219000" }
  ```

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
