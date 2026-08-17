# Agent Bot — Recommendations

**Last updated:** 2026-08-17

Improvement recommendations for the Discord legal agent (`agent-bot/`), grouped by UX (user-facing Discord experience) and internal operations. Items are ordered by impact vs. effort.

---

## UX / Discord-Facing

### 1. ✅ `/search` Slash Command — DONE (2026-08-13)

A structured search command with optional fields: `keyword`, `documentType`, `issuingBody`, `validityStatus`. Gives users a form-based alternative to free-text questions, useful for those who know exactly what document type they want.

**Status: Implemented.** See `agent-bot/src/commands/splashCommands.ts` (`searchHandler`). The command calls MCP `search_documents` directly (no LLM involved), returns results as an ephemeral embed. Options include `keyword` (required), `phạm-vi` (scope), `loai-van-ban` (doc types), `co-quan` (issuing bodies), `hieu-luc` (validity), and `so-ket-qua` (max results, default 5).

### 2. ✅ Interactive Follow-Up Buttons — DONE (2026-08-14)

After the agent replies, attach Discord `ButtonComponent` components:

- **"Tra c\u1ee9u th\u00eam"** — Prompt the user for a follow-up keyword, continuing the same session.
- **"Chi ti\u1ebft"** — Show raw citations and source links extracted from tool call history.
- **"K\u1ebft th\u00fac"** — Close the session.

This turns a flat text reply into a navigable conversation without requiring users to know how to phrase follow-ups.

**Status: Implemented.** New file `events/buttonInteractions.ts` with `registerButtonInteractions()` and `createFollowUpRow()`. The `messageCreate.ts` reply loop now attaches the button row (with session ID encoded in custom IDs) to the last reply chunk. Button handlers look up the session via `PgSessionStore.getById()` and:

- **follow_up**: Replies ephemeral, guiding user to type follow-up question.
- **details**: Extracts citation info from tool call results in session messages, formats as an embed.
- **end_session**: Confirms session ended; user must @mention or DM to start new session.

**Files changed:** `events/buttonInteractions.ts` (new), `events/messageCreate.ts`, `bot.ts`.

### 3. ✅ `/sources` Slash Command — DONE (2026-08-17)

List the documents the agent consulted during the current session, with clickable links. Legal users need to verify sources, and currently citations are buried in the text reply.

**Status: Implemented.** New `/sources` slash command (`commands/splashCommands.ts`, `sourcesCommand` + `sourcesHandler`). It lists the legal documents the agent consulted in the user's most recent conversation, with a "🔗 Mở tài nguyên" hyperlink for each source that has one.

The handler resolves the session via a new `PgSessionStore.getLatestByUserId(interaction.user.id)` (`agent/pgSessionStore.ts`), which queries `agent_sessions` for the user's most recently updated row — no message-reference plumbing needed, so it works in DMs and avoids Discord snowflake-precision issues with passing a raw message ID. Citations are extracted from the session's tool-call history by `extractSources()` (`events/sourceExtraction.ts`, shared with the "Chi tiết" button and the answer embed), which reads `title`/`citation`/`sourceUrl` from each tool message's `items`/`documents`/`results` array and deduplicates. The command is registered in `handlers` and is exempt from the MCP-availability guard (it only needs the session store).

**Files changed:** `commands/splashCommands.ts`, `agent/pgSessionStore.ts`, `agent/pgSessionStore.spec.ts` (new `getLatestByUserId` describe block).

### 4. ✅ Persistent Typing Indicator During Tool Calls — DONE (2026-08-13)

The bot sends a typing indicator on the initial message, but not during the multi-round tool-calling loop (which can take 40s+). Users may think the bot froze.

**Status: Implemented.** The `AgentService.chat()` method now accepts an optional `onProgress` callback that fires at three phases: `round_start`, `tool_call`, and `final_answer`. The Discord message handler (`messageCreate.ts`) uses this callback to send `channel.sendTyping()` on each tool call and round start, plus runs a `setInterval` (every 10s) as a safety net for long-running rounds. The interval is cleared in a `finally` block when the reply completes or an error occurs.

### 5. ✅ Embed-Based Replies — DONE (2026-08-17)

Format agent answers as Discord embeds instead of plain text chunks. Use the embed description for the answer body, and a dedicated "📚 Nguồn" (Sources) field for citations. This is more readable and visually distinguishable from regular chat messages.

**Status: Implemented.** In `messageCreate.ts`, a `buildAnswerEmbed()` helper creates a Discord embed (blurple `0x5865F2`) with the answer in the description (truncated to the 4096-char embed limit) and a "📚 Nguồn" field (truncated to the 1024-char field limit) listing the cited documents. Citations are extracted from the session's tool-call history by `extractCitations()` (now exported from `events/buttonInteractions.ts` and shared with the "Chi tiết" button), which reads `title`/`citation` (or the Vietnamese `tieuDe`/`soHieu`) from each tool message's JSON `documents`/`results` array and deduplicates.

