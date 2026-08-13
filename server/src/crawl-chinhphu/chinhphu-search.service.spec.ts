import { BadGatewayException } from '@nestjs/common';
import { ChinhPhuSearchService } from './chinhphu-search.service';

jest.mock('../download/vanban-chinh-phu.parser', () => ({
  parseSearchPage: jest.fn(),
}));

import { parseSearchPage } from '../download/vanban-chinh-phu.parser';

const mockParseSearchPage = parseSearchPage as jest.MockedFunction<
  typeof parseSearchPage
>;

const CONTROLS = {
  category: 'ctrl$drdDocCategory',
  org: 'ctrl$drdDocOrg',
  year: 'ctrl$drdDocYear',
  recordsPerPage: 'ctrl$drdRecordPerPage',
  keyword: 'ctrl$txtSearchKeyword',
  searchButton: 'ctrl$btnSearch',
  gridView: 'ctrl$grvDocument',
};

describe('ChinhPhuSearchService', () => {
  let service: ChinhPhuSearchService;
  let mockClient: jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      fetchSearchPage: jest.fn(),
      postSearch: jest.fn(),
    };
    service = new ChinhPhuSearchService(mockClient);
  });

  describe('resolveOrgId', () => {
    it('returns the id for a single exact label match', async () => {
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage.mockReturnValue({
        hiddenFields: {},
        controls: null,
        rows: [],
        shownCount: null,
        totalCount: null,
        orgOptions: [
          { value: '1', label: 'Quốc hội' },
          { value: '2', label: 'Bộ Tư pháp' },
        ],
      });

      const id = await service.resolveOrgId('Quốc hội');
      expect(id).toBe('1');
    });

    it('returns null when the name matches zero entries', async () => {
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage.mockReturnValue({
        hiddenFields: {},
        controls: null,
        rows: [],
        shownCount: null,
        totalCount: null,
        orgOptions: [{ value: '1', label: 'Quốc hội' }],
      });

      const id = await service.resolveOrgId('Không tồn tại');
      expect(id).toBeNull();
    });

    it('returns null when the name matches more than one entry', async () => {
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage.mockReturnValue({
        hiddenFields: {},
        controls: null,
        rows: [],
        shownCount: null,
        totalCount: null,
        orgOptions: [
          { value: '14578', label: 'Ban Chỉ đạo cải cách hành chính' },
          { value: '15459', label: 'Ban Chỉ đạo cải cách hành chính' },
        ],
      });

      const id = await service.resolveOrgId('Ban Chỉ đạo cải cách hành chính');
      expect(id).toBeNull();
    });
  });

  describe('search', () => {
    it('throws BadGatewayException when the search form controls cannot be found', async () => {
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage.mockReturnValue({
        hiddenFields: {},
        controls: null,
        rows: [],
        shownCount: null,
        totalCount: null,
        orgOptions: [],
      });

      await expect(service.search({ keyword: 'Luật' })).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('searches with keyword/org/year and maps rows into the result shape', async () => {
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage.mockReturnValueOnce({
        hiddenFields: { __VIEWSTATE: 'abc' },
        controls: CONTROLS,
        rows: [],
        shownCount: null,
        totalCount: null,
        orgOptions: [{ value: '1', label: 'Quốc hội' }],
      });
      // The "initial" controls fetch — resolveOrgId's own fetchSearchPage +
      // parseSearchPage call (mocked above) happens first since issuingBody
      // is set, so this is the *second* queued parseSearchPage result.
      mockParseSearchPage.mockReturnValueOnce({
        hiddenFields: { __VIEWSTATE: 'abc' },
        controls: CONTROLS,
        rows: [],
        shownCount: null,
        totalCount: null,
        orgOptions: [],
      });
      mockClient.postSearch.mockResolvedValue('<html></html>');
      mockParseSearchPage.mockReturnValueOnce({
        hiddenFields: {},
        controls: CONTROLS,
        rows: [
          {
            citation: '45/2019/QH14',
            title: 'Bộ luật Lao động',
            date: '20/11/2019',
            docUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=1',
            fileUrls: [],
          },
        ],
        shownCount: 1,
        totalCount: 1,
        orgOptions: [],
      });

      const result = await service.search({
        keyword: 'Lao động',
        issuingBody: 'Quốc hội',
        issuedYear: '2019',
      });

      expect(result.issuingBodyUnresolved).toBe(false);
      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        {
          sourceUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=1',
          citation: '45/2019/QH14',
          title: 'Bộ luật Lao động',
          issuedDate: '20/11/2019',
        },
      ]);

      const postedFields = mockClient.postSearch.mock.calls[0][0];
      expect(postedFields[CONTROLS.org]).toBe('1');
      expect(postedFields[CONTROLS.year]).toBe('2019');
      expect(postedFields[CONTROLS.keyword]).toBe('Lao động');
      expect(postedFields[CONTROLS.category]).toBe('0');
    });

    it('flags issuingBodyUnresolved and searches without an org constraint when the name is ambiguous', async () => {
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage.mockReturnValue({
        hiddenFields: {},
        controls: CONTROLS,
        rows: [],
        shownCount: 0,
        totalCount: 0,
        orgOptions: [
          { value: '14578', label: 'Ban Chỉ đạo cải cách hành chính' },
          { value: '15459', label: 'Ban Chỉ đạo cải cách hành chính' },
        ],
      });
      mockClient.postSearch.mockResolvedValue('<html></html>');

      const result = await service.search({
        issuingBody: 'Ban Chỉ đạo cải cách hành chính',
      });

      expect(result.issuingBodyUnresolved).toBe(true);
      const postedFields = mockClient.postSearch.mock.calls[0][0];
      expect(postedFields[CONTROLS.org]).toBe('0');
    });
  });
});
