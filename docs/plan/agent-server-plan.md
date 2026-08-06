# agent-server (Discord legal-agent bot) implementation plan

**Status: implemented.** This is the planning document that guided `agent-server/` — a standalone PoC tool-calling legal agent exposed via Discord, deliberately kept as its own deployable package, separate from the scraper/ingestion server (`server/`). Preserved here for the design rationale and the gaps found while building and end-to-end verifying against a live self-hosted LLM and a real Discord bot — not visible from reading the plan alone.

A handful of things changed between the original plan and the shipped code:

- **Architecture pivoted from NestJS to a plain ESM Node/TS script.** The plan originally scaffolded `agent-server/` as a second NestJS app (mirroring `server/`'s stack: modules, DI, decorators, Joi validation, Swagger). The user pushed back mid-build and pointed at their prior Discord bot project (`crimson_duchess`) as the actual convention to follow: discord.js's `Client` is self-contained (create it, attach handlers, call `login()`) and doesn't need a framework wrapping it. Rebuilt as a plain script: `index.ts` (entry) → `bot.ts` (Client + login, non-fatal on bad token) / `server.ts` (thin Express app, only for a manual `POST /agent/chat` test route) → `agent/agentService.ts` (hand-rolled `openai` SDK tool-calling loop — also confirmed with the user, not migrated to LangGraph.js/Mastra/Vercel AI SDK, since a single linear loop over 3 tools doesn't earn that machinery yet). Config centralized in one `config.ts` with a `requireEnv` fail-fast helper instead of NestJS `registerAs`/Joi. Dropped `@nestjs/*`, `class-validator`/`class-transformer`, Swagger entirely.
- **ESM + Jest needed explicit `@jest/globals` imports.** Bare `describe`/`it`/`expect`/`jest` globals don't type-check once `@types/jest` is removed (required for the plain-script rewrite, since `@types/jest`'s `Mock<T>` generic shape conflicts with `@jest/globals`'s own). Every `.spec.ts` imports what it needs from `@jest/globals` directly. The correct invocation is `node --experimental-vm-modules node_modules/jest/bin/jest.js` — `node_modules/.bin/jest` is a POSIX shell shim that fails under plain `node` on Windows.
- **The self-hosted LLM (Qwen ~27B via vLLM, behind a Bifrost gateway) needed `reasoning_effort: "none"`** to disable hidden reasoning — a Bifrost/Qwen-specific value, not in the `openai` SDK's official `ReasoningEffort` union (`'low'|'medium'|'high'|null`), passed via a narrow type assertion. `chat_template_kwargs.enable_thinking: false` (the documented Qwen mechanism) is silently ignored by this deployment; DeepSeek-style `{ thinking: { type: "disabled" } }` isn't honored either. This is provider-specific and must be re-verified empirically per deployment. Measured effect on a representative multi-tool-round query: ~75–90s+ down to ~40s.
- **The system prompt needed explicit workflow ordering.** Without it, the model kept re-issuing `search_documents` with varied keywords across all 5 rounds and never called `get_document_nodes` to fetch real article text — even though candidate documents were right there in its own prior tool results. Fixed by numbering the required steps in the system prompt (search → as soon as a candidate exists, must call `get_document_nodes` on it → only answer after reading real text). Confirmed live this reliably produces the intended search → fetch → answer flow.
- **A real data gap surfaced, unrelated to this build:** Vietnam's Luật Doanh nghiệp base law (`59/2020/QH14`) isn't in the Postgres corpus yet — only its 2025 amendment (`76/2025/QH15`) is. Worth flagging to whoever runs the next `law-index` backfill pass (see `docs/monitoring/law-index-flagged-documents.md`); not something this plan's scope covers.
- **Query-array encoding confirmed live:** the scraper's `GET /laws/index/retrieve` expects repeated keys (`documentTypes=A&documentTypes=B`), not bracket notation (`documentTypes[]=A` is rejected outright by its `ValidationPipe`'s whitelist).
- **Vietnamese filter values must be NFC-normalized** before being sent to the scraper's search endpoint — an NFD-encoded string with visually identical characters silently matches zero rows instead of erroring, since the DB's `document_type`/`issuing_body` columns store NFC text. Handled defensively in `LawApiClient` (`.normalize('NFC')` on every string filter value).

Everything else below matches what was built.

---

## Context

Ingestion (`server/src/law-index/`) is real but partial — tiers 1/3/5 have meaningful data in Postgres (`document`/`document_node`/`document_reference`), while the full target retrieval harness (OpenSearch BM25 + ChromaDB semantic + Neo4j KG, fused via RRF) is explicitly "not started" per `README.md`'s sequencing and `CLAUDE.md`. Rather than wait for that harness, the goal was a minimal, working **skeleton agent** that proves the tool-calling-over-Postgres concept end-to-end and is reachable by non-technical users today via Discord, as a PoC.

