import { VbplSitemapService } from './vbpl-sitemap.service';

const MOCK_CONFIG = {
  vbplBaseUrl: 'https://vbpl.vn',
  maxTier: 9,
  requestDelayMs: 0,
  headless: true,
};

jest.mock('cheerio', () => ({
  load: jest.fn(() => {
    const mock$ = jest.fn();
    return mock$;
  }),
}));

function setupMockLoc(urls: string[]) {
  const mockChain: any = {
    map: () => mockChain,
    get: () => urls,
    filter: () => mockChain,
  };
  const cheerio = require('cheerio') as { load: jest.Mock };
  const mock$: any = jest.fn().mockReturnValue(mockChain);
  cheerio.load.mockReturnValue(mock$);
}

describe('VbplSitemapService', () => {
  let service: VbplSitemapService;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    (global as any).fetch = mockFetch;
    jest.clearAllMocks();
    service = new VbplSitemapService(MOCK_CONFIG as any);
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  describe('fetchTrungUongSitemapUrls', () => {
    it('extracts URLs from Trung uong block', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(`<?xml version="1.0"?>
            <sitemapindex>
              <!-- Trung ương -->
              <sitemap><loc>https://vbpl.vn/sitemap-1.xml</loc></sitemap>
              <sitemap><loc>https://vbpl.vn/sitemap-2.xml</loc></sitemap>
              <!-- Địa phương -->
              <sitemap><loc>https://vbpl.vn/sitemap-3.xml</loc></sitemap>
            </sitemapindex>`),
      });

      setupMockLoc(['https://vbpl.vn/sitemap-1.xml', 'https://vbpl.vn/sitemap-2.xml']);

      const urls = await service.fetchTrungUongSitemapUrls();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vbpl.vn/sitemap.xml',
        expect.any(Object),
      );
      expect(urls).toContain('https://vbpl.vn/sitemap-1.xml');
      expect(urls).toContain('https://vbpl.vn/sitemap-2.xml');
    });

    it('throws when Trung uong marker is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<?xml version="1.0"?><sitemapindex></sitemapindex>'),
      });

      setupMockLoc([]);

      await expect(service.fetchTrungUongSitemapUrls()).rejects.toThrow(/marker.*index structure/);
    });
  });

  describe('fetchDocumentUrls', () => {
    it('extracts document URLs from a sub-sitemap', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(`<?xml version="1.0"?>
            <urlset>
              <url><loc>https://vbpl.vn/GetLawDetail?tempLawsId=1</loc></url>
              <url><loc>https://vbpl.vn/GetLawDetail?tempLawsId=2</loc></url>
            </urlset>`),
      });

      setupMockLoc([
        'https://vbpl.vn/GetLawDetail?tempLawsId=1',
        'https://vbpl.vn/GetLawDetail?tempLawsId=2',
      ]);

      const urls = await service.fetchDocumentUrls('https://vbpl.vn/sitemap-1.xml');

      expect(urls).toContain('https://vbpl.vn/GetLawDetail?tempLawsId=1');
      expect(urls).toContain('https://vbpl.vn/GetLawDetail?tempLawsId=2');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await expect(
        service.fetchDocumentUrls('https://vbpl.vn/sitemap-1.xml'),
      ).rejects.toThrow('Failed to fetch sitemap');
    });

    it('returns empty array for empty sitemap', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<?xml version="1.0"?><urlset></urlset>'),
      });

      setupMockLoc([]);

      const urls = await service.fetchDocumentUrls('https://vbpl.vn/sitemap-empty.xml');
      expect(urls).toEqual([]);
    });
  });
});