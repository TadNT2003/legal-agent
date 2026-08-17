# agent-bot/ — structure & conventions

Discord legal agent + HTTP API. ESM TS. Entry `src/index.ts` (main()), which: createMcpClient → ReconnectingMcpClient (+startHeartbeat) → listOpenAiTools + fetchPromptText → createDb + PgSessionStore → loadActiveSessions → new AgentService → startServer → startBot. SIGTERM/SIGINT do graceful shutdown (stopHeartbeat, close MCP, closeDb).

Key modules (all under src/):
- `agent/agentService.ts` — `AgentService` (constructor: llmClient, model, McpToolCaller, tools, systemPrompt). Methods `chat()`, `chatStream()`, `finalAnswerStream()`, `runTool()`. `McpToolCaller` is a function type, not a raw Client (decoupled for reconnection).
- `agent/pgSessionStore.ts` — `PgSessionStore(db: NodePgDatabase)`. Methods: loadActiveSessions, createSession, getById, getByReplyTarget, update, linkReplyTarget. Constants SESSION_STALE_MS (7 days), MAX_CACHE=500. In-memory LRU + Postgres.
- `agent/sessionStore.ts` — older in-memory-only `SessionStore` (still used? check).
- `mcp/client.ts` — `createMcpClient()` + `ReconnectingMcpClient` (callTool with reconnect+retry, listTools, getPrompt, startHeartbeat/stopHeartbeat, close). `isConnectionError`.
- `mcp/tools.ts` — `callMcpTool` (1-retry on transient), `listOpenAiTools`, `fetchPromptText`.
- `commands/splashCommands.ts` — slash commands: /help /about /status /search. Pattern: `handlers` Collection + `registerSlashCommands(client, mcpClient)` + `getCommandBuilders()`. Uses `mcpClientRef` global.
- `events/messageCreate.ts` — DM/@mention handling, rate limit, abort (activeRequests Map), streaming, embed replies (buildAnswerEmbed).
- `events/buttonInteractions.ts` — follow-up buttons + `extractCitations(messages): string[]` (exported, parses tool msg JSON documents/results → "title — citation" deduped).
- `routes/health.ts` — GET /health (currently just {status,timestamp}).
- `routes/chat.ts` — POST /agent/chat, per-IP rate limit.
- `server.ts` — createServer/startServer wiring express: /api → healthRouter, /agent → chatRouter.
- `db/connection.ts` — createDb(config) → {db, pool}, closeDb.
- `schema/session.schema.ts` — drizzle tables: `agent_sessions` (id uuid pk, discord_user_id, discord_channel_id, messages jsonb, created_at, updated_at), `agent_reply_targets` (id, session_id FK→sessions cascade, discord_message_id unique, created_at).
- `tools/logging.ts` — createLogger(module) → {log, error}.

Style: 2-space indent, single quotes, semicolons, ESM with `.js` extension on relative imports. Vietnamese UI strings (user-facing) — keep them Vietnamese. Constants UPPER_SNAKE. JSDoc on public methods.

Tests: `*.spec.ts` next to source, jest ESM, @jest/globals imports {describe,expect,it,jest,beforeEach}. Mock NodePgDatabase by hand (see pgSessionStore.spec.ts createMockDb — chainable then-able objects + jest.fn).

Commands (run in agent-bot/): npm run build, npm run check:types, npm run lint[:fix], npm test [-- pattern].