The agent core and Discord bot deliberately live in **their own server, entirely separate from the scraper/ingestion server** — a different deployable process/codebase, not a module bolted onto `server/`. This repo has no workspace tooling (no root `package.json`) — `server/` is already a standalone package — so `agent-server/` is a sibling standalone package, communicating with `server/` only over HTTP.

Key discovery from exploration (still true): a read/query HTTP layer over Postgres **already existed and needed zero changes** — `RetrieveController` (`server/src/law-index/retrieve/retrieve.controller.ts`, mounted at `/laws/index/retrieve`) exposes search, get-by-id, and node-tree endpoints backed by `RetrieveService`. Because the agent talks to `server/` purely over its existing REST API, **`server/` required no code changes at all** — clean separation, zero risk to the scraper codebase.

Confirmed decisions: LLM access via the `openai` SDK pointed at a **self-hosted OpenAI-compatible endpoint** (Bifrost gateway → vLLM → Qwen ~27B); Discord interaction via **mention-or-DM** (no slash-command registration); plain Node/TS script architecture, no framework, matching the `crimson_duchess` convention; hand-rolled tool-calling loop, no agent framework.

## Design

Standalone package at repo root, sibling to `server/`:

```text
agent-server/
  src/
    index.ts                 # entry point: builds AgentService, starts the HTTP server, then the bot
    config.ts                 # single source of truth for env vars; requireEnv() fails fast on anything missing
    bot.ts                      # discord.js Client creation + login (non-fatal on failure)
    server.ts                    # thin Express app: GET /api/health, POST /agent/chat
    agent/
      agentService.ts             # system prompt + bounded tool-calling loop (max 5 rounds), reasoning_effort override
      agentService.spec.ts
      tools.ts                     # tool JSON schemas + dispatcher -> LawApiClient calls
      tools.spec.ts
      llmClient.ts                  # createLlmClient() -> OpenAI SDK instance from config
    lawApi/
      client.ts                     # LawApiClient: fetch wrapper over the scraper's retrieve endpoints
      client.spec.ts
      types.ts                       # LawSearchParams/LawDocument/LawNode etc., mirroring the scraper's DTOs
    events/
      ready.ts                        # Discord ClientReady handler
      messageCreate.ts                 # mention/DM detection, typing indicator, reply chunking
    routes/
      health.ts
      chat.ts
    tools/
      logging.ts                        # createLogger(moduleName) factory, per-module timestamped log lines
  package.json                            # standalone — its own dependency set, ESM ("type": "module")
  tsconfig.json                             # target ES2022, module/moduleResolution NodeNext, verbatimModuleSyntax
  eslint.config.mjs                          # typescript-eslint recommendedTypeChecked, unbound-method off for *.spec.ts
  .env.example / .gitignore
```

No `nest-cli.json`, no `tsconfig.build.json`, no decorators, no DI container — every dependency is a plain constructor argument or module-level import.

### `LawApiClient` (`agent-server/src/lawApi/client.ts`)

Thin wrapper over Node's built-in global `fetch` (no HTTP dependency needed) hitting three endpoints on the scraper server, unchanged from the original design:
- `search(params)` → `GET {LAW_API_BASE_URL}/laws/index/retrieve?...`
- `getById(documentId)` → `GET {LAW_API_BASE_URL}/laws/index/retrieve/:id`
- `getNodes(params)` → `GET {LAW_API_BASE_URL}/laws/index/retrieve/nodes?...`

All string filter values pass through `.normalize('NFC')` before being sent (see the NFC gotcha above).

### Retrieval tools (`agent-server/src/agent/tools.ts`)

- `search_documents(keyword, searchScope?, documentTypes?, issuingBodies?, validityStatus?, page?, pageSize?)` → `LawApiClient.search()`. Tool description tells the model that omitting `validityStatus` should still default toward `"Còn hiệu lực"` (still-in-force) unless the user is clearly asking about historical/repealed law.
- `get_document(documentId)` → `LawApiClient.getById()` — metadata, dates, validity status, source URL.
- `get_document_nodes(documentId, nodeType?, number?, nodeId?)` → `LawApiClient.getNodes()`. Omitting both `nodeType`+`number` and `nodeId` returns an **outline only** (labels/headings, `fullText`/`textContent` stripped) to avoid flooding context with an entire document's text on a document that could have hundreds of Điều — the model must call again with a specific node to get real text. This bounding is applied client-side in `dispatchToolCall`, since the scraper's own endpoint always returns full enriched text regardless of filters.

Out of scope: a `get_references` tool over the scraper's `/retrieve/references` endpoint — trivial to add later the same way, not needed yet.

### Agent loop (`agentService.ts`)

