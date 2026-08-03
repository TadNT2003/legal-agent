import { VbplClientService } from './vbpl-client.service';

const MOCK_CONFIG = {
  vbplBaseUrl: 'https://vbpl.vn',
  maxTier: 9,
  requestDelayMs: 100,
  headless: true,
};

describe('VbplClientService', () => {
  let service: VbplClientService;

  beforeEach(() => {
    service = new VbplClientService(MOCK_CONFIG as any);
  });

  describe('assertTrustedDocumentUrl', () => {
    it('accepts a valid vbpl.vn URL', () => {
      const url = service.assertTrustedDocumentUrl(
        'https://vbpl.vn/van-ban/chi-tiet/123',
      );
      expect(url.hostname).toBe('vbpl.vn');
    });

    it('accepts a valid vbpl.vn document URL with query params', () => {
      const url = service.assertTrustedDocumentUrl(
        'https://vbpl.vn/GetLawDetail?tempLawsId=123',
      );
      expect(url.hostname).toBe('vbpl.vn');
    });

    it('rejects a non-https URL', () => {
      expect(() =>
        service.assertTrustedDocumentUrl('http://vbpl.vn/van-ban/chi-tiet/1'),
      ).toThrow('Only https://vbpl.vn URLs are accepted');
    });

    it('rejects a different host', () => {
      expect(() =>
        service.assertTrustedDocumentUrl('https://evil.com/phish'),
      ).toThrow('Only https://vbpl.vn URLs are accepted');
    });

    it('rejects an invalid URL string', () => {
      expect(() =>
        service.assertTrustedDocumentUrl('not-a-url'),
      ).toThrow('Not a valid URL');
    });

    it('rejects /api/ disallowed path', () => {
      expect(() =>
        service.assertTrustedDocumentUrl('https://vbpl.vn/api/data'),
      ).toThrow('robots.txt-disallowed path');
    });

    it('rejects /Pages/ disallowed path', () => {
      expect(() =>
        service.assertTrustedDocumentUrl('https://vbpl.vn/Pages/Handler.ashx'),
      ).toThrow('robots.txt-disallowed path');
    });

    it('allows paths that merely contain disallowed substrings but do not start with them', () => {
      expect(() =>
        service.assertTrustedDocumentUrl('https://vbpl.vn/van-ban/api-docs'),
      ).not.toThrow();
    });
  });
});