export const VANBANCHINHPHU_HOST = 'vanban.chinhphu.vn';
export const VANBANCHINHPHU_BASE_URL = `https://${VANBANCHINHPHU_HOST}`;
export const SEARCH_PAGE_PATH = '/?pageid=41852&mode=0';

// Files are linked from vanban.chinhphu.vn but actually served off this CDN
// subdomain. Every file URL is extracted from vanban.chinhphu.vn's own HTML,
// never taken directly from caller input — this suffix check is defense in
// depth, not the primary trust boundary.
export const TRUSTED_FILE_HOST_SUFFIX = '.chinhphu.vn';

export const REQUEST_USER_AGENT = 'legal-agent-law-downloader/1.0';

// Minimum delay between sequential requests to vanban.chinhphu.vn, so batch
// and search-driven downloads don't hammer a shared government server.
export const REQUEST_DELAY_MS = 400;

export const ALLOWED_RECORDS_PER_PAGE = [50, 100, 200, 500] as const;
// The site always renders ~50 rows per response regardless of this value,
// but a larger value makes its reported total-results count accurate rather
// than clamped to 50 (see law-download.service.ts downloadBySearch) — so
// default to the max the dropdown supports rather than its smallest option.
export const DEFAULT_RECORDS_PER_PAGE = 500;
export const DEFAULT_MAX_RESULTS = 50;
export const MAX_ALLOWED_RESULTS = 500;
