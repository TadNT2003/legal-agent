jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
} from '@nestjs/common';
import { chromium } from 'playwright';
import { VbplClientService } from './vbpl-client.service';

const MOCK_CONFIG = {
  vbplBaseUrl: 'https://vbpl.vn',
  maxTier: 9,
  requestDelayMs: 100,
  headless: true,
  browserRecycleInterval: 20,
};

function createMockResponse(ok = true, status = ok ? 200 : 502) {
  return {
    ok: () => ok,
    status: () => status,
  };
}

function createMockPage() {
  const listeners: Record<string, Function[]> = {};
  const mockPage: any = {
    on: jest.fn((event: string, handler: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    off: jest.fn((event: string, handler: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    }),
    goto: jest.fn().mockResolvedValue(createMockResponse()),
    evaluate: jest.fn(),
    waitForSelector: jest.fn().mockResolvedValue({}),
    waitForTimeout: jest.fn().mockResolvedValue(void 0),
    getByPlaceholder: jest.fn().mockReturnValue({ fill: jest.fn() }),
    getByRole: jest.fn().mockReturnValue({
      check: jest.fn(),
      click: jest.fn(),
      last: jest.fn().mockReturnValue({ click: jest.fn() }),
    }),
    getByText: jest.fn().mockReturnValue({
      locator: jest.fn().mockReturnValue({ click: jest.fn() }),
    }),
    locator: jest.fn().mockReturnValue({
      click: jest.fn(),
      locator: jest.fn().mockReturnValue({
        click: jest.fn(),
        fill: jest.fn(),
        press: jest.fn(),
      }),
      waitFor: jest.fn().mockResolvedValue(void 0),
      fill: jest.fn(),
      press: jest.fn(),
      nth: jest.fn().mockReturnValue({ fill: jest.fn() }),
      // Used by fetchOriginalDocumentUrls's "Văn bản gốc" tab handling —
      // .first().click() to expand the collapse panel, .count() to check
      // for a (here, empty) file list.
      first: jest.fn().mockReturnValue({
        click: jest.fn().mockResolvedValue(void 0),
      }),
      count: jest.fn().mockResolvedValue(0),
    }),
    close: jest.fn().mockResolvedValue(void 0),
    _listeners: listeners,
  };
  return mockPage;
}

function createMockBrowser() {
  const mockContext: any = {
    newPage: jest.fn(),
    close: jest.fn().mockResolvedValue(void 0),
  };
  const mockBrowser: any = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(void 0),
  };
  return { mockBrowser, mockContext };
}

describe('VbplClientService', () => {
  let service: VbplClientService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VbplClientService(MOCK_CONFIG);
    (service as any).lastRequestAt = Date.now() - 10000;
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
      expect(() => service.assertTrustedDocumentUrl('not-a-url')).toThrow(
        'Not a valid URL',
      );
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

  describe('fetchDocument', () => {
    it('happy path: launches browser, navigates three tabs, returns raw page data', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.goto.mockResolvedValue(createMockResponse());

      mockPage.evaluate
        .mockResolvedValueOnce({
          scope: 'trung-uong',
          title: 'Test Document Title',
          fullText: 'This is the full document text.',
        })
        .mockResolvedValueOnce([{ label: 'So hieu', value: '123/2024/QD-TTg' }])
        .mockResolvedValueOnce([
          { categoryLabel: 'Luon giai', entries: ['Entry A', 'Entry B'] },
        ]);

      const result = await service.fetchDocument(
        'https://vbpl.vn/van-ban/chi-tiet/123',
      );

      expect(result).toEqual({
        sourceUrl: 'https://vbpl.vn/van-ban/chi-tiet/123',
        scope: 'trung-uong',
        title: 'Test Document Title',
        fullText: 'This is the full document text.',
        attributes: [{ label: 'So hieu', value: '123/2024/QD-TTg' }],
        relations: [
          { categoryLabel: 'Luon giai', entries: ['Entry A', 'Entry B'] },
        ],
        originalDocumentUrls: [],
      });

      expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
      expect(mockBrowser.newContext).toHaveBeenCalledWith({
        userAgent: 'legal-agent-law-index/1.0',
      });

      expect(mockPage.goto).toHaveBeenCalledTimes(4);
      expect(mockPage.goto).toHaveBeenNthCalledWith(
        1,
        'https://vbpl.vn/van-ban/chi-tiet/123',
        { waitUntil: 'domcontentloaded' },
      );
      expect(mockPage.goto).toHaveBeenNthCalledWith(
        2,
        'https://vbpl.vn/van-ban/chi-tiet/123?tabs=thuoc-tinh',
        { waitUntil: 'domcontentloaded' },
      );
      expect(mockPage.goto).toHaveBeenNthCalledWith(
        3,
        'https://vbpl.vn/van-ban/chi-tiet/123?tabs=luoc-do',
        { waitUntil: 'domcontentloaded' },
      );

      expect(mockPage.evaluate).toHaveBeenCalledTimes(3);
    });

    it('bad gateway: throws when page.goto returns a non-ok response', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.goto.mockResolvedValue(createMockResponse(false, 502));

      await expect(
        service.fetchDocument('https://vbpl.vn/van-ban/chi-tiet/123'),
      ).rejects.toThrow(BadGatewayException);
    });

    it('bad gateway: throws when page.goto throws a navigation error', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

      await expect(
        service.fetchDocument('https://vbpl.vn/van-ban/chi-tiet/123'),
      ).rejects.toThrow(BadGatewayException);
    });

    it('rejects untrusted URLs before any browser work', async () => {
      await expect(
        service.fetchDocument('https://evil.com/phish'),
      ).rejects.toThrow(BadRequestException);

      expect(chromium.launch).not.toHaveBeenCalled();
    });
  });

  describe('concurrency guard (scraper-resilience-plan.md 5.4)', () => {
    function setUpBrowserMocks() {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.evaluate.mockResolvedValue({
        scope: 'trung-uong',
        title: 't',
        fullText: 'f',
      });

      return { mockBrowser, mockContext, mockPage };
    }

    it('rejects a second fetchDocument call while the first is still in flight', async () => {
      const { mockPage } = setUpBrowserMocks();

      let resolveFirstGoto: (value: unknown) => void = () => undefined;
      const pendingFirstGoto = new Promise((resolve) => {
        resolveFirstGoto = resolve;
      });
      mockPage.goto
        .mockImplementationOnce(() => pendingFirstGoto)
        .mockResolvedValue(createMockResponse());

      const firstCall = service.fetchDocument(
        'https://vbpl.vn/van-ban/chi-tiet/123',
      );

      await expect(
        service.fetchDocument('https://vbpl.vn/van-ban/chi-tiet/456'),
      ).rejects.toThrow(ConflictException);

      resolveFirstGoto(createMockResponse());
      await expect(firstCall).resolves.toBeDefined();
    });

    it('also blocks a concurrent searchDocuments call while fetchDocument is in flight', async () => {
      const { mockPage } = setUpBrowserMocks();

      let resolveFirstGoto: (value: unknown) => void = () => undefined;
      const pendingFirstGoto = new Promise((resolve) => {
        resolveFirstGoto = resolve;
      });
      mockPage.goto
        .mockImplementationOnce(() => pendingFirstGoto)
        .mockResolvedValue(createMockResponse());

      const firstCall = service.fetchDocument(
        'https://vbpl.vn/van-ban/chi-tiet/123',
      );

      await expect(
        service.searchDocuments({ keyword: 'test' }),
      ).rejects.toThrow(ConflictException);

      resolveFirstGoto(createMockResponse());
      await firstCall;
    });

    it('releases the lock after fetchDocument completes, allowing a subsequent call', async () => {
      const { mockPage } = setUpBrowserMocks();
      mockPage.goto.mockResolvedValue(createMockResponse());

      await service.fetchDocument('https://vbpl.vn/van-ban/chi-tiet/1');

      await expect(
        service.fetchDocument('https://vbpl.vn/van-ban/chi-tiet/2'),
      ).resolves.toBeDefined();
    });

    it('releases the lock even when fetchDocument throws, so a later call is not permanently blocked', async () => {
      const { mockPage } = setUpBrowserMocks();
      mockPage.goto.mockResolvedValue(createMockResponse(false, 502));

      await expect(
        service.fetchDocument('https://vbpl.vn/van-ban/chi-tiet/1'),
      ).rejects.toThrow(BadGatewayException);

      mockPage.goto.mockResolvedValue(createMockResponse());

      await expect(
        service.fetchDocument('https://vbpl.vn/van-ban/chi-tiet/2'),
      ).resolves.toBeDefined();
    });
  });

  describe('browser recycling (scraper-resilience-plan.md 5.4)', () => {
    it('recycles the browser once the document threshold is reached, inside the same locked fetch — not a separate later call', async () => {
      const recyclingService = new VbplClientService({
        ...MOCK_CONFIG,
        browserRecycleInterval: 1,
      });

      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.goto.mockResolvedValue(createMockResponse());
      mockPage.evaluate.mockResolvedValue({
        scope: 'trung-uong',
        title: 't',
        fullText: 'f',
      });

      await recyclingService.fetchDocument(
        'https://vbpl.vn/van-ban/chi-tiet/1',
      );

      // Threshold (1) was hit by the document just fetched — the cached
      // browser/context/page must already be torn down by the time
      // fetchDocument resolves, not by some later, separately-triggered call
      // (see vbpl-client.service.ts's acquireLock doc comment for why that
      // used to be a race).
      expect(mockPage.close).toHaveBeenCalled();
      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();

      // A subsequent fetch launches a fresh browser rather than reusing the
      // already-torn-down cached one.
      await recyclingService.fetchDocument(
        'https://vbpl.vn/van-ban/chi-tiet/2',
      );
      expect(chromium.launch).toHaveBeenCalledTimes(2);
    });

    it('does not recycle before the configured threshold is reached', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.goto.mockResolvedValue(createMockResponse());
      mockPage.evaluate.mockResolvedValue({
        scope: 'trung-uong',
        title: 't',
        fullText: 'f',
      });

      // service (from the outer beforeEach) has browserRecycleInterval: 20.
      await service.fetchDocument('https://vbpl.vn/van-ban/chi-tiet/1');

      expect(mockPage.close).not.toHaveBeenCalled();

      await service.fetchDocument('https://vbpl.vn/van-ban/chi-tiet/2');
      expect(chromium.launch).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchDocuments', () => {
    it('happy path: navigates to search page, applies filters, returns body text', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.goto.mockResolvedValue(createMockResponse());

      const searchedBody = '<html>search results</html>';
      const mockResponse = {
        url: () => 'https://vbpl.vn/van-ban/trung-uong',
        request: () => ({ method: () => 'POST' }),
        text: () => Promise.resolve(searchedBody),
      };

      mockPage.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'response') {
          handler(mockResponse);
        }
      });

      const result = await service.searchDocuments({ keyword: 'test' });

      expect(result).toBe(searchedBody);
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://vbpl.vn/van-ban/trung-uong',
        { waitUntil: 'domcontentloaded' },
      );
    });

    it('bad gateway: throws when page.goto returns a non-ok response', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.goto.mockResolvedValue(createMockResponse(false, 502));

      await expect(
        service.searchDocuments({ keyword: 'test' }),
      ).rejects.toThrow(BadGatewayException);
    });

    it('bad gateway: throws when page.goto throws a navigation error', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

      await expect(
        service.searchDocuments({ keyword: 'test' }),
      ).rejects.toThrow(BadGatewayException);
    });

    it('removes response listener in finally block', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.goto.mockResolvedValue(createMockResponse());

      const searchedBody = 'body';
      const mockResponse = {
        url: () => 'https://vbpl.vn/van-ban/trung-uong',
        request: () => ({ method: () => 'POST' }),
        text: () => Promise.resolve(searchedBody),
      };

      mockPage.on.mockImplementation((event: string, handler: Function) => {
        if (event === 'response') {
          handler(mockResponse);
        }
      });

      await service.searchDocuments({ keyword: 'test' });

      expect(mockPage.off).toHaveBeenCalledWith(
        'response',
        expect.any(Function),
      );
    });
  });

  describe('getPage', () => {
    it('initializes browser, context, and page on first call', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      const page1 = await service['getPage']();

      expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
      expect(mockBrowser.newContext).toHaveBeenCalled();
      expect(mockContext.newPage).toHaveBeenCalled();
      expect(page1).toBe(mockPage);
    });

    it('returns cached page on subsequent calls', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      const page1 = await service['getPage']();
      const page2 = await service['getPage']();

      expect(page1).toBe(page2);
      expect(chromium.launch).toHaveBeenCalledTimes(1);
      expect(mockContext.newPage).toHaveBeenCalledTimes(1);
    });
  });

  describe('onModuleDestroy', () => {
    it('closes page, context, and browser', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      await service['getPage']();
      await service.onModuleDestroy();

      expect(mockPage.close).toHaveBeenCalled();
      expect(mockContext.close).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('handles close errors gracefully', async () => {
      const { mockBrowser, mockContext } = createMockBrowser();
      const mockPage = createMockPage();

      (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
      (mockBrowser.newContext as jest.Mock).mockResolvedValue(mockContext);
      (mockContext.newPage as jest.Mock).mockResolvedValue(mockPage);

      mockPage.close.mockRejectedValue(new Error('already closed'));
      mockContext.close.mockRejectedValue(new Error('already closed'));
      mockBrowser.close.mockRejectedValue(new Error('already closed'));

      await service['getPage']();
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
