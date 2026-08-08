# legal-mcp: reusable retrieval harness (MCP server) — design proposal

**Status: proposed, not started.** This is a forward-looking design doc, not a build record — nothing in this plan has been implemented yet. Written to capture the design while the reasoning behind it (and the research grounding it) is fresh, for whenever this becomes the next thing built.

## Context

`agent-bot/` (the Discord bot, see `docs/plan/agent-bot-plan.md`) was built as a PoC — a single agent proving that tool-calling over this repo's Postgres-backed retrieval works end-to-end. The longer-term intent is different in kind, not just in scope: **retrieval should be a reusable harness any agent or model can plug into**, with `agent-bot` becoming just one consumer of it rather than the thing that owns retrieval logic.

That raises a real fork: should the harness be *only* retrieval tools (thin, protocol-standard, no opinions about workflow), or a *fully agentic workflow* any new model/agent could plug into wholesale? The two aren't equivalent — a hand-rolled workflow bakes in assumptions that are really compensations for one specific weak model (see `docs/plan/agent-bot-plan.md`'s postmortem: the numbered "search then must fetch real text" prompt instruction and `reasoning_effort: "none"` were both needed only because the self-hosted 27B model wouldn't reliably do the right thing on its own). A stronger model — or a different agent framework entirely — wouldn't need either. Baking those into a "harness" would couple it to today's weak model rather than making it genuinely agent-agnostic.

**Decision: build the harness as retrieval tools, not a baked-in workflow.** Concretely, an MCP (Model Context Protocol) server — the current standard for exposing tools to *any* agent/model with zero custom integration per consumer (Claude Desktop, Cursor, a LangGraph agent, `agent-bot`, all speak it natively). What generalizes into the harness is good *tool design* — sensible defaults, safe response bounding, precise schemas — not orchestration logic.

### What already exists to build on

`agent-bot/src/agent/tools.ts` already wraps 3 of `RetrieveController`'s 7 routes as LLM-callable tools (OpenAI function-calling shape), talking to `server/` over HTTP via `agent-bot/src/lawApi/client.ts`. This is the exact logic to extract and generalize — not a rewrite. Full current `RetrieveController` surface (`server/src/law-index/retrieve/retrieve.controller.ts`, mounted at `/laws/index/retrieve`):

| Route | Method | Wrapped by `agent-bot` today? |
|---|---|---|
| `/laws/index/retrieve` | GET (search) | Yes — `search_documents` |
| `/laws/index/retrieve/nodes` | GET | Yes — `get_document_nodes` |
| `/laws/index/retrieve/references` | GET | No |
| `/laws/index/retrieve/issuing-bodies` | GET | No |
| `/laws/index/retrieve/:id` | GET | Yes — `get_document` |
| `/laws/index/retrieve/:id` | DELETE | No (destructive — never should be) |
| `/laws/index/retrieve` | DELETE (bulk) | No (destructive — never should be) |

### Research grounding

From `docs/research/legal-ai-retrieval-landscape.md` (verified quotes, not paraphrase):

- **§4b**: Neo4j should be exposed as **"2–3 discrete agent tools"** (`get_amendment_chain`, `check_still_in_force`, `verify_citation`) — never fused into RRF as a third ranked list, since *"a graph traversal returns a set, not a ranking."*
- **§7c**: *"validity filtering belongs in the retrieval-tool contract, enforced as a hard pre-ranking filter, not deferred to similarity"* — named as the field's central unsolved reliability problem, not a plumbing detail.
- **§6b**: query-shape × complexity routing ("which leg leads," "how deep it goes") is explicitly the **agent layer's** job, not the retrieval tools' — confirms orchestration belongs to each consumer, not the harness.

From `docs/schema/database-design.md`'s "Design principles": each of the three planned downstream stores (OpenSearch, ChromaDB, Neo4j) applies **its own** rollup rule off `document_node` — there's no shared "chunk" concept across them. That argues for tools mapped one-per-capability, not one fused search tool trying to abstract over all three.

There is currently **zero mention of MCP anywhere in this repo** (verified by grep) — this plan introduces it, grounded in the "discrete tools" language above but not something the repo already committed to.

### Current data/branch reality

