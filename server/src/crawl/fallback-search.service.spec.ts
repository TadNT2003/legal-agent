import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { FallbackSearchService } from './fallback-search.service';

describe('FallbackSearchService', () => {
  let service: FallbackSearchService;
  let mockCrawlService: jest.Mocked<any>;
  let mockChinhPhuSearch: jest.Mocked<any>;

  beforeEach(() => {
    mockCrawlService = { searchDocuments: jest.fn() };
    mockChinhPhuSearch = { search: jest.fn() };
    service = new FallbackSearchService(mockCrawlService, mockChinhPhuSearch);
  });

  it('returns vbpl.vn results without touching vanban.chinhphu.vn when vbpl.vn has matches', async () => {
    mockCrawlService.searchDocuments.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [{ citation: '51/2024/QH15' }],
    });

    const result = await service.search({ keyword: 'Lao động' });

    expect(result.source).toBe('vbpl.vn');
    expect(mockCrawlService.searchDocuments).toHaveBeenCalledWith({
      keyword: 'Lao động',
    });
    expect(mockChinhPhuSearch.search).not.toHaveBeenCalled();
  });

  it('falls back to vanban.chinhphu.vn when vbpl.vn returns zero matches, deriving keyword/issuingBody/year', async () => {
    mockCrawlService.searchDocuments.mockResolvedValue({
      total: 0,
      page: 1,
      pageSize: 10,
      items: [],
    });
    mockChinhPhuSearch.search.mockResolvedValue({
      total: 1,
      items: [{ citation: '45/2019/QH14' }],
      issuingBodyUnresolved: false,
    });

    const result = await service.search({
      keyword: 'Lao động',
      issuingBodies: ['Quốc hội'],
      issuedFrom: '01/01/2019',
      issuedTo: '31/12/2019',
      pageSize: 20,
    });

    expect(result.source).toBe('vanban.chinhphu.vn');
    expect(mockChinhPhuSearch.search).toHaveBeenCalledWith({
      keyword: 'Lao động',
      issuingBody: 'Quốc hội',
      issuedYear: '2019',
      maxResults: 20,
    });
  });

  it('derives issuedYear from issuedFrom alone when issuedTo is not set', async () => {
    mockCrawlService.searchDocuments.mockResolvedValue({
      total: 0,
      page: 1,
      pageSize: 10,
      items: [],
    });
    mockChinhPhuSearch.search.mockResolvedValue({
      total: 0,
      items: [],
      issuingBodyUnresolved: false,
    });

    await service.search({ issuedFrom: '15/06/2021' });

    expect(mockChinhPhuSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({ issuedYear: '2021' }),
    );
  });

  it("prefers issuedFrom's year when issuedFrom/issuedTo span different years", async () => {
    mockCrawlService.searchDocuments.mockResolvedValue({
      total: 0,
      page: 1,
      pageSize: 10,
      items: [],
    });
    mockChinhPhuSearch.search.mockResolvedValue({
      total: 0,
      items: [],
      issuingBodyUnresolved: false,
    });

    await service.search({ issuedFrom: '01/01/2019', issuedTo: '31/12/2020' });

    expect(mockChinhPhuSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({ issuedYear: '2019' }),
    );
  });

  it('uses only the first issuingBody when several were requested', async () => {
    mockCrawlService.searchDocuments.mockResolvedValue({
      total: 0,
      page: 1,
      pageSize: 10,
      items: [],
    });
    mockChinhPhuSearch.search.mockResolvedValue({
      total: 0,
      items: [],
      issuingBodyUnresolved: false,
    });

    await service.search({ issuingBodies: ['Quốc hội', 'Bộ Tư pháp'] });

    expect(mockChinhPhuSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({ issuingBody: 'Quốc hội' }),
    );
  });

  it('falls back to vanban.chinhphu.vn when vbpl.vn rejects the issuingBody filter', async () => {
    mockCrawlService.searchDocuments.mockRejectedValue(
      new BadRequestException(
        '"Không tồn tại" is not a recognized "Cơ quan ban hành" filter option on vbpl.vn.',
      ),
    );
    mockChinhPhuSearch.search.mockResolvedValue({
      total: 1,
      items: [{ citation: '45/2019/QH14' }],
      issuingBodyUnresolved: false,
    });

    const result = await service.search({ issuingBodies: ['Không tồn tại'] });

    expect(result.source).toBe('vanban.chinhphu.vn');
  });

  it('propagates a vbpl.vn outage (BadGatewayException) instead of falling back', async () => {
    mockCrawlService.searchDocuments.mockRejectedValue(
      new BadGatewayException('vbpl.vn unreachable'),
    );

    await expect(service.search({ keyword: 'Lao động' })).rejects.toThrow(
      BadGatewayException,
    );
    expect(mockChinhPhuSearch.search).not.toHaveBeenCalled();
  });
});
