import { BadGatewayException } from '@nestjs/common';
import type { ParsedLawDocument } from '../download/parsed-law-document.interface';
import { ChinhPhuCrawlService } from './chinhphu-crawl.service';

jest.mock('../download/vanban-chinh-phu.parser', () => ({
  parseDocumentDetailPage: jest.fn(),
}));

import { parseDocumentDetailPage } from '../download/vanban-chinh-phu.parser';

const mockParseDocumentDetailPage =
  parseDocumentDetailPage as jest.MockedFunction<
    typeof parseDocumentDetailPage
  >;

const makeRaw = (
  overrides?: Partial<ParsedLawDocument>,
): ParsedLawDocument => ({
  citation: '51/2024/QH15',
  title: 'Luật Test',
  date: '18/01/2024',
  docType: 'Luật',
  issuingBody: 'Quốc hội',
  sourceUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=219000',
  fileUrls: ['https://cdn.chinhphu.vn/files/51-2024-qh15.pdf'],
  ...overrides,
});

describe('ChinhPhuCrawlService', () => {
  let service: ChinhPhuCrawlService;
  let mockClient: jest.Mocked<any>;
  let mockTextExtractor: jest.Mocked<any>;
  let mockRepo: jest.Mocked<any>;
  let mockNodeRepo: jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = { fetchDocumentPage: jest.fn() };
    mockTextExtractor = { extractText: jest.fn() };
    mockRepo = { upsertDocument: jest.fn() };
    mockNodeRepo = { syncNodes: jest.fn() };

    service = new ChinhPhuCrawlService(
      mockClient,
      mockTextExtractor,
      mockRepo,
      mockNodeRepo,
    );
  });

  it('syncs a document as metadata_only when no text extractor result is available', async () => {
    mockClient.fetchDocumentPage.mockResolvedValue('<html></html>');
    mockParseDocumentDetailPage.mockReturnValue(makeRaw());
    mockTextExtractor.extractText.mockResolvedValue({
      fullText: null,
      extractionMethod: null,
    });
    mockRepo.upsertDocument.mockResolvedValue({
      documentId: 'doc-1',
      changed: true,
    });

    const result = await service.syncDocument(
      'https://vanban.chinhphu.vn/?pageid=27160&docid=219000',
    );

    expect(mockClient.fetchDocumentPage).toHaveBeenCalledWith(
      'https://vanban.chinhphu.vn/?pageid=27160&docid=219000',
    );
    expect(mockTextExtractor.extractText).toHaveBeenCalledWith([
      'https://cdn.chinhphu.vn/files/51-2024-qh15.pdf',
    ]);
    expect(result.documentId).toBe('doc-1');
    expect(result.changed).toBe(true);
    expect(result.hasFullText).toBe(false);
    expect(mockNodeRepo.syncNodes).not.toHaveBeenCalled();
  });

  it('builds the document_node tree once fullText is available', async () => {
    mockClient.fetchDocumentPage.mockResolvedValue('<html></html>');
    mockParseDocumentDetailPage.mockReturnValue(makeRaw());
    mockTextExtractor.extractText.mockResolvedValue({
      fullText: 'Điều 1. Phạm vi điều chỉnh...',
      extractionMethod: 'docling-vlm',
    });
    mockRepo.upsertDocument.mockResolvedValue({
      documentId: 'doc-1',
      changed: true,
    });

    const result = await service.syncDocument(
      'https://vanban.chinhphu.vn/?pageid=27160&docid=219000',
    );

    expect(mockNodeRepo.syncNodes).toHaveBeenCalledWith(
      'doc-1',
      { fullText: 'Điều 1. Phạm vi điều chỉnh...' },
      true,
    );
    expect(result.hasFullText).toBe(true);
  });

  it('throws BadGatewayException when the page has no recognizable citation', async () => {
    mockClient.fetchDocumentPage.mockResolvedValue('<html></html>');
    mockParseDocumentDetailPage.mockReturnValue(null);

    await expect(
      service.syncDocument('https://vanban.chinhphu.vn/?pageid=1&docid=2'),
    ).rejects.toThrow(BadGatewayException);
    expect(mockRepo.upsertDocument).not.toHaveBeenCalled();
  });

  it('returns skippedReason without touching document_node when the repository skips the document', async () => {
    mockClient.fetchDocumentPage.mockResolvedValue('<html></html>');
    mockParseDocumentDetailPage.mockReturnValue(makeRaw());
    mockTextExtractor.extractText.mockResolvedValue({
      fullText: null,
      extractionMethod: null,
    });
    mockRepo.upsertDocument.mockResolvedValue({
      documentId: null,
      changed: false,
      skippedReason: 'citation already indexed',
    });

    const result = await service.syncDocument(
      'https://vanban.chinhphu.vn/?pageid=27160&docid=219000',
    );

    expect(result.documentId).toBeNull();
    expect(result.skippedReason).toBe('citation already indexed');
    expect(mockNodeRepo.syncNodes).not.toHaveBeenCalled();
  });

  it('does not throw if node sync fails', async () => {
    mockClient.fetchDocumentPage.mockResolvedValue('<html></html>');
    mockParseDocumentDetailPage.mockReturnValue(makeRaw());
    mockTextExtractor.extractText.mockResolvedValue({
      fullText: 'Điều 1. Phạm vi điều chỉnh...',
      extractionMethod: 'docling-vlm',
    });
    mockRepo.upsertDocument.mockResolvedValue({
      documentId: 'doc-1',
      changed: true,
    });
    mockNodeRepo.syncNodes.mockRejectedValue(new Error('Bad body'));

    const result = await service.syncDocument(
      'https://vanban.chinhphu.vn/?pageid=27160&docid=219000',
    );

    expect(result.documentId).toBe('doc-1');
    expect(result.hasFullText).toBe(true);
  });
});
