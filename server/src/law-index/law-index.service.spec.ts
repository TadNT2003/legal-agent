import {
  LawIndexService,
  SyncDocumentResult,
  SyncSummary,
} from './law-index.service';
import type {
  RawVbplPage,
  VbplSearchFilters,
  VbplSearchResult,
  VbplScope,
} from './crawl/vbpl-document.interface';
import type { ParsedVbplDocument } from './crawl/vbpl-document.interface';

jest.mock('./crawl/vbpl.parser', () => ({
  parseVbplPage: jest.fn(),
  parseVbplSearchPage: jest.fn(),
}));

import { parseVbplPage, parseVbplSearchPage } from './crawl/vbpl.parser';

const mockParseVbplPage = parseVbplPage as jest.MockedFunction<
  typeof parseVbplPage
>;
const mockParseVbplSearchPage = parseVbplSearchPage as jest.MockedFunction<
  typeof parseVbplSearchPage
>;

const makeParsedDoc = (
  scope: VbplScope = 'trung-uong',
): ParsedVbplDocument => ({
  sourceUrl: 'https://vbpl.vn/GetLawDetail?tempLawsId=123',
  scope,
  title: 'Luật Test',
  fullText: 'Full text content',
  attributes: {
    citation: '01/2025/QH15',
    documentType: 'Luật',
    industry: null,
    field: null,
    issuingBody: 'Quốc hội',
    signerTitle: null,
    signerName: null,
    issuedDateRaw: '01/01/2025',
    effectiveDateRaw: '01/06/2025',
    expiryDateRaw: null,
    validityStatusRaw: 'còn hiệu lực',
  },
  relations: [],
  consolidation: {
    consolidatesRawTitles: [],
    consolidatedIntoRawTitles: [],
  },
});

