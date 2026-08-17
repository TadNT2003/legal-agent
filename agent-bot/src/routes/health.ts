import type { Router } from 'express';
import { Router as createRouter } from 'express';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('health-route');

type ComponentStatus = 'ok' | 'down';
type OverallStatus = 'ok' | 'degraded';

interface ComponentHealth {
  status: ComponentStatus;
  detail?: string;
}

export interface HealthChecks {
  /** Ping the MCP server (listTools). */
  mcp: () => Promise<void>;
  /** Ping Postgres (SELECT 1). */
  db: () => Promise<void>;
  /** Number of active sessions in the in-memory store. */
  sessionCount: () => number;
  /** LLM model name in use. */
  model: string;
}

function safeCheck(
  name: string,
  check: () => Promise<void>,
): Promise<ComponentHealth> {
  return check()
    .then(() => ({ status: 'ok' as ComponentStatus }))
    .catch((error) => {
      logger.error(`Health check ${name} failed`, error);
      return {
        status: 'down' as ComponentStatus,
        detail: error instanceof Error ? error.message : String(error),
      };
    });
}

/**
 * Builds the /health router. Health checks are injected (not imported) so the
 * route can be unit-tested with fakes and so each dependency degrades to
 * `down` independently instead of taking the whole endpoint with it.
 */
export function createHealthRouter(checks: HealthChecks): Router {
  const router = createRouter();

  router.get('/health', async (_req, res) => {
    const [mcp, db] = await Promise.all([
      safeCheck('mcp', checks.mcp),
      safeCheck('db', checks.db),
    ]);

    const overall: OverallStatus =
      mcp.status === 'ok' && db.status === 'ok' ? 'ok' : 'degraded';

    res.status(overall === 'ok' ? 200 : 503).json({
      status: overall,
      timestamp: new Date().toISOString(),
      checks: {
        mcp,
        db,
        sessions: checks.sessionCount(),
        model: checks.model,
      },
    });
  });

  return router;
}

export default createHealthRouter;