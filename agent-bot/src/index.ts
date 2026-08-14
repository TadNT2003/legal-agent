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
import { createLogger } from './tools/logging.js';

const logger = createLogger('index');

const SYSTEM_PROMPT_INTRO =
  'Bạn là trợ lý tra cứu văn bản pháp luật Việt Nam, sử dụng các công cụ (tools) do legal-mcp cung cấp.';

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

  const agentService = new AgentService(
    createLlmClient(),
    config.llm.model,
    reconnectingClient.callTool.bind(reconnectingClient),
    tools,
    systemPrompt,
  );

  startServer(agentService, sessionStore);

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

  // Graceful shutdown: close DB pool and MCP heartbeat
  process.on('SIGTERM', () => {
    logger.log('SIGTERM received — shutting down');
    reconnectingClient.stopHeartbeat();
    void reconnectingClient.close();
    void closeDb(pool);
    process.exit(0);
  });
  process.on('SIGINT', () => {
    logger.log('SIGINT received — shutting down');
    reconnectingClient.stopHeartbeat();
    void reconnectingClient.close();
    void closeDb(pool);
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  logger.error(
    'Fatal startup error — is legal-mcp running? check MCP_SERVER_URL',
    error,
  );
  process.exit(1);
});