All reply paths now use embeds: the final answer (single and multi-chunk — citations attached to the first chunk only), the incremental streaming edits, and the error reply (red `0xED4245` embed, which now returns early instead of falling through to a second send).

**Files changed:** `events/messageCreate.ts`, `events/buttonInteractions.ts` (export `extractCitations`), `events/buttonInteractions.spec.ts` (new).

---

## Internal Operations

### 6. ✅ Streaming Responses — DONE (2026-08-14)

Currently the user waits 40s+ for the full reply. Use the OpenAI streaming API + Discord's edit-message pattern to show progressive output:

1. Send initial "Đang tra cứu..." message
2. On each tool call result, edit the message to show intermediate progress
3. On final answer, stream tokens and edit incrementally

This is the single biggest UX win for perceived latency.

**Status: Implemented.** New `AgentService.chatStream()` method (`agentService.ts`) that uses the OpenAI streaming API for the final answer round. Tool-calling rounds execute non-streaming (as before), and only the last round uses `stream: true`. Token deltas are emitted as `StreamTokenEvent` objects via a `StreamCallback` function.

The Discord handler (`messageCreate.ts`) now uses `chatStream` instead of `chat`. It sends an initial "⏳ Đang tra cứu..." message, then edits the message incrementally every 1.5s (after 80 chars accumulated) as tokens arrive. When streaming completes, the final reply is set with the follow-up button row attached. If the reply exceeds the Discord 2000-char limit, it splits into multiple messages with the first reusing the initial message edit.

**Files changed:** `agent/agentService.ts`, `agent/agentService.spec.ts`, `events/messageCreate.ts`.

### 7. ✅ Request Cancellation / Abort Handling — DONE (2026-08-14)

If a user deletes their message or sends a new one while the agent is working, there's no cancellation. The old request continues consuming LLM tokens and time.

**Status: Implemented.** A `Map<string, AbortController>` (`activeRequests`) is maintained in `messageCreate.ts`, keyed by `message.author.id`. On a new message from the same user, the previous controller is aborted. The `AbortSignal` is passed through to `AgentService.chat()` and `AgentService.chatStream()`, which propagate it to all OpenAI `chat.completions.create()` calls (both streaming and non-streaming) and check `signal.aborted` between rounds and tool calls. When aborted, Discord receives a "⛔ Yêu cầu đã bị hủy." (Request cancelled) message. The AbortController is cleaned up in a `finally` block.

**Files changed:** `events/messageCreate.ts`, `agent/agentService.ts`.

### 8. ✅ Rate Limiting — DONE (2026-08-14)

Neither the HTTP endpoint nor the Discord handler has rate limiting. A simple token-bucket per user ID prevents abuse and protects the MCP/LLM backend.

**Status: Implemented.** A `RateLimiter` class (`utils/rateLimiter.ts`) uses a sliding-window counter per key, with configurable `maxRequests` and `windowMs`. Both the Discord handler (`messageCreate.ts`, keyed by `message.author.id`) and the HTTP chat route (`routes/chat.ts`, keyed by client IP from `x-forwarded-for` or `req.socket.remoteAddress`) enforce a limit of 10 requests per 60 seconds. When exceeded, Discord replies with a Vietnamese "⚠️ Bạn gửi quá nhiều yêu cầu..." message, and the HTTP endpoint returns a 429 status with a retry-after message. Each user's window auto-cleans after expiration via `setTimeout`.

**Files changed:** `utils/rateLimiter.ts` (new), `utils/rateLimiter.spec.ts` (new), `events/messageCreate.ts`, `routes/chat.ts`.

### 9. ✅ Enriched Health Endpoint — DONE (2026-08-17)

The `/api/health` route only returns a timestamp. Add MCP connectivity status, DB connection status, active session count, and LLM model name. Useful for monitoring and for backing a future `/status` command with live data.

**Status: Implemented.** `createHealthRouter(checks: HealthChecks)` in `routes/health.ts` now accepts an injected `HealthChecks` interface (`mcp`, `db`, `sessionCount`, `model`) so the route is unit-testable with fakes and each dependency degrades independently. `GET /api/health` runs the MCP (`listTools`) and DB (`SELECT 1`) checks concurrently via `Promise.all` and a `safeCheck` wrapper that never throws — a failing check reports `{ status: 'down', detail }` instead of taking down the endpoint. The response body is `{ status: 'ok' | 'degraded', timestamp, checks: { mcp, db, sessions, model } }`, returning HTTP 200 when both MCP and DB are `ok` and 503 (`degraded`) otherwise.