System prompt (Vietnamese): only answer from tool results, never invent law text; always cite `citationId` + Điều/Khoản/Điểm; prefer still-valid law unless asked otherwise; say "not found" rather than guess; not-legal-advice disclaimer — **plus a numbered required workflow** (search first → must fetch real text via `get_document_nodes` on a chosen candidate → only then answer), added after live testing showed the model would otherwise loop on search alone. Every `chat.completions.create` call passes `reasoning_effort: "none"` (via a narrow type assertion — see above). Loop is bounded at 5 rounds; each round logs which tool(s) were called, their arguments, and a truncated result preview (`createLogger('agent-service')`) — this logging is what made the search-only-looping behavior and the reasoning-latency difference visible during live testing, and is worth keeping for any future self-hosted-model swap.

### Discord layer (`bot.ts` + `events/`)

discord.js `Client` with `Guilds` + `GuildMessages` + `MessageContent` + `DirectMessages` intents. `MessageContent` is a **privileged intent** — must be enabled for the bot application in the Discord Developer Portal (Bot tab), or login fails with `Used disallowed intents`. Login failure is caught and logged, not fatal — the HTTP server keeps running either way, since `POST /agent/chat` is meant to work standalone for testing. On `messageCreate`: ignore bot messages, respond only on DM or @mention, show a typing indicator (guarded by `'sendTyping' in message.channel` since not every channel type has it), strip the mention text, call `AgentService.chat()`, reply split at Discord's 2000-char limit.

## Config (`agent-server/.env.example` + `config.ts`)

Own env file, own fail-fast validation — entirely separate from `server/.env`:
- `PORT` — this server's own HTTP port (`3100` suggested; must differ from the scraper's `3000` since both run locally at once).
- `LAW_API_BASE_URL` — e.g. `http://localhost:3000`, wherever the scraper server is actually running.
- `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` — self-hosted OpenAI-compatible endpoint (Bifrost/vLLM in practice).
- `DISCORD_BOT_TOKEN` — from the Discord Developer Portal; requires the `MessageContent` privileged intent enabled.

## Dependencies (`agent-server/package.json`)

`dependencies`: `discord.js`, `dotenv`, `express`, `openai`. `devDependencies`: `@eslint/js`, `@jest/globals`, `@types/express`, `@types/node`, `eslint`, `jest`, `ts-jest`, `tsx`, `typescript`, `typescript-eslint`. No `pg`/`drizzle-orm`/`playwright`/`@nestjs/*` — this server never touches Postgres or any search engine directly.

## Known limitations (stated explicitly, not glossed over)

- Retrieval is `ILIKE` substring matching only (no ranking, no BM25, no semantic search) — inherited as-is from the scraper's `searchLocalDocuments`. Answer quality depends heavily on the LLM's chosen search terms; closing this gap is the already-sequenced OpenSearch/ChromaDB/RRF work, and won't require changing this server's shape (only `LawApiClient`'s target endpoints would eventually change).
- Tool-calling reliability and latency depend heavily on the specific self-hosted model/deployment — confirmed live that a 27B model needs an explicit reasoning-disable flag and explicit step-ordering in the prompt to reliably complete a 2-step search→fetch flow; a stronger model might need neither.
- No conversation memory across messages — each Discord message is a fresh, stateless question.
- The scraper server's `/laws/index/retrieve/*` endpoints are unauthenticated. Fine for two local/internal servers talking to each other as a PoC; worth revisiting before any public exposure of either server.
- Postgres data coverage gaps exist independent of this agent (e.g. `59/2020/QH14` missing) — the agent correctly reports "not found" rather than hallucinating, but can't answer questions about documents `server/`'s `law-index` hasn't scraped yet.

## Verification (as actually performed)

- `npm run build` / `npm run lint` / `npm test` inside `agent-server/` — all clean, 13 unit tests covering the tool dispatcher (including the outline-stripping behavior) and the agent loop's control flow (tool execution, error-in-tool-call handling, MAX_TOOL_ROUNDS fallback).
- Live boot test: scraper server (`server/`) running on 3000, `agent-server` started on 3100 — confirmed clean module wiring, `GET /api/health` 200, `POST /agent/chat` 400 on empty body, graceful 500 (not a crash) when the LLM endpoint was unreachable, non-fatal handling of an invalid Discord token.
- Live end-to-end test against the real self-hosted LLM and real Discord bot (logged in as `Harpae#2696`): asked about a real, in-corpus document (Nghị định 254/2026/NĐ-CP, e-invoices) and got a correctly-cited, correctly-sourced answer pulling real Điều text (Điều 5, 6, 9, 10) via the search → `get_document_nodes` flow. Also asked about a document that doesn't exist in the corpus yet (`59/2020/QH14`) and confirmed the agent reported not-found rather than hallucinating, after exhausting reasonable search variations.
