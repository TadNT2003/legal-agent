import type { ManifestEntry } from '../utils/download-outcome.interface';
import {
  LawCatalogService,
  FolderStats,
  DocumentGroupLookupResult,
  DocumentStatusResult,
} from './law-catalog.service';

jest.mock('../utils/document-matcher', () => ({
  findByCitation: jest.fn(),
  resolveBestMatch: jest.fn(),
}));

import { findByCitation, resolveBestMatch } from '../utils/document-matcher';

jest.mock('fs/promises', () => ({
  access: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
}));

import * as fs from 'fs/promises';

const mockFindByCitation = findByCitation as jest.MockedFunction<
  typeof findByCitation
>;
const mockResolveBestMatch = resolveBestMatch as jest.MockedFunction<
  typeof resolveBestMatch
>;
const mockedFs = fs as jest.Mocked<typeof fs>;

const makeEntry = (
  citation: string,
  filename: string,
  subdir = '02-luat',
  folder = '45-2019-QH14',
): ManifestEntry => ({
  citation,
  title: 'Bộ luật Lao động',
  date: '20/11/2019',
  docUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
  fileUrls: ['https://datafiles.chinhphu.vn/x/bldd.pdf'],
  subdir,
  folder,
  filename,
});

describe('LawCatalogService', () => {
  let service: LawCatalogService;
  let mockManifest: jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockManifest = {
      dir: '/tmp/laws',
      readManifest: jest.fn(),
      fileExists: jest.fn(),
      ensureTargetDir: jest.fn(),
    };
    service = new LawCatalogService(mockManifest);
  });

  describe('getTierOverview', () => {
    it('returns folder stats for tier directories', async () => {
      const mockDirEntry = {
        isDirectory: jest.fn().mockReturnValue(true),
        isFile: jest.fn().mockReturnValue(false),
        name: '02-luat-nghi-quyet-quoc-hoi',
      };
      mockedFs.readdir
        .mockResolvedValueOnce([mockDirEntry] as any)
        .mockResolvedValueOnce([]);

      const overview = await service.getTierOverview();

      expect(overview).toHaveLength(1);
      expect(overview[0].subdir).toBe('02-luat-nghi-quyet-quoc-hoi');
    });

    it('returns empty array when laws dir does not exist', async () => {
      mockedFs.readdir.mockRejectedValueOnce({ code: 'ENOENT' });
      const overview = await service.getTierOverview();
      expect(overview).toEqual([]);
    });
  });

  describe('getTierStats', () => {
    it('returns stats for a valid tier', async () => {
      mockedFs.readdir.mockResolvedValue([]);
      const stats: FolderStats = await service.getTierStats(2);
      expect(stats.subdir).toContain('02-luat');
    });

    it('returns empty stats for missing tier dir', async () => {
      mockedFs.readdir.mockRejectedValue({ code: 'ENOENT' });
      const stats = await service.getTierStats(5);
      expect(stats.documentCount).toBe(0);
      expect(stats.totalBytes).toBe(0);
    });

    it('throws for invalid tier number', async () => {
      await expect(service.getTierStats(99)).rejects.toThrow(
        /tier must be an integer/,
      );
    });

    it('throws for non-integer tier', async () => {
      await expect(service.getTierStats(2.5)).rejects.toThrow(
        /tier must be an integer/,
      );
    });
  });

  describe('findDocumentGroup', () => {
    it('returns all files for matched citation', async () => {
      const entry = makeEntry('45/2019/QH14', '45-2019-QH14.pdf');
      const entry2 = makeEntry('45/2019/QH14', '45-2019-QH14_phu_luc_1.pdf');
      mockManifest.readManifest.mockResolvedValue([entry, entry2]);
      mockResolveBestMatch.mockReturnValue({
        entry,
        score: 0,
      });
      mockFindByCitation.mockReturnValue([entry, entry2]);
      mockedFs.access.mockResolvedValue(undefined);

      const result: DocumentGroupLookupResult = await service.findDocumentGroup(
        {
          citation: '45/2019/QH14',
        },
      );

      expect(result.citation).toBe('45/2019/QH14');
      expect(result.files).toHaveLength(2);
      expect(result.score).toBe(0);
    });

    it('throws NotFoundException when no match found', async () => {
      mockManifest.readManifest.mockResolvedValue([]);
      mockResolveBestMatch.mockReturnValue(null);

      await expect(
        service.findDocumentGroup({ citation: '999/2099/QH99' }),
      ).rejects.toThrow('No matching document found');
    });

    it('throws NotFoundException when file is missing on disk', async () => {
      const entry = makeEntry('45/2019/QH14', '45-2019-QH14.pdf');
      mockManifest.readManifest.mockResolvedValue([entry]);
      mockResolveBestMatch.mockReturnValue({ entry, score: 0 });
      mockFindByCitation.mockReturnValue([entry]);
      mockedFs.access.mockRejectedValue({ code: 'ENOENT' });

      await expect(
        service.findDocumentGroup({ citation: '45/2019/QH14' }),
      ).rejects.toThrow('missing on disk');
    });
  });

  describe('getDocumentStatus', () => {
    it('returns status with disk presence for each file', async () => {
      const entry = makeEntry('45/2019/QH14', '45-2019-QH14.pdf');
      mockManifest.readManifest.mockResolvedValue([entry]);
      mockResolveBestMatch.mockReturnValue({ entry, score: 0 });
      mockFindByCitation.mockReturnValue([entry]);
      mockedFs.access.mockResolvedValue(undefined);

      const result: DocumentStatusResult = await service.getDocumentStatus({
        citation: '45/2019/QH14',
      });

      expect(result.citation).toBe('45/2019/QH14');
      expect(result.files).toHaveLength(1);
      expect(result.files[0].existsOnDisk).toBe(true);
      expect(result.fileCount).toBe(1);
    });

    it('reports missing files with existsOnDisk false', async () => {
      const entry = makeEntry('45/2019/QH14', '45-2019-QH14.pdf');
      mockManifest.readManifest.mockResolvedValue([entry]);
      mockResolveBestMatch.mockReturnValue({ entry, score: 0 });
      mockFindByCitation.mockReturnValue([entry]);
      mockedFs.access.mockRejectedValue({ code: 'ENOENT' });

      const result = await service.getDocumentStatus({
        citation: '45/2019/QH14',
      });

      expect(result.files[0].existsOnDisk).toBe(false);
    });

    it('throws NotFoundException when no match', async () => {
      mockManifest.readManifest.mockResolvedValue([]);
      mockResolveBestMatch.mockReturnValue(null);

      await expect(
        service.getDocumentStatus({ citation: '999/2099/QH99' }),
      ).rejects.toThrow('No matching document found');
    });
  });
});
