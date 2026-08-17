import 'dotenv/config';
import { AgentService } from './agent/agentService.js';
import { createLlmClient } from './agent/llmClient.js';
import { PgSessionStore } from './agent/pgSessionStore.js';
import { startBot } from './bot.js';
import { closeDb, createDb } from './db/connection.js';
import { config } from './config.js';
import { createMcpClient, ReconnectingMcpClient } from './mcp/client.js';
import { fetchPromptText, listOpenAiTools } from './mcp/tools.js';
import { startServer } from './server.js';
import type { HealthChecks } from './routes/health.js';
import { createLogger } from './tools/logging.js';

const logger = createLogger('index');

const SYSTEM_PROMPT_INTRO =
  'Bạn là trợ lý tra cứu văn bản pháp luật Việt Nam, sử dụng các công cụ (tools) do legal-mcp cung cấp.';

// How often to purge sessions idle for longer than SESSION_STALE_MS (7 days).
// Hourly keeps the table bounded without hammering Postgres; the exact value
// is not load-bearing.
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  // Fatal on failure, unlike the Discord login below: there is no useful
  // degraded mode without any tools to call.
  const mcpClient = await createMcpClient();
  const reconnectingClient = new ReconnectingMcpClient(mcpClient);
  reconnectingClient.startHeartbeat();
  const tools = await listOpenAiTools(mcpClient);
  const guidance = await fetchPromptText(mcpClient, 'legal_lookup_guidance');
  const systemPrompt = `${SYSTEM_PROMPT_INTRO}\n\n${guidance}`;

  // Set up DB-backed session store
  const { db, pool } = createDb(config.db);
  const sessionStore = new PgSessionStore(db);

  try {
    await sessionStore.loadActiveSessions();
  } catch (error) {
    logger.error('Failed to load active sessions from DB — starting fresh', error);
  }

  // Purge stale sessions once at startup, then on a periodic schedule
  // (feature #11). cleanupStaleSessions never throws, so the interval is safe.
  void sessionStore.cleanupStaleSessions();
  const cleanupTimer = setInterval(() => {
    void sessionStore.cleanupStaleSessions();
  }, SESSION_CLEANUP_INTERVAL_MS);
  // Don't let the cleanup timer keep the process alive on its own.
  cleanupTimer.unref?.();

  const agentService = new AgentService(
    createLlmClient(),
    config.llm.model,
    reconnectingClient.callTool.bind(reconnectingClient),
    tools,
    systemPrompt,
  );

  // Live health checks, injected into the /api/health route (feature #9).
  const healthChecks: HealthChecks = {
    mcp: () => reconnectingClient.listTools().then(() => undefined),
    db: async () => {
      const result = await pool.query('SELECT 1');
      if (!result.rows.length) {
        throw new Error('DB SELECT 1 returned no rows');
      }
    },
    sessionCount: () => sessionStore.getActiveCount(),
    model: config.llm.model,
  };

  startServer(agentService, sessionStore, healthChecks);

  // Non-fatal: a bad/expired Discord token shouldn't take down POST
  // /agent/chat, which is meant to work standalone as a manual test path.
  try {
    await startBot(agentService, sessionStore, reconnectingClient, config.discord.token);
  } catch (error) {
    logger.error(
      'Discord login failed — bot will not respond, but the HTTP server still runs',
      error,
    );
  }

  // Graceful shutdown: stop the session-cleanup timer, close DB pool and MCP heartbeat
  const shutdown = (signal: string): void => {
    logger.log(`${signal} received — shutting down`);
    clearInterval(cleanupTimer);
    reconnectingClient.stopHeartbeat();
    void reconnectingClient.close();
    void closeDb(pool);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error(
    'Fatal startup error — is legal-mcp running? check MCP_SERVER_URL',
    error,
  );
  process.exit(1);
});
