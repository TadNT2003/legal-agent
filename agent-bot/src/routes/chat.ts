import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { AgentService } from '../agent/agentService.js';
import type { PgSessionStore } from '../agent/pgSessionStore.js';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('chat-route');

export function createChatRouter(
  agentService: AgentService,
  sessionStore: PgSessionStore,
): Router {
  const router = createRouter();

  router.post('/chat', (req, res) => {
    void handleChat(agentService, sessionStore, req, res);
  });

  return router;
}

async function handleChat(
  agentService: AgentService,
  sessionStore: PgSessionStore,
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.body as { message?: unknown; sessionId?: unknown };
  const message: unknown = body.message;
  const sessionId: unknown = body.sessionId;

  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'message must be a non-empty string' });
    return;
  }

  let session;
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    // Try to find existing session by ID; fall back to creating a new one.
    session = sessionStore.getById(sessionId);
    if (!session) {
      session = sessionStore.createSession(sessionId, 'http');
    }
  } else {
    // Stateless mode — each call starts a fresh conversation.
    session = sessionStore.createSession();
  }

  try {
    const result = await agentService.chat(session.messages, message);
    await sessionStore.update(session, result.messages);
    res.json({
      reply: result.reply,
      sessionId: session.id,
    });
  } catch (error) {
    logger.error('AgentService.chat failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
