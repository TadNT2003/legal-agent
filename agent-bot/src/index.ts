import 'dotenv/config';
import { AgentService } from './agent/agentService.js';
import { createLlmClient } from './agent/llmClient.js';
import { startBot } from './bot.js';
import { config } from './config.js';
import { LawApiClient } from './lawApi/client.js';
import { startServer } from './server.js';
import { createLogger } from './tools/logging.js';

const logger = createLogger('index');

const lawApiClient = new LawApiClient(config.lawApi.baseUrl);
const agentService = new AgentService(
  createLlmClient(),
  config.llm.model,
  lawApiClient,
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