On the branch this plan was written against (`agent/intial-skeleton`), only Postgres `ILIKE` search is reachable through `RetrieveController` — confirmed via `RetrieveService.search()` → `DocumentRepository.searchLocalDocuments()`, pure `ilike()`/`ILIKE` SQL, no OpenSearch involvement. The OpenSearch projector's core (index mapping, index-admin lifecycle, the `projectDocument()` pure function) exists at `server/src/law-index/opensearch/`, but has no bulk-indexing driver and isn't wired into `law-index.module.ts`/`app.module.ts` on this branch. A fuller version (REST API, backfill service, search endpoint) exists on an unmerged branch, `intergration/opensearch-sync` — and even there, its search endpoint is explicitly commented *"a verification endpoint for v1, not the RAG retrieval API,"* not something meant to be the harness's real search backend as-is. ChromaDB and Neo4j remain zero application code (confirmed: no `neo4j-driver`/`chromadb` packages installed, config-only registration). `docs/plan/opensearch-projector-plan.md`'s "proposed, not started" status line is stale relative to both branches and should be revisited separately — out of scope for this doc.

Net effect: **`legal-mcp`'s `search_documents` tool will proxy to today's Postgres-backed search.** Its contract (schema, defaults, response shape) is written to not need to change when the backing call later swaps to OpenSearch BM25 or fused hybrid search — only `legal-mcp`'s internal implementation would.

## Design

New standalone package **`legal-mcp/`**, sibling to `server/` and `agent-bot/` — same plain-ESM-script conventions as `agent-bot` (no NestJS/DI; see `docs/plan/agent-bot-plan.md`'s postmortem and the saved feedback memory on this — discord.js/MCP servers don't need a framework wrapping them any more than a Discord client does). Talks to `server/`'s existing `/laws/index/retrieve/*` HTTP endpoints only, same as `agent-bot` — `server/` stays the sole thing that ever touches Postgres directly.

```text
legal-mcp/
  src/
    index.ts                # entry point: create MCP server, register tools/prompt, start transport
    config.ts                # LAW_API_BASE_URL, PORT — requireEnv() fail-fast, same pattern as agent-bot/src/config.ts
    lawApi/
      client.ts                # forked from agent-bot/src/lawApi/client.ts — same NFC-normalization and
                                # repeated-key (not bracket) query-array encoding, both already discovered live
      types.ts
    tools/
      searchDocuments.ts         # hard validity default (see below)
      getDocument.ts
      getDocumentNodes.ts          # keeps agent-bot's outline-vs-full-text bounding logic
      getReferences.ts              # new — not in agent-bot today
    prompts/
      legalLookupGuidance.ts         # MCP Prompt primitive — see below
    tools/logging.ts                  # createLogger(moduleName), same as agent-bot
  package.json                          # @modelcontextprotocol/sdk, dotenv; no HTTP framework needed unless
                                         # the SDK's Streamable HTTP transport requires one (check current SDK docs)
  tsconfig.json / eslint.config.mjs       # mirror agent-bot's (ES2022, NodeNext, verbatimModuleSyntax)
  .env.example
```

### Transport

**Streamable HTTP** (the current MCP standard for remote/networked servers, superseding the older HTTP+SSE transport) — needed because `legal-mcp` must serve `agent-bot` as a separate networked process (Phase 2), not just local desktop MCP clients. Runs on its own port — suggested `3200`, avoiding `server/`'s `3000` and `agent-bot`'s `3100`. A stdio adapter (for pure-local clients like Claude Desktop, if ever wanted) would be a thin separate wrapper script, not the primary transport.

### Tools (v1: 4)

