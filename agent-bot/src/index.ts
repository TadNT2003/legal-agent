import 'dotenv/config';
import { AgentService } from './agent/agentService.js';
import { createLlmClient } from './agent/llmClient.js';
import { startBot } from './bot.js';
import { config } from './config.js';
import { createMcpClient } from './mcp/client.js';
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
  const tools = await listOpenAiTools(mcpClient);
  const guidance = await fetchPromptText(mcpClient, 'legal_lookup_guidance');
  const systemPrompt = `${SYSTEM_PROMPT_INTRO}\n\n${guidance}`;

  const agentService = new AgentService(
    createLlmClient(),
    config.llm.model,
    mcpClient,
    tools,
    systemPrompt,
  );

  startServer(agentService);

  // Non-fatal: a bad/expired Discord token shouldn't take down POST
  // /agent/chat, which is meant to work standalone as a manual test path.
  try {
    await startBot(agentService);
  } catch (error) {
    logger.error(
      'Discord login failed — bot will not respond, but the HTTP server still runs',
      error,
    );
  }
}

main().catch((error: unknown) => {
  logger.error(
    'Fatal startup error — is legal-mcp running? check MCP_SERVER_URL',
    error,
  );
  process.exit(1);
});
