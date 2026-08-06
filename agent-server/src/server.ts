import express from 'express';
import type { Express } from 'express';
import type { AgentService } from './agent/agentService.js';
import { config } from './config.js';
import { createChatRouter } from './routes/chat.js';
import healthRouter from './routes/health.js';
import { createLogger } from './tools/logging.js';

const logger = createLogger('http-server');

export function createServer(agentService: AgentService): Express {
  const app = express();

  app.use(express.json());
  app.use('/api', healthRouter);
  app.use('/agent', createChatRouter(agentService));

  return app;
}

export function startServer(agentService: AgentService): Express {
  const app = createServer(agentService);
  const { port } = config.server;

  app.listen(port, () => {
    logger.log(`HTTP server listening on port ${port}`);
  });

  return app;
}