1. **`search_documents`** → `GET /laws/index/retrieve`. Same params as `agent-bot`'s version (`keyword`, `searchScope`, `documentTypes`, `issuingBodies`, `validityStatus`, `page`, `pageSize`), **plus a behavior change**: if the caller omits `validityStatus` *and* doesn't set `includeHistorical: true`, the tool applies `validityStatus="Còn hiệu lực"` server-side before calling `server/` — not just a description hint. This directly implements the research's "hard pre-ranking filter... in the retrieval-tool contract" guidance, and fixes the exact failure mode already observed in `agent-bot` (a weak model ignoring a text-only nudge until the system prompt was hand-tuned). Correctness here no longer depends on which model/agent is calling.
2. **`get_document`** → `GET /laws/index/retrieve/:id`. Unchanged from `agent-bot`.
3. **`get_document_nodes`** → `GET /laws/index/retrieve/nodes`. Keeps the outline-vs-full-text bounding: omitting both `nodeType`+`number` and `nodeId` returns structure only (labels/headings, no `fullText`/`textContent`) to avoid flooding context on a document with hundreds of Điều — this is genuine context-safety, not a model-specific compensation, so it carries over as-is.
4. **`get_references`** (new) → `GET /laws/index/retrieve/references`. Not wrapped by `agent-bot` today. Fills, with today's Postgres data, the role the research assigns to Neo4j's `get_amendment_chain`/`verify_citation` (§4b) — same tool name and response shape can have its backing store swapped to Neo4j later without breaking any caller.

Explicitly **not** in v1: `issuing-bodies` (a browsing/discovery tool, lower priority, trivial to add later the same way), and both delete routes (destructive — never belongs in an agent-facing tool surface; `agent-bot` already set this precedent by not wrapping them).

### Prompt (v1: 1)

**`legal_lookup_guidance`** — an MCP *Prompt* primitive (not a Tool) capturing the reusable "recipe" discovered empirically in `agent-bot`'s build: search first → as soon as a candidate exists, drill into its real text via `get_document_nodes` before answering → always cite `citationId` + Điều/Khoản → prefer still-valid law unless asked otherwise → say "not found" rather than guess. Publishing this as a first-class MCP primitive means any consuming client can pull it in directly, instead of every new agent rediscovering the same recipe by trial and error the way `agent-bot`'s system prompt had to be hand-tuned this session. It's guidance a client *chooses* to use, not something the harness enforces server-side — keeping the actual enforcement (tools 1–4's defaults/bounding) separate from the advisory (this prompt).

### Config (`legal-mcp/.env.example`)

- `PORT` — this server's own port (`3200` suggested).
- `LAW_API_BASE_URL` — same meaning as `agent-bot`'s var, e.g. `http://localhost:3000`.

## Relationship to `agent-bot` (Phase 2 — described, not detailed exhaustively)

Once `legal-mcp` exists, `agent-bot`'s `AgentService` becomes a candidate to migrate from its embedded `tools.ts`/`lawApi/client.ts` to an **MCP client** of `legal-mcp` — proving the "any agent can plug into the harness" thesis using `agent-bot` itself as the first real consumer, and collapsing what would otherwise be two parallel copies of the same tool logic into one. The one real adapter this needs: MCP's `tools/list` response shape → the `openai` SDK's `ChatCompletionTool` shape, since `agent-bot`'s loop (`agentService.ts`) is OpenAI-function-calling-shaped today and would need a small translation layer to keep using the same tool-calling loop against an MCP-sourced tool list. Not detailed further here — this is its own follow-up plan once `legal-mcp` is real and proven against at least one non-`agent-bot` MCP client first.

## Relationship to future OpenSearch/ChromaDB/Neo4j work (Phase 3 — mentioned only)

Once the OpenSearch projector is actually wired to a search endpoint (see the branch note above) and/or ChromaDB/Neo4j land, `search_documents`'s internal implementation swaps its backing call (Postgres → BM25 or fused hybrid), and real graph-backed tools (`get_amendment_chain`, `check_still_in_force`, `verify_citation` per §4b) get added — without changing any existing tool's public contract. `get_references` is the natural first candidate to have its backing store swapped to Neo4j once populated, per the note above.

## Verification (once this is actually built)

- A generic MCP client (e.g. the official MCP inspector) can list and call all 4 tools + fetch the prompt against a running `legal-mcp`, independent of `agent-bot` or any specific agent — this is the concrete proof the harness works decoupled from any one consumer.
- Unit tests for the validity-default logic specifically (omitted `validityStatus` → filtered; `includeHistorical: true` → unfiltered; explicit `validityStatus` → caller's value wins), mirroring the test style already used in `agent-bot/src/agent/tools.spec.ts`.
- Manual smoke test against the real `server/` instance for all 4 tools, similar to the live end-to-end verification already done for `agent-bot` (see `docs/plan/agent-bot-plan.md`'s Verification section) — including confirming `get_references` returns sensible data for a document with known amendments.
