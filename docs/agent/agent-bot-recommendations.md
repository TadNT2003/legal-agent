# Agent Bot — Recommendations

**Last updated:** 2026-08-12

Improvement recommendations for the Discord legal agent (`agent-bot/`), grouped by UX (user-facing Discord experience) and internal operations. Items are ordered by impact vs. effort.

---

## UX / Discord-Facing

### 1. `/search` Slash Command (Medium effort — High impact)

A structured search command with optional fields: `keyword`, `documentType`, `issuingBody`, `validityStatus`. Gives users a form-based alternative to free-text questions, useful for those who know exactly what document type they want.

**Implementation:** Add a new `SlashCommandBuilder` with `addStringOption` for each field, route to a dedicated handler that calls the MCP `search_documents` tool directly and formats results as an embed.

### 2. Interactive Follow-Up Buttons (Medium effort — High impact)

After the agent replies, attach Discord `ButtonComponent` components:

- **"Tra cứu thêm"** — Prompt the user for a follow-up keyword, continuing the same session.
- **"Chi tiết"** — Show raw citations and source links.
- **"Kết thúc"** — Close the session.

This turns a flat text reply into a navigable conversation without requiring users to know how to phrase follow-ups.

**Implementation:** Use `ActionRowBuilder` + `ButtonBuilder` with `ComponentType.Button`. Listen on `Events.InteractionCreate` for `isButton()`.

### 3. `/sources` Command (Low effort — Medium impact)

List the documents the agent consulted during the current session, with clickable links. Legal users need to verify sources, and currently citations are buried in the text reply.

**Implementation:** Extract `citationId` / source references from the session's tool call history (stored in `session.messages`), format as an embed with hyperlinks.

### 4. Persistent Typing Indicator During Tool Calls (Low effort — High impact)

The bot sends a typing indicator on the initial message, but not during the multi-round tool-calling loop (which can take 40s+). Users may think the bot froze.

**Implementation:** In `agentService.ts`, emit a hook or callback at the start/end of each round. In `messageCreate.ts`, start a `setInterval` that calls `channel.sendTyping()` every ~10s, and clear it when the reply arrives.

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

### 10. MCP Tool Call Retry Policy (Low effort — Medium impact)

When `callMcpTool` fails, it returns a JSON error string to the LLM which may then waste rounds retrying. Add a 1-retry with backoff at the transport level before surfacing the error to the agent loop.

**Implementation:** In `mcp/tools.ts`, wrap `client.callTool()` in a try-catch with one retry after a short delay (e.g., 500ms). Distinguish transient errors (network, timeout) from permanent ones.

### 11. Session Cleanup (Low effort — Medium impact)

Sessions older than 7 days accumulate in Postgres with no cleanup. The `SESSION_STALE_MS` constant defines staleness for loading, but no deletion happens.

**Implementation:** On startup (or on a `setInterval`), run `DELETE FROM agent_sessions WHERE updated_at < cutoff`, which cascades to `agent_reply_targets` via the foreign key.

### 12. MCP Client Reconnection (Medium effort — High impact)

`createMcpClient()` connects once at startup with no reconnection logic. If the MCP server restarts, the transport becomes a dead connection and all subsequent tool calls fail silently or with generic errors.

**Implementation:** Add a periodic heartbeat (e.g., `listTools` every 60s). On failure, reconnect the transport and retry. Alternatively, wrap `callMcpTool` in a try-reconnect pattern: on connection error, re-create the client transport, then retry the tool call once.

---

## Priority Matrix

| Priority | Items                                    | Rationale                           |
|----------|------------------------------------------|-------------------------------------|
| P0       | #4 Typing indicator, #12 MCP reconnect   | Highest impact, lowest effort       |
| P1       | #1 `/search`, #2 Buttons, #10 Retry      | Strong UX and reliability wins      |
| P2       | #6 Streaming, #7 Abort, #8 Rate limit    | Requires more refactoring           |
| P3       | #3 `/sources`, #5 Embeds, #9 Health, #11 Cleanup | Nice-to-have, incremental value |