describe('LawIndexService', () => {
  let service: LawIndexService;
  let mockSitemap: jest.Mocked<any>;
  let mockClient: jest.Mocked<any>;
  let mockRepo: jest.Mocked<any>;
  let mockNodeRepo: jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSitemap = {
      fetchTrungUongSitemapUrls: jest.fn(),
      fetchDocumentUrls: jest.fn(),
    };
    mockClient = {
      fetchDocument: jest.fn(),
      searchDocuments: jest.fn(),
    };
    mockRepo = {
      upsertDocument: jest.fn(),
      upsertRelations: jest.fn(),
      updateDocument: jest.fn(),
      healDanglingReferences: jest.fn(),
      searchLocalDocuments: jest.fn(),
    };
    mockNodeRepo = {
      syncNodes: jest.fn(),
    };

    service = new LawIndexService(
      mockSitemap,
      mockClient,
      mockRepo,
      mockNodeRepo,
    );
  });

  describe('syncDocument', () => {
    it('syncs a trung uong document successfully', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      const parsed = makeParsedDoc('trung-uong');
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(parsed);
      mockRepo.upsertDocument.mockResolvedValue({
        documentId: 'doc-1',
        changed: true,
      });

      const result: SyncDocumentResult = await service.syncDocument(
        'https://vbpl.vn/doc/123',
      );

      expect(mockClient.fetchDocument).toHaveBeenCalledWith(
        'https://vbpl.vn/doc/123',
      );
      expect(mockParseVbplPage).toHaveBeenCalledWith(raw);
      expect(mockRepo.upsertDocument).toHaveBeenCalledWith(parsed);
      expect(mockRepo.upsertRelations).toHaveBeenCalledWith('doc-1', parsed);
      expect(mockNodeRepo.syncNodes).toHaveBeenCalledWith(
        'doc-1',
        parsed,
        true,
      );
      expect(result.documentId).toBe('doc-1');
      expect(result.changed).toBe(true);
    });

    it('skips document with dia-phuong scope', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(makeParsedDoc('dia-phuong'));

      const result = await service.syncDocument('https://vbpl.vn/doc/456');

      expect(result.documentId).toBeNull();
      expect(result.changed).toBe(false);
      expect(result.skippedReason).toBe('scope=dia-phuong');
      expect(mockRepo.upsertDocument).not.toHaveBeenCalled();
    });

    it('skips document with unknown scope', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(makeParsedDoc('unknown'));

      const result = await service.syncDocument('https://vbpl.vn/doc/789');

      expect(result.skippedReason).toBe('scope=unknown');
    });

    it('returns early when content unchanged', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      const parsed = makeParsedDoc('trung-uong');
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(parsed);
      mockRepo.upsertDocument.mockResolvedValue({
        documentId: 'doc-1',
        changed: false,
      });

      const result = await service.syncDocument('https://vbpl.vn/doc/123');

      expect(result.changed).toBe(false);
      expect(mockNodeRepo.syncNodes).toHaveBeenCalledWith(
        'doc-1',
        parsed,
        false,
      );
    });

    it('does not throw if node sync fails', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      const parsed = makeParsedDoc('trung-uong');
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(parsed);
      mockRepo.upsertDocument.mockResolvedValue({
        documentId: 'doc-1',
        changed: true,
      });
      mockNodeRepo.syncNodes.mockRejectedValue(new Error('Bad body'));

      const result = await service.syncDocument('https://vbpl.vn/doc/123');

      expect(result.documentId).toBe('doc-1');
      expect(result.changed).toBe(true);
    });

    it('no longer heals dangling references per document (see scraper-resilience-plan.md 5.1)', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      const parsed = makeParsedDoc('trung-uong');
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(parsed);
      mockRepo.upsertDocument.mockResolvedValue({
        documentId: 'doc-1',
        changed: true,
      });

      const result = await service.syncDocument('https://vbpl.vn/doc/123');

      expect(result.healedReferences).toBe(0);
      expect(mockRepo.healDanglingReferences).not.toHaveBeenCalled();
    });
  });

  describe('updateDocumentByUrl', () => {
    it('returns a not-found error when no matching document exists', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      const parsed = makeParsedDoc('trung-uong');
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(parsed);
      mockRepo.updateDocument.mockResolvedValue({
        notFound: true,
        citationId: '01/2025/QH15',
      });

      const result = await service.updateDocumentByUrl(
        'https://vbpl.vn/doc/123',
      );

      expect('message' in result).toBe(true);
      expect(mockRepo.healDanglingReferences).not.toHaveBeenCalled();
    });

    it('returns unchanged with healedReferences 0 when content_version matches', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      const parsed = makeParsedDoc('trung-uong');
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(parsed);
      mockRepo.updateDocument.mockResolvedValue({
        documentId: 'doc-1',
        citationId: '01/2025/QH15',
        unchanged: true,
      });

      const result = await service.updateDocumentByUrl(
        'https://vbpl.vn/doc/123',
      );

      expect(result).toEqual({
        documentId: 'doc-1',
        citationId: '01/2025/QH15',
        changed: false,
        healedReferences: 0,
      });
      expect(mockRepo.healDanglingReferences).not.toHaveBeenCalled();
    });

    it('updates the document without healing references per call (see scraper-resilience-plan.md 5.1)', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      const parsed = makeParsedDoc('trung-uong');
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(parsed);
      mockRepo.updateDocument.mockResolvedValue({
        documentId: 'doc-1',
        citationId: '01/2025/QH15',
        unchanged: false,
      });

      const result = await service.updateDocumentByUrl(
        'https://vbpl.vn/doc/123',
      );

      expect(result).toEqual({
        documentId: 'doc-1',
        citationId: '01/2025/QH15',
        changed: true,
        healedReferences: 0,
      });
      expect(mockRepo.healDanglingReferences).not.toHaveBeenCalled();
    });
  });

  describe('syncDocumentsBatch', () => {
    it('syncs multiple urls and returns summary', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(makeParsedDoc('trung-uong'));
      mockRepo.upsertDocument.mockResolvedValue({
        documentId: 'doc-1',
        changed: true,
      });
      mockRepo.healDanglingReferences.mockResolvedValue(2);

      const summary: SyncSummary = await service.syncDocumentsBatch([
        'https://vbpl.vn/doc/1',
        'https://vbpl.vn/doc/2',
      ]);

      expect(summary.totalUrls).toBe(2);
      expect(summary.synced).toBe(2);
      expect(summary.skipped).toBe(0);
      expect(summary.errors).toHaveLength(0);
      expect(summary.healedReferences).toBe(2);
    });

    it('collects per-url errors without aborting', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      mockClient.fetchDocument
        .mockResolvedValueOnce(raw)
        .mockRejectedValueOnce(new Error('Network error'));
      mockParseVbplPage.mockReturnValue(makeParsedDoc('trung-uong'));
      mockRepo.upsertDocument.mockResolvedValue({
        documentId: 'doc-1',
        changed: true,
      });
      mockRepo.healDanglingReferences.mockResolvedValue(0);

      const summary = await service.syncDocumentsBatch([
        'https://vbpl.vn/doc/1',
        'https://vbpl.vn/doc/2',
      ]);

      expect(summary.synced).toBe(1);
      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0].url).toBe('https://vbpl.vn/doc/2');
      expect(summary.errors[0].error).toBe('Network error');
    });

    it('counts skipped documents', async () => {
      const raw: RawVbplPage = {} as RawVbplPage;
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(makeParsedDoc('dia-phuong'));
      mockRepo.healDanglingReferences.mockResolvedValue(0);

      const summary = await service.syncDocumentsBatch([
        'https://vbpl.vn/doc/1',
      ]);

      expect(summary.skipped).toBe(1);
      expect(summary.synced).toBe(0);
    });
  });

  describe('syncAll', () => {
    it('crawls sitemap and syncs documents', async () => {
      mockSitemap.fetchTrungUongSitemapUrls.mockResolvedValue([
        'https://vbpl.vn/sitemap1.xml',
      ]);
      mockSitemap.fetchDocumentUrls.mockResolvedValue([
        'https://vbpl.vn/doc/1',
        'https://vbpl.vn/doc/2',
      ]);
      const raw: RawVbplPage = {} as RawVbplPage;
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(makeParsedDoc('trung-uong'));
      mockRepo.upsertDocument.mockResolvedValue({
        documentId: 'doc-1',
        changed: true,
      });
      mockRepo.healDanglingReferences.mockResolvedValue(1);

      const summary = await service.syncAll();

      expect(summary.totalUrls).toBe(2);
      expect(summary.synced).toBe(2);
      expect(summary.healedReferences).toBe(1);
    });

    it('respects limit parameter', async () => {
      mockSitemap.fetchTrungUongSitemapUrls.mockResolvedValue([
        'https://vbpl.vn/sitemap1.xml',
      ]);
      mockSitemap.fetchDocumentUrls.mockResolvedValue([
        'https://vbpl.vn/doc/1',
        'https://vbpl.vn/doc/2',
        'https://vbpl.vn/doc/3',
      ]);
      const raw: RawVbplPage = {} as RawVbplPage;
      mockClient.fetchDocument.mockResolvedValue(raw);
      mockParseVbplPage.mockReturnValue(makeParsedDoc('trung-uong'));
      mockRepo.upsertDocument.mockResolvedValue({
        documentId: 'doc-1',
        changed: true,
      });
      mockRepo.healDanglingReferences.mockResolvedValue(0);

      const summary = await service.syncAll({ limit: 2 });

      expect(summary.totalUrls).toBe(2);
      expect(summary.synced).toBe(2);
    });

    it('collects errors during full crawl', async () => {
      mockSitemap.fetchTrungUongSitemapUrls.mockResolvedValue([
        'https://vbpl.vn/sitemap1.xml',
      ]);
      mockSitemap.fetchDocumentUrls.mockResolvedValue([
        'https://vbpl.vn/doc/1',
        'https://vbpl.vn/doc/2',
      ]);
      const raw: RawVbplPage = {} as RawVbplPage;
      mockClient.fetchDocument
        .mockResolvedValueOnce(raw)
        .mockRejectedValueOnce(new Error('Timeout'));
      mockParseVbplPage.mockReturnValue(makeParsedDoc('trung-uong'));
      mockRepo.upsertDocument.mockResolvedValue({
        documentId: 'doc-1',
        changed: true,
      });
      mockRepo.healDanglingReferences.mockResolvedValue(0);

      const summary = await service.syncAll();

      expect(summary.synced).toBe(1);
      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0].error).toBe('Timeout');
    });
  });

  describe('searchDocuments', () => {
    it('delegates to client and parses result', async () => {
      const rawResponse = { total: 10, pageNumber: 1, pageSize: 10, items: [] };
      const result: VbplSearchResult = {
        total: 10,
        page: 1,
        pageSize: 10,
        items: [],
      };
      mockClient.searchDocuments.mockResolvedValue(rawResponse);
      mockParseVbplSearchPage.mockReturnValue(result);

      const filters: VbplSearchFilters = { keyword: 'test' };
      const res = await service.searchDocuments(filters);

      expect(mockClient.searchDocuments).toHaveBeenCalledWith(filters);
      expect(mockParseVbplSearchPage).toHaveBeenCalledWith(rawResponse);
      expect(res).toBe(result);
    });
  });
});
