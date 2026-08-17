import { describe, expect, it, jest } from '@jest/globals';
import type { Router } from 'express';
import { createHealthRouter, type HealthChecks } from './health.js';

function buildRouter(overrides: Partial<HealthChecks> = {}) {
  const checks: HealthChecks = {
    mcp: async () => {},
    db: async () => {},
    sessionCount: () => 3,
    model: 'test-model',
    ...overrides,
  };
  return { router: createHealthRouter(checks), checks };
}

/** Minimal express req/res that captures status + json output. */
function makeRes() {
  const res = {
    statusCode: 200 as number,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res;
}

/** Drives the single GET /health route registered on the router. */
async function hitHealth(router: Router): Promise<ReturnType<typeof makeRes>> {
  const layer = router.stack.find((l) => l.route?.path === '/health');
  const handler = layer?.route?.stack[0]?.handle as
    | ((req: unknown, res: unknown) => Promise<unknown>)
    | undefined;
  if (!handler) throw new Error('GET /health route not found');
  const res = makeRes();
  await handler({}, res);
  return res;
}

describe('createHealthRouter', () => {
  it('reports ok for all checks with a 200 status', async () => {
    const { router } = buildRouter();
    const res = await hitHealth(router);

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.checks).toMatchObject({
      mcp: { status: 'ok' },
      db: { status: 'ok' },
      sessions: 3,
      model: 'test-model',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('reports degraded + 503 when the MCP check fails', async () => {
    const { router } = buildRouter({
      mcp: () => Promise.reject(new Error('fetch failed')),
    });
    const res = await hitHealth(router);

    expect(res.statusCode).toBe(503);
    const body = res.body as {
      status: string;
      checks: { mcp: { status: string; detail?: string }; db: { status: string } };
    };
    expect(body.status).toBe('degraded');
    expect(body.checks.mcp.status).toBe('down');
    expect(body.checks.mcp.detail).toBe('fetch failed');
    expect(body.checks.db.status).toBe('ok');
  });

  it('reports degraded + 503 when the DB check rejects', async () => {
    const { router } = buildRouter({
      db: () => Promise.reject(new Error('connection refused')),
    });
    const res = await hitHealth(router);

    expect(res.statusCode).toBe(503);
    const body = res.body as {
      status: string;
      checks: { db: { status: string; detail?: string } };
    };
    expect(body.status).toBe('degraded');
    expect(body.checks.db.status).toBe('down');
    expect(body.checks.db.detail).toBe('connection refused');
  });

  it('reports degraded when both MCP and DB are down', async () => {
    const { router } = buildRouter({
      mcp: () => Promise.reject(new Error('mcp down')),
      db: () => Promise.reject(new Error('db down')),
    });
    const res = await hitHealth(router);

    expect(res.statusCode).toBe(503);
    const body = res.body as { status: string };
    expect(body.status).toBe('degraded');
  });

  it('does not throw when a check rejects — it degrades gracefully', async () => {
    const mcpSpy = jest.fn(() => Promise.reject(new Error('boom')));
    const { router } = buildRouter({ mcp: mcpSpy });

    await expect(hitHealth(router)).resolves.toBeDefined();
    expect(mcpSpy).toHaveBeenCalledTimes(1);
  });

  it('runs the MCP and DB checks concurrently (both are called)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const track = (fn: () => Promise<void>) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      await fn();
      inFlight--;
    };
    const { router } = buildRouter({
      mcp: track(async () => {}),
      db: track(async () => {}),
    });

    await hitHealth(router);
    expect(maxInFlight).toBe(2);
  });
});