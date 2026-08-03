import type { ParsedLawDocument, SearchResultRow } from './parsed-law-document.interface';
import { LawDownloadService } from './law-download.service';

jest.mock('./vanban-chinh-phu.parser', () => ({
  parseDocumentDetailPage: jest.fn(),
  parseSearchPage: jest.fn(),
}));

import {
  parseDocumentDetailPage,
  parseSearchPage,
} from './vanban-chinh-phu.parser';

jest.mock('./law-tier-classifier', () => ({
  classifyTier: jest.fn(),
}));

import { classifyTier } from './law-tier-classifier';

jest.mock('./filename.util', () => ({
  buildFilename: jest.fn(),
  buildLawFolderName: jest.fn(),
}));

import { buildFilename, buildLawFolderName } from './filename.util';

jest.mock('fs/promises', () => ({
  rename: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 4096 }),
}));

jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
}));

jest.mock('stream/promises', () => ({
  pipeline: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('stream', () => ({
  Readable: { fromWeb: jest.fn().mockReturnValue({ on: jest.fn() }) },
}));

const mockParseDocumentDetailPage = parseDocumentDetailPage as jest.MockedFunction<typeof parseDocumentDetailPage>;
const mockParseSearchPage = parseSearchPage as jest.MockedFunction<typeof parseSearchPage>;
const mockClassifyTier = classifyTier as jest.MockedFunction<typeof classifyTier>;
const mockBuildFilename = buildFilename as jest.MockedFunction<typeof buildFilename>;
const mockBuildLawFolderName = buildLawFolderName as jest.MockedFunction<typeof buildLawFolderName>;

const makeParsedDoc = (): ParsedLawDocument => ({
  citation: '45/2019/QH14',
  title: 'Bộ luật Lao động',
  date: '20/11/2019',
  docType: 'Luật',
  issuingBody: 'Quốc hội',
  sourceUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
  fileUrls: ['https://datafiles.chinhphu.vn/x/bldd.pdf'],
});

describe('LawDownloadService', () => {
  let service: LawDownloadService;
  let mockClient: jest.Mocked<any>;
  let mockManifest: jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      fetchDocumentPage: jest.fn(),
      fetchFile: jest.fn(),
      fetchSearchPage: jest.fn(),
      postSearch: jest.fn(),
    };
    mockManifest = {
      dir: '/tmp/laws',
      fileExists: jest.fn(),
      ensureTargetDir: jest.fn(),
      readManifest: jest.fn(),
      upsertEntry: jest.fn(),
      appendLogEntry: jest.fn(),
    };

    service = new LawDownloadService(
      mockClient as any,
      mockManifest as any,
    );
  });

  describe('downloadFromUrl', () => {
    it('downloads a document and returns outcome', async () => {
      const parsed = makeParsedDoc();
      mockParseDocumentDetailPage.mockReturnValue(parsed);
      mockClassifyTier.mockReturnValue({ subdir: '02-luat-nghi-quyet-quoc-hoi/luat-bo-luat' });
      mockBuildLawFolderName.mockReturnValue('45-2019-QH14_bo-luat-lao-dong');
      mockBuildFilename.mockReturnValue('45-2019-QH14_bo-luat-lao-dong.pdf');
      mockManifest.fileExists.mockResolvedValue(false);
      mockManifest.ensureTargetDir.mockResolvedValue('/tmp/laws/02-luat/folder');
      mockClient.fetchFile.mockResolvedValue({
        body: new ReadableStream(),
        status: 200,
      });

      const outcomes = await service.downloadFromUrl({
        url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].error).toBeNull();
      expect(outcomes[0].skipped).toBe(false);
      expect(outcomes[0].citation).toBe('45/2019/QH14');
    });

    it('returns error outcome when classification fails', async () => {
      const parsed = makeParsedDoc();
      mockParseDocumentDetailPage.mockReturnValue(parsed);
      mockClassifyTier.mockReturnValue(null);

      const outcomes = await service.downloadFromUrl({
        url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].error).toContain('Could not classify');
    });

    it('returns error outcome when no files found', async () => {
      const parsedNoFiles: ParsedLawDocument = {
        ...makeParsedDoc(),
        fileUrls: [],
      };
      mockParseDocumentDetailPage.mockReturnValue(parsedNoFiles);

      const outcomes = await service.downloadFromUrl({
        url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].error).toBe('No attached file found on this document page.');
    });

    it('skips file when already downloaded and force is false', async () => {
      const parsed = makeParsedDoc();
      mockParseDocumentDetailPage.mockReturnValue(parsed);
      mockClassifyTier.mockReturnValue({ subdir: '02-luat' });
      mockBuildLawFolderName.mockReturnValue('45-2019-QH14');
      mockBuildFilename.mockReturnValue('45-2019-QH14.pdf');
      mockManifest.fileExists.mockResolvedValue(true);

      const outcomes = await service.downloadFromUrl({
        url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].skipped).toBe(true);
      expect(mockClient.fetchFile).not.toHaveBeenCalled();
    });

    it('force downloads when force is true even if file exists', async () => {
      const parsed = makeParsedDoc();
      mockParseDocumentDetailPage.mockReturnValue(parsed);
      mockClassifyTier.mockReturnValue({ subdir: '02-luat' });
      mockBuildLawFolderName.mockReturnValue('45-2019-QH14');
      mockBuildFilename.mockReturnValue('45-2019-QH14.pdf');
      mockManifest.fileExists.mockResolvedValue(true);
      mockManifest.ensureTargetDir.mockResolvedValue('/tmp/laws/02-luat/folder');
      mockClient.fetchFile.mockResolvedValue({
        body: new ReadableStream(),
        status: 200,
      });

      const outcomes = await service.downloadFromUrl({
        url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
        force: true,
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].skipped).toBe(false);
      expect(mockClient.fetchFile).toHaveBeenCalled();
    });
  });

  describe('checkStatus', () => {
    it('returns status for a document with files', async () => {
      const parsed = makeParsedDoc();
      mockParseDocumentDetailPage.mockReturnValue(parsed);
      mockClassifyTier.mockReturnValue({ subdir: '02-luat' });
      mockBuildLawFolderName.mockReturnValue('45-2019-QH14');
      mockBuildFilename.mockReturnValue('45-2019-QH14.pdf');
      mockManifest.fileExists.mockResolvedValue(true);

      const status = await service.checkStatus(
        'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
      );

      expect(status.citation).toBe('45/2019/QH14');
      expect(status.files).toHaveLength(1);
      expect(status.files[0].downloaded).toBe(true);
      expect(status.allDownloaded).toBe(true);
    });

    it('returns allDownloaded false when file is missing', async () => {
      const parsed = makeParsedDoc();
      mockParseDocumentDetailPage.mockReturnValue(parsed);
      mockClassifyTier.mockReturnValue({ subdir: '02-luat' });
      mockBuildLawFolderName.mockReturnValue('45-2019-QH14');
      mockBuildFilename.mockReturnValue('45-2019-QH14.pdf');
      mockManifest.fileExists.mockResolvedValue(false);

      const status = await service.checkStatus(
        'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
      );

      expect(status.files[0].downloaded).toBe(false);
      expect(status.allDownloaded).toBe(false);
    });

    it('returns error when classification fails', async () => {
      const parsed = makeParsedDoc();
      mockParseDocumentDetailPage.mockReturnValue(parsed);
      mockClassifyTier.mockReturnValue(null);

      const status = await service.checkStatus(
        'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
      );

      expect(status.error).toContain('Could not classify');
      expect(status.files).toHaveLength(0);
    });
  });

  describe('downloadBatch', () => {
    it('downloads multiple documents', async () => {
      const parsed = makeParsedDoc();
      mockParseDocumentDetailPage.mockReturnValue(parsed);
      mockClassifyTier.mockReturnValue({ subdir: '02-luat' });
      mockBuildLawFolderName.mockReturnValue('45-2019-QH14');
      mockBuildFilename.mockReturnValue('45-2019-QH14.pdf');
      mockManifest.fileExists.mockResolvedValue(false);
      mockManifest.ensureTargetDir.mockResolvedValue('/tmp/laws/02-luat/folder');
      mockClient.fetchFile.mockResolvedValue({
        body: new ReadableStream(),
        status: 200,
      });

      const outcomes = await service.downloadBatch([
        { url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=1' },
        { url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=2' },
      ]);

      expect(outcomes).toHaveLength(2);
    });

    it('collects errors without aborting batch', async () => {
      mockClient.fetchDocumentPage
        .mockResolvedValueOnce('<html></html>')
        .mockRejectedValueOnce(new Error('Network error'));
      mockParseDocumentDetailPage.mockReturnValueOnce(makeParsedDoc());
      mockClassifyTier.mockReturnValueOnce({ subdir: '02-luat' });
      mockBuildLawFolderName.mockReturnValueOnce('45-2019-QH14');
      mockBuildFilename.mockReturnValueOnce('45-2019-QH14.pdf');
      mockManifest.fileExists.mockResolvedValue(false);
      mockManifest.ensureTargetDir.mockResolvedValue('/tmp/laws/02-luat/folder');
      mockClient.fetchFile.mockResolvedValue({
        body: new ReadableStream(),
        status: 200,
      });

      const outcomes = await service.downloadBatch([
        { url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=1' },
        { url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=2' },
      ]);

      expect(outcomes).toHaveLength(2);
      expect(outcomes[1].error).toBe('Network error');
    });
  });

  describe('downloadBySearch', () => {
    it('returns empty downloaded array in dryRun mode', async () => {
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage
        .mockReturnValueOnce({
          rows: [],
          controls: {
            category: 'ddlLoaiVB',
            org: 'ddlCoQuan',
            year: 'ddlNam',
            recordsPerPage: 'ddlSoBanGhi',
            keyword: 'txtKeywords',
            searchButton: 'btnTimKiem',
            gridView: 'gvKetQua',
          },
          hiddenFields: { __VIEWSTATE: 'abc' },
        })
        .mockReturnValue({
          rows: [{ citation: '45/2019/QH14', title: 'Test', date: null, docUrl: null, fileUrls: [] }],
          hiddenFields: { __VIEWSTATE: 'abc' },
        });

      const result = await service.downloadBySearch({
        keyword: 'test',
        dryRun: true,
      });

      expect(result.documents).toHaveLength(1);
      expect(result.downloaded).toHaveLength(0);
    });

    it('downloads documents from search results', async () => {
      const searchRow: SearchResultRow = {
        citation: '45/2019/QH14',
        title: 'Bộ luật Lao động',
        date: '20/11/2019',
        docUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
        fileUrls: [],
      };
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage
        .mockReturnValueOnce({
          rows: [],
          controls: {
            category: 'ddlLoaiVB',
            org: 'ddlCoQuan',
            year: 'ddlNam',
            recordsPerPage: 'ddlSoBanGhi',
            keyword: 'txtKeywords',
            searchButton: 'btnTimKiem',
            gridView: 'gvKetQua',
          },
          hiddenFields: { __VIEWSTATE: 'abc' },
        })
        .mockReturnValue({
          rows: [searchRow],
          hiddenFields: { __VIEWSTATE: 'abc' },
        });
      mockParseDocumentDetailPage.mockReturnValue(makeParsedDoc());
      mockClassifyTier.mockReturnValue({ subdir: '02-luat' });
      mockBuildLawFolderName.mockReturnValue('45-2019-QH14');
      mockBuildFilename.mockReturnValue('45-2019-QH14.pdf');
      mockManifest.fileExists.mockResolvedValue(false);
      mockManifest.ensureTargetDir.mockResolvedValue('/tmp/laws/02-luat/folder');
      mockClient.fetchFile.mockResolvedValue({
        body: new ReadableStream(),
        status: 200,
      });

      const result = await service.downloadBySearch({
        keyword: 'test',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.downloaded).toHaveLength(1);
      expect(result.downloaded[0].error).toBeNull();
    });

    it('reports error for search rows with no docUrl', async () => {
      const searchRow: SearchResultRow = {
        citation: '45/2019/QH14',
        title: 'Test',
        date: null,
        docUrl: null,
        fileUrls: [],
      };
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage
        .mockReturnValueOnce({
          rows: [],
          controls: {
            category: 'ddlLoaiVB',
            org: 'ddlCoQuan',
            year: 'ddlNam',
            recordsPerPage: 'ddlSoBanGhi',
            keyword: 'txtKeywords',
            searchButton: 'btnTimKiem',
            gridView: 'gvKetQua',
          },
          hiddenFields: { __VIEWSTATE: 'abc' },
        })
        .mockReturnValue({
          rows: [searchRow],
          hiddenFields: { __VIEWSTATE: 'abc' },
        });

      const result = await service.downloadBySearch({
        keyword: 'test',
      });

      expect(result.downloaded).toHaveLength(1);
      expect(result.downloaded[0].error).toContain('no document detail link');
    });
  });

  describe('search', () => {
    it('returns search result rows', async () => {
      mockClient.fetchSearchPage.mockResolvedValue('<html></html>');
      mockParseSearchPage
        .mockReturnValueOnce({
          rows: [],
          controls: {
            category: 'ddlLoaiVB',
            org: 'ddlCoQuan',
            year: 'ddlNam',
            recordsPerPage: 'ddlSoBanGhi',
            keyword: 'txtKeywords',
            searchButton: 'btnTimKiem',
            gridView: 'gvKetQua',
          },
          hiddenFields: { __VIEWSTATE: 'abc' },
        })
        .mockReturnValue({
          rows: [
            { citation: '45/2019/QH14', title: 'Test', date: null, docUrl: null, fileUrls: [] },
          ],
          hiddenFields: { __VIEWSTATE: 'abc' },
        });

      const results = await service.search({ keyword: 'test' });

      expect(results).toHaveLength(1);
      expect(results[0].citation).toBe('45/2019/QH14');
    });
  });
});