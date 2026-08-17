import express from 'express';
import type { Express } from 'express';
import type { AgentService } from './agent/agentService.js';
import type { PgSessionStore } from './agent/pgSessionStore.js';
import { config } from './config.js';
import { createChatRouter } from './routes/chat.js';
import {
  createHealthRouter,
  type HealthChecks,
} from './routes/health.js';
import { createLogger } from './tools/logging.js';

const logger = createLogger('http-server');

export function createServer(
  agentService: AgentService,
  sessionStore: PgSessionStore,
  healthChecks: HealthChecks,
): Express {
  const app = express();

  app.use(express.json());
  app.use('/api', createHealthRouter(healthChecks));
  app.use('/agent', createChatRouter(agentService, sessionStore));

  return app;
}

export function startServer(
  agentService: AgentService,
  sessionStore: PgSessionStore,
  healthChecks: HealthChecks,
): Express {
  const app = createServer(agentService, sessionStore, healthChecks);
  const { port } = config.server;

  app.listen(port, () => {
    logger.log(`HTTP server listening on port ${port}`);
  });

  return app;
}