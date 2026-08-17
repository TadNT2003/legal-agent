# legal-agent — Purpose & Stack

Vietnamese-legal-domain RAG chatbot PoC. Architecture is hybrid retrieval (OpenSearch BM25 + ChromaDB semantic + Neo4j graph, fused via RRF, orchestrated by a tool-calling LLM agent, Postgres as source of truth) — but **most of that is not built yet**. See README.md + CLAUDE.md.

The repo has these top-level parts:
- `agent-bot/` — **the active work area**. A Discord legal agent + HTTP API. TypeScript, ESM ("type":"module"), plain Node (no NestJS here — that's the `server/`). Talks to legal-mcp over its MCP HTTP endpoint. See `agent-bot` memory.
- `server/` — NestJS scraper/ingestion (vbpl.vn → Postgres). Two independent workflows (download/catalog vs crawl/retrieve/sync/job-queue/opensearch). See CLAUDE.md.
- `legal-mcp/` — the MCP server exposing `search_documents` + prompt `legal_lookup_guidance`.
- `laws/` — workflow-A flat file corpus (not code).
- `docs/` — docs incl. `docs/agent/agent-bot-recommendations.md` (agent-bot improvement backlog).

Tech: TypeScript 5.7, Node, discord.js 14, OpenAI SDK, drizzle-orm + pg, express 5, @modelcontextprotocol/sdk.

Build/test tooling (agent-bot/):
- `npm run build` → tsc
- `npm run check:types` → tsc --noEmit
- `npm run lint` → eslint src ; `npm run lint:fix`
- `npm test` → jest (ESM, rootDir src, testRegex *.spec.ts, ts-jest useESM). `npm test -- <pattern>` for one spec.
- `npm run db:migrate` / `db:generate` (drizzle).
- Dev: `npm run start:dev` (tsx watch src/index.ts).

NOTE: this checkout is one of several git worktrees (`.kilo/worktrees/*`). Don't assume a running server belongs to this worktree.