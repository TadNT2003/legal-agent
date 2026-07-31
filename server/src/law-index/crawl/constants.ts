export const VBPL_HOST = 'vbpl.vn';
export const DOCUMENT_PATH_PREFIX = '/van-ban/chi-tiet/';

// The Ministry of Justice's MinIO-backed object storage gateway vbpl.vn's own
// PDF viewer fetches "Văn bản gốc" scanned-original files from — confirmed
// live (network-captured requests) across multiple documents. Public,
// unauthenticated, government-operated (same family as vbpl.vn itself).
export const VBPL_ORIGINAL_DOCUMENT_HOST =
  'vbpl-bientap-gateway.moj.gov.vn';

// robots.txt disallows /api/ and /Pages/ only — this client must never touch
// them, even indirectly (e.g. by trying to replicate the site's internal
// Next.js Server Action data-fetching instead of rendering real pages).
export const DISALLOWED_PATH_PREFIXES = ['/api/', '/Pages/'];

export const REQUEST_USER_AGENT = 'legal-agent-law-index/1.0';
