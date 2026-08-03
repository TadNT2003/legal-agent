import { VanBanChinhPhuClientService } from './vanban-chinh-phu-client.service';

describe('VanBanChinhPhuClientService', () => {
  let service: VanBanChinhPhuClientService;

  beforeEach(() => {
    service = new VanBanChinhPhuClientService();
  });

  describe('assertTrustedPageUrl', () => {
    it('accepts a valid vanban.chinhphu.vn URL', () => {
      const url = service.assertTrustedPageUrl(
        'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
      );
      expect(url.hostname).toBe('vanban.chinhphu.vn');
    });

    it('rejects a non-https URL', () => {
      expect(() =>
        service.assertTrustedPageUrl(
          'http://vanban.chinhphu.vn/?pageid=27160&docid=203914',
        ),
      ).toThrow('Only https://vanban.chinhphu.vn URLs are accepted');
    });

    it('rejects a different host', () => {
      expect(() =>
        service.assertTrustedPageUrl('https://evil.com/?pageid=27160&docid=203914'),
      ).toThrow('Only https://vanban.chinhphu.vn URLs are accepted');
    });

    it('rejects an invalid URL string', () => {
      expect(() =>
        service.assertTrustedPageUrl('not-a-url'),
      ).toThrow('Not a valid URL');
    });

    it('rejects subdomain of vanban.chinhphu.vn', () => {
      expect(() =>
        service.assertTrustedPageUrl('https://subdomain.vanban.chinhphu.vn/'),
      ).toThrow('Only https://vanban.chinhphu.vn URLs are accepted');
    });
  });

  describe('assertTrustedFileUrl', () => {
    it('accepts a datafiles.chinhphu.vn URL', () => {
      const url = service.assertTrustedFileUrl(
        'https://datafiles.chinhphu.vn/x/bldd.pdf',
      );
      expect(url.hostname).toBe('datafiles.chinhphu.vn');
    });

    it('accepts a files.chinhphu.vn URL', () => {
      const url = service.assertTrustedFileUrl(
        'https://files.chinhphu.vn/x/doc.pdf',
      );
      expect(url.hostname).toBe('files.chinhphu.vn');
    });

    it('rejects a non-https file URL', () => {
      expect(() =>
        service.assertTrustedFileUrl('http://datafiles.chinhphu.vn/x/bldd.pdf'),
      ).toThrow('Refusing to download file from untrusted host');
    });

    it('rejects an untrusted host', () => {
      expect(() =>
        service.assertTrustedFileUrl('https://evil.com/malware.exe'),
      ).toThrow('Refusing to download file from untrusted host');
    });

    it('rejects an invalid URL string', () => {
      expect(() =>
        service.assertTrustedFileUrl('not-a-url'),
      ).toThrow('vanban.chinhphu.vn linked to an invalid file URL');
    });
  });
});