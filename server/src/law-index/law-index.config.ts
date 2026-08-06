import { registerAs } from '@nestjs/config';

// Encodes the trung-ương-only scope decision as an overridable setting
// rather than a hardcoded constant — tiers 1-9 (Điều 4, Luật 64/2025/QH15)
// have nationwide effect; tiers 10-14 (địa phương) don't and are out of
// scope for this ingestion path.
export const lawIndexConfig = registerAs('lawIndex', () => ({
  vbplBaseUrl: process.env.VBPL_BASE_URL ?? 'https://vbpl.vn',
  maxTier: parseInt(process.env.LAW_INDEX_MAX_TIER ?? '9', 10),
  requestDelayMs: parseInt(
    process.env.LAW_INDEX_REQUEST_DELAY_MS ?? '1000',
    10,
  ),
  headless: (process.env.LAW_INDEX_HEADLESS ?? 'true') !== 'false',
  browserRecycleInterval: parseInt(
    process.env.LAW_INDEX_BROWSER_RECYCLE_INTERVAL ?? '20',
    10,
  ),
}));
