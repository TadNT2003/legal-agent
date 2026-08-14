import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import type { AgentService } from '../agent/agentService.js';
import type { PgSessionStore } from '../agent/pgSessionStore.js';
import type { RateLimiter } from '../utils/rateLimiter.js';
import { createLogger } from '../tools/logging.js';
import { createRateLimiter } from '../utils/rateLimiter.js';

const logger = createLogger('chat-route');
const rateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
});

export function createChatRouter(
  agentService: AgentService,
  sessionStore: PgSessionStore,
): Router {
  const router = createRouter();

  router.post('/chat', (req, res) => {
    void handleChat(agentService, sessionStore, rateLimiter, req, res);
  });

  return router;
}

async function handleChat(
  agentService: AgentService,
  sessionStore: PgSessionStore,
  limiter: RateLimiter,
  req: Request,
  res: Response,
): Promise<void> {
  const clientIp = (req.headers['x-forwarded-for'] as string ?? req.socket.remoteAddress) ?? 'unknown';
  const rateResult = limiter.check(clientIp);
  if (!rateResult.allowed) {
    const waitSeconds = Math.ceil((rateResult.resetAt - Date.now()) / 1000);
    res.status(429).json({
      error: `Rate limit exceeded. Try again in ${waitSeconds} seconds.`,
    });
    return;
  }

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
    // No real discordUserId/discordChannelId exists for an HTTP-originated
    // session, so this is the same no-args call as the stateless branch
    // below — sessionId is a lookup key here, never a value to persist.
    session = await sessionStore.getById(sessionId);
    if (!session) {
      session = sessionStore.createSession();
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
