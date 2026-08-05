export const VBPL_HOST = 'vbpl.vn';
export const DOCUMENT_PATH_PREFIX = '/van-ban/chi-tiet/';

// robots.txt disallows /api/ and /Pages/ only — this client must never touch
// them, even indirectly (e.g. by trying to replicate the site's internal
// Next.js Server Action data-fetching instead of rendering real pages).
export const DISALLOWED_PATH_PREFIXES = ['/api/', '/Pages/'];

export const REQUEST_USER_AGENT = 'legal-agent-law-index/1.0';
