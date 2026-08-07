import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { AgentService } from '../agent/agentService.js';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('chat-route');

/** Manual test path — bypasses Discord entirely. */
export function createChatRouter(agentService: AgentService): Router {
  const router = createRouter();

  router.post('/chat', (req, res) => {
    void handleChat(agentService, req, res);
  });

  return router;
}

async function handleChat(
  agentService: AgentService,
  req: Request,
  res: Response,
): Promise<void> {
  const message: unknown = (req.body as { message?: unknown })?.message;
  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message must be a non-empty string' });
    return;
  }

  try {
    const reply = await agentService.chat(message);
    res.json({ reply });
  } catch (error) {
    logger.error('AgentService.chat failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
