# Agent Bot — Recommendations

**Last updated:** 2026-08-12

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

### 3. `/sources` Command (Low effort — Medium impact)

List the documents the agent consulted during the current session, with clickable links. Legal users need to verify sources, and currently citations are buried in the text reply.

**Implementation:** Extract `citationId` / source references from the session's tool call history (stored in `session.messages`), format as an embed with hyperlinks.

### 4. ✅ Persistent Typing Indicator During Tool Calls — DONE (2026-08-13)

The bot sends a typing indicator on the initial message, but not during the multi-round tool-calling loop (which can take 40s+). Users may think the bot froze.

**Status: Implemented.** The `AgentService.chat()` method now accepts an optional `onProgress` callback that fires at three phases: `round_start`, `tool_call`, and `final_answer`. The Discord message handler (`messageCreate.ts`) uses this callback to send `channel.sendTyping()` on each tool call and round start, plus runs a `setInterval` (every 10s) as a safety net for long-running rounds. The interval is cleared in a `finally` block when the reply completes or an error occurs.

### 5. Embed-Based Replies (Medium effort — Medium impact)

Format agent answers as Discord embeds instead of plain text chunks. Use the embed description for the answer body, and a dedicated "📚 Nguồn" (Sources) field for citations. This is more readable and visually distinguishable from regular chat messages.

**Implementation:** In `messageCreate.ts`, replace `message.reply(chunk)` with `message.reply({ embeds: [embed] })`. Parse the reply text to separate answer from citations, or have `AgentService` return structured output.

---

## Internal Operations

### 6. Streaming Responses (High effort — Very High impact)

Currently the user waits 40s+ for the full reply. Use the OpenAI streaming API + Discord's edit-message pattern to show progressive output:

1. Send initial "Đang tra cứu..." message
2. On each tool call result, edit the message to show intermediate progress
3. On final answer, stream tokens and edit incrementally

This is the single biggest UX win for perceived latency.

**Implementation:** Switch `agentService.ts` to use `openai.chat.completions.create({ stream: true })`. Accumulate delta content, emit events. In `messageCreate.ts`, send an initial message, then `message.edit()` on each chunk.

### 7. Request Cancellation / Abort Handling (Medium effort — Medium impact)

If a user deletes their message or sends a new one while the agent is working, there's no cancellation. The old request continues consuming LLM tokens and time.

**Implementation:** Maintain a `Map<userId, AbortController>` in `messageCreate.ts`. On new message, call `abort()` on the previous controller for that user. Pass the `signal` to `openai.chat.completions.create()`.

### 8. Rate Limiting (Low effort — Medium impact)

Neither the HTTP endpoint nor the Discord handler has rate limiting. A simple token-bucket per user ID prevents abuse and protects the MCP/LLM backend.

**Implementation:** Add a small in-memory rate limiter (e.g., `sliding-window` counter per user ID, max N requests per minute). Reject with a polite message if exceeded. Apply to both `messageCreate.ts` and `routes/chat.ts`.

### 9. Enriched Health Endpoint (Low effort — Low impact)

The `/api/health` route only returns a timestamp. Add MCP connectivity status, DB connection status, active session count, and LLM model name. Useful for monitoring and for backing a future `/status` command with live data.

**Implementation:** In `routes/health.ts`, accept injected health checks: ping MCP with `listTools`, run `SELECT 1` on DB, read `sessionStore` size.

### 10. ✅ MCP Tool Call Retry Policy — DONE (2026-08-14)

When `callMcpTool` fails, it returns a JSON error string to the LLM which may then waste rounds retrying. Add a 1-retry with backoff at the transport level before surfacing the error to the agent loop.

**Status: Implemented.** The `callMcpTool` function in `mcp/tools.ts` now wraps the MCP client call in a try-catch. On transient transport errors (ECONNREFUSED, ECONNRESET, ETIMEDOUT, fetch failed, network), it waits 500ms and retries once. Non-transient errors (MCP-level `isError`, tool-not-found, etc.) pass through immediately without retry. Unit tests cover: retry on success, retry on double-fail, no retry for MCP errors, no retry for non-transient runtime errors.

**Files changed:** `mcp/tools.ts`, `mcp/tools.spec.ts`.

### 11. Session Cleanup (Low effort — Medium impact)

Sessions older than 7 days accumulate in Postgres with no cleanup. The `SESSION_STALE_MS` constant defines staleness for loading, but no deletion happens.

**Implementation:** On startup (or on a `setInterval`), run `DELETE FROM agent_sessions WHERE updated_at < cutoff`, which cascades to `agent_reply_targets` via the foreign key.

### 12. ✅ MCP Client Reconnection — DONE (2026-08-14)

`createMcpClient()` connects once at startup with no reconnection logic. If the MCP server restarts, the transport becomes a dead connection and all subsequent tool calls fail silently or with generic errors.

**Status: Implemented.** Added `ReconnectingMcpClient` wrapper class (`mcp/client.ts`) with two reconnection mechanisms:

1. **Try-reconnect on tool call**: Each `callTool()` wraps the underlying MCP client call in a try-catch. On connection-level errors (ECONNREFUSED, ECONNRESET, fetch failed, etc.), it re-creates the transport, reconnects, and retries the tool call once with a 2s backoff. Non-connection errors pass through unchanged.
2. **Periodic heartbeat**: A `listTools()` call runs every 60s. On failure, it triggers a proactive reconnect before any user request is impacted.

The `AgentService` constructor now takes an `McpToolCaller` function instead of a raw `Client`, decoupling it from the transport layer. Graceful shutdown (SIGTERM/SIGINT) stops the heartbeat and closes the transport cleanly.

**Files changed:** `mcp/client.ts`, `mcp/client.spec.ts`, `agent/agentService.ts`, `agent/agentService.spec.ts`, `commands/splashCommands.ts`, `bot.ts`, `index.ts`.

---

## Priority Matrix

| Priority | Items                                              | Rationale                       |
| -------- | -------------------------------------------------- | ------------------------------- |
| P0       | #4 Typing indicator, #12 MCP reconnect (both done)  | Highest impact, lowest effort   |
| P1       | #2 Buttons, #10 Retry (both done)                  | Strong UX and reliability wins  |
| P2       | #6 Streaming, #7 Abort, #8 Rate limit              | Requires more refactoring       |
| P3       | #3 `/sources`, #5 Embeds, #9 Health, #11 Cleanup | Nice-to-have, incremental value |
