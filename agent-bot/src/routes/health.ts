import type { Router } from 'express';
import { Router as createRouter } from 'express';

const router: Router = createRouter();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