The live checks are wired in `index.ts`: `mcp` pings `reconnectingClient.listTools()`, `db` runs `SELECT 1` on the pool, `sessionCount` reads `sessionStore.getActiveCount()`, and `model` is `config.llm.model`.

**Files changed:** `routes/health.ts`, `routes/health.spec.ts` (new), `index.ts`, `server.ts` (route now takes injected checks).

### 10. ✅ MCP Tool Call Retry Policy — DONE (2026-08-14)

When `callMcpTool` fails, it returns a JSON error string to the LLM which may then waste rounds retrying. Add a 1-retry with backoff at the transport level before surfacing the error to the agent loop.

**Status: Implemented.** The `callMcpTool` function in `mcp/tools.ts` now wraps the MCP client call in a try-catch. On transient transport errors (ECONNREFUSED, ECONNRESET, ETIMEDOUT, fetch failed, network), it waits 500ms and retries once. Non-transient errors (MCP-level `isError`, tool-not-found, etc.) pass through immediately without retry. Unit tests cover: retry on success, retry on double-fail, no retry for MCP errors, no retry for non-transient runtime errors.

**Files changed:** `mcp/tools.ts`, `mcp/tools.spec.ts`.

### 11. ✅ Session Cleanup — DONE (2026-08-17)

Sessions older than 7 days accumulate in Postgres with no cleanup. The `SESSION_STALE_MS` constant defines staleness for loading, but no deletion happens.

**Status: Implemented.** `PgSessionStore.cleanupStaleSessions()` (`agent/pgSessionStore.ts`) runs `DELETE FROM agent_sessions WHERE updated_at < (now - SESSION_STALE_MS)` with `.returning(id)`. The `agent_reply_targets` rows are removed automatically via the FK `ON DELETE CASCADE`. The returned IDs are evicted from the in-memory cache (`this.sessions`) and any dangling `sessionIdByReplyTarget` entries are dropped, so a pruned session can't keep being served from memory after its DB row is gone. The method never throws — a transient DB failure is logged and returns 0, so a cleanup hiccup can't crash the bot.

It is scheduled in `index.ts`: run once at startup, then on an hourly `setInterval` (`SESSION_CLEANUP_INTERVAL_MS`), with `unref()` so the timer doesn't keep the process alive, and `clearInterval` on graceful shutdown (SIGTERM/SIGINT).

**Files changed:** `agent/pgSessionStore.ts`, `agent/pgSessionStore.spec.ts` (new `cleanupStaleSessions` describe block), `index.ts` (startup + hourly schedule + shutdown cleanup).

### 12. ✅ MCP Client Reconnection — DONE (2026-08-14)

`createMcpClient()` connects once at startup with no reconnection logic. If the MCP server restarts, the transport becomes a dead connection and all subsequent tool calls fail silently or with generic errors.

**Status: Implemented.** Added `ReconnectingMcpClient` wrapper class (`mcp/client.ts`) with two reconnection mechanisms:

1. **Try-reconnect on tool call**: Each `callTool()` wraps the underlying MCP client call in a try-catch. On connection-level errors (ECONNREFUSED, ECONNRESET, fetch failed, etc.), it re-creates the transport, reconnects, and retries the tool call once with a 2s backoff. Non-connection errors pass through unchanged.
2. **Periodic heartbeat**: A `listTools()` call runs every 60s. On failure, it triggers a proactive reconnect before any user request is impacted.

The `AgentService` constructor now takes an `McpToolCaller` function instead of a raw `Client`, decoupling it from the transport layer. Graceful shutdown (SIGTERM/SIGINT) stops the heartbeat and closes the transport cleanly.

**Files changed:** `mcp/client.ts`, `mcp/client.spec.ts`, `agent/agentService.ts`, `agent/agentService.spec.ts`, `commands/splashCommands.ts`, `bot.ts`, `index.ts`.

---

## Priority Matrix

| Priority | Items                                                     | Rationale                            |
| -------- | --------------------------------------------------------- | ------------------------------------ |
| P0       | #4 Typing, #12 MCP reconnect (both done)                  | Highest impact, lowest effort        |
| P1       | #2 Buttons, #10 Retry (both done)                         | Strong UX and reliability wins       |
| P1.5     | #6 Streaming (done)                                       | Biggest perceived-latency win        |
| P2       | #7 Abort, #8 Rate limit (both done)                       | Implemented with minimal refactoring |
| P3       | #5 Embeds, #3 `/sources`, #9 Health, #11 Cleanup (all done) | Nice-to-have, incremental value      |
