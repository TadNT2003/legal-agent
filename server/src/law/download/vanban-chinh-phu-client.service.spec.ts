import {
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { VanBanChinhPhuClientService } from './vanban-chinh-phu-client.service';
import {
  REQUEST_USER_AGENT,
  VANBANCHINHPHU_BASE_URL,
  SEARCH_PAGE_PATH,
} from './constants';

describe('VanBanChinhPhuClientService', () => {
  let service: VanBanChinhPhuClientService;

  beforeEach(() => {
    service = new VanBanChinhPhuClientService();
    (service as any).lastRequestAt = Date.now() - 10000;
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
        service.assertTrustedPageUrl(
          'https://evil.com/?pageid=27160&docid=203914',
        ),
      ).toThrow('Only https://vanban.chinhphu.vn URLs are accepted');
    });

    it('rejects an invalid URL string', () => {
      expect(() =>
        service.assertTrustedPageUrl('not-a-url'),
      ).toThrow('Not a valid URL');
    });

    it('rejects subdomain of vanban.chinhphu.vn', () => {
      expect(() =>
        service.assertTrustedPageUrl(
          'https://subdomain.vanban.chinhphu.vn/',
        ),
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
        service.assertTrustedFileUrl(
          'http://datafiles.chinhphu.vn/x/bldd.pdf',
        ),
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

  describe('fetchSearchPage', () => {
    it('returns page text on success', async () => {
      const mockBody = '<html>search page content</html>';
      const mockResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(mockBody),
      } as unknown as Response;

      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      const result = await service.fetchSearchPage();

      expect(result).toBe(mockBody);
      expect(global.fetch).toHaveBeenCalledWith(
        `${VANBANCHINHPHU_BASE_URL}${SEARCH_PAGE_PATH}`,
        {
          headers: { 'User-Agent': REQUEST_USER_AGENT },
        },
      );
      expect(mockResponse.text).toHaveBeenCalled();
    });

    it('throws BadGatewayException on HTTP error', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      await expect(service.fetchSearchPage()).rejects.toThrow(
        'Failed to load search page: HTTP 404',
      );
    });
  });

  describe('postSearch', () => {
    it('returns response text on success', async () => {
      const mockBody = '<html>search results</html>';
      const mockResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(mockBody),
      } as unknown as Response;

      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      const fields = { keyword: 'test', year: '2024' };
      const result = await service.postSearch(fields);

      expect(result).toBe(mockBody);
      expect(global.fetch).toHaveBeenCalledWith(
        `${VANBANCHINHPHU_BASE_URL}${SEARCH_PAGE_PATH}`,
        {
          method: 'POST',
          headers: {
            'User-Agent': REQUEST_USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'keyword=test&year=2024',
        },
      );
    });

    it('throws BadGatewayException on HTTP error', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      await expect(service.postSearch({ keyword: 'test' })).rejects.toThrow(
        'Search request failed: HTTP 500',
      );
    });
  });

  describe('fetchDocumentPage', () => {
    const validUrl = 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914';

    it('returns page text on success', async () => {
      const mockBody = '<html>document page</html>';
      const mockResponse = {
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(mockBody),
      } as unknown as Response;

      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      const result = await service.fetchDocumentPage(validUrl);

      expect(result).toBe(mockBody);
      expect(global.fetch).toHaveBeenCalledWith(validUrl, {
        headers: { 'User-Agent': REQUEST_USER_AGENT },
      });
    });

    it('throws BadRequestException for invalid URL', async () => {
      await expect(
        service.fetchDocumentPage('https://evil.com/page'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadGatewayException on HTTP error', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(''),
      } as unknown as Response;

      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      await expect(service.fetchDocumentPage(validUrl)).rejects.toThrow(
        `Failed to load document page ${validUrl}: HTTP 404`,
      );
    });
  });

  describe('fetchFile', () => {
    const validFileUrl = 'https://datafiles.chinhphu.vn/x/bldd.pdf';

    it('returns response on success', async () => {
      const mockBody = new Uint8Array([1, 2, 3]);
      const mockResponse = {
        ok: true,
        status: 200,
        body: mockBody,
      } as unknown as Response;

      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      const result = await service.fetchFile(validFileUrl);

      expect(result).toBe(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(validFileUrl, {
        headers: { 'User-Agent': REQUEST_USER_AGENT },
      });
    });

    it('throws BadGatewayException for untrusted file URL', async () => {
      await expect(
        service.fetchFile('https://evil.com/malware.exe'),
      ).rejects.toThrow('Refusing to download file from untrusted host');
    });

    it('throws BadGatewayException when response has no body', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response;

      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      await expect(service.fetchFile(validFileUrl)).rejects.toThrow(
        `Failed to download file ${validFileUrl}: HTTP 200`,
      );
    });
  });
});