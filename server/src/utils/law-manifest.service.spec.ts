import { join } from 'path';
import type { ManifestEntry } from '../utils/download-outcome.interface';
import { LawManifestService } from './law-manifest.service';

const MOCK_CONFIG = { dir: join(__dirname, '../../../tmp_test_manifest') };

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  readdir: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
  access: jest.fn(),
}));

import * as fs from 'fs/promises';

describe('LawManifestService', () => {
  let service: LawManifestService;
  const mockedFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LawManifestService(MOCK_CONFIG);
  });

  describe('dir getter', () => {
    it('returns config.dir', () => {
      expect(service.dir).toBe(MOCK_CONFIG.dir);
    });
  });

  describe('onModuleInit', () => {
    it('creates base dir and calls mkdir with recursive', async () => {
      mockedFs.access.mockRejectedValue({ code: 'ENOENT' });
      mockedFs.readdir.mockResolvedValue([]);
      await service.onModuleInit();
      expect(mockedFs.mkdir).toHaveBeenCalledWith(MOCK_CONFIG.dir, {
        recursive: true,
      });
    });

    it('creates tier directories with recursive', async () => {
      mockedFs.access.mockRejectedValue({ code: 'ENOENT' });
      mockedFs.readdir.mockResolvedValue([]);
      await service.onModuleInit();
      const mkdirCalls = (mockedFs.mkdir as jest.Mock).mock.calls;
      const tierCalls = mkdirCalls.filter(
        ([path]: [string, object]) =>
          typeof path === 'string' && path.includes('01-hien-phap'),
      );
      expect(tierCalls.length).toBeGreaterThan(0);
      expect(tierCalls[0][1]).toEqual({ recursive: true });
    });

    it('calls ensureManifestFile, ensureLogFile, ensureDatasetReadme indirectly via writes', async () => {
      mockedFs.access.mockRejectedValue({ code: 'ENOENT' });
      mockedFs.readdir.mockResolvedValue([]);
      await service.onModuleInit();
      const writeCalls = (mockedFs.writeFile as jest.Mock).mock.calls;
      const manifestWritten = writeCalls.some(
        ([path]: [string, string]) =>
          typeof path === 'string' && path.includes('manifest.json'),
      );
      const logWritten = writeCalls.some(
        ([path]: [string, string]) =>
          typeof path === 'string' && path.includes('download-log.csv'),
      );
      const readmeWritten = writeCalls.some(
        ([path]: [string, string]) =>
          typeof path === 'string' && path.endsWith('README.md'),
      );
      expect(manifestWritten).toBe(true);
      expect(logWritten).toBe(true);
      expect(readmeWritten).toBe(true);
    });

    it('when files already exist, does not overwrite manifest.json', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readdir.mockResolvedValue(['existing-file.pdf']);
      const writeFileSpy = mockedFs.writeFile as jest.Mock;
      await service.onModuleInit();
      const manifestWrites = writeFileSpy.mock.calls.filter(
        ([path]: [string, string]) =>
          typeof path === 'string' && path.includes('manifest.json'),
      );
      expect(manifestWrites.length).toBe(0);
    });

    it('when files already exist, does not overwrite download-log.csv', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readdir.mockResolvedValue(['existing-file.pdf']);
      const writeFileSpy = mockedFs.writeFile as jest.Mock;
      await service.onModuleInit();
      const logWrites = writeFileSpy.mock.calls.filter(
        ([path]: [string, string]) =>
          typeof path === 'string' && path.includes('download-log.csv'),
      );
      expect(logWrites.length).toBe(0);
    });

    it('when dataset README already exists, does not overwrite it', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readdir.mockResolvedValue(['existing-file.pdf']);
      const writeFileSpy = mockedFs.writeFile as jest.Mock;
      await service.onModuleInit();
      const dirReadmeWrites = writeFileSpy.mock.calls.filter(
        ([path]: [string, string]) =>
          typeof path === 'string' &&
          path.includes(MOCK_CONFIG.dir) &&
          path.endsWith('README.md'),
      );
      expect(dirReadmeWrites.length).toBe(0);
    });

    it('creates tier README files when tier dir is empty', async () => {
      mockedFs.access.mockRejectedValue({ code: 'ENOENT' });
      mockedFs.readdir.mockResolvedValue([]);
      await service.onModuleInit();
      const writeCalls = (mockedFs.writeFile as jest.Mock).mock.calls;
      const tierReadmeCalls = writeCalls.filter(
        ([path]: [string, string]) =>
          typeof path === 'string' && path.includes('01-hien-phap'),
      );
      expect(tierReadmeCalls.length).toBeGreaterThan(0);
    });

    it('does not create tier README when tier dir has files', async () => {
      mockedFs.access.mockRejectedValue({ code: 'ENOENT' });
      mockedFs.readdir.mockResolvedValue(['existing-doc.pdf']);
      await service.onModuleInit();
      const writeCalls = (mockedFs.writeFile as jest.Mock).mock.calls;
      const tierReadmeWrites = writeCalls.filter(
        ([path, data]: [string, string]) =>
          typeof path === 'string' &&
          path.includes('01-hien-phap') &&
          path.endsWith('README.md'),
      );
      expect(tierReadmeWrites.length).toBe(0);
    });
  });

  describe('fileExists', () => {
    it('returns true when file exists', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      const result = await service.fileExists('subdir/folder', 'file.pdf');
      expect(result).toBe(true);
    });

    it('returns false when file does not exist', async () => {
      mockedFs.access.mockRejectedValue({ code: 'ENOENT' });
      const result = await service.fileExists('subdir/folder', 'file.pdf');
      expect(result).toBe(false);
    });
  });

  describe('ensureTargetDir', () => {
    it('creates directory and returns path', async () => {
      const result = await service.ensureTargetDir('subdir/folder');
      expect(mockedFs.mkdir).toHaveBeenCalled();
      expect(result).toContain('subdir');
      expect(result).toContain('folder');
    });
  });

  describe('readManifest', () => {
    it('returns parsed entries from manifest file', async () => {
      const entries: ManifestEntry[] = [
        {
          citation: '45/2019/QH14',
          title: 'Bộ luật Lao động',
          date: '20/11/2019',
          docUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203914',
          fileUrls: ['https://datafiles.chinhphu.vn/x/bldd.pdf'],
          subdir: '02-luat-nghi-quyet-quoc-hoi/luat-bo-luat',
          folder: '45-2019-QH14_bo-luat-lao-dong',
          filename: '45-2019-QH14_bo-luat-lao-dong.pdf',
        },
      ];
      mockedFs.readFile.mockResolvedValue(JSON.stringify(entries));
      const result = await service.readManifest();
      expect(result).toHaveLength(1);
      expect(result[0].citation).toBe('45/2019/QH14');
    });

    it('returns empty array when manifest file is missing', async () => {
      mockedFs.readFile.mockRejectedValue({ code: 'ENOENT' });
      const result = await service.readManifest();
      expect(result).toEqual([]);
    });

    it('throws for non-ENOENT errors', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('Permission denied'));
      await expect(service.readManifest()).rejects.toThrow('Permission denied');
    });
  });

  describe('upsertEntry', () => {
    it('inserts new entry when not in manifest', async () => {
      mockedFs.readFile.mockResolvedValue('[]');
      const entry: ManifestEntry = {
        citation: '91/2015/QH13',
        title: 'Bộ luật Dân sự',
        date: '24/11/2015',
        docUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=203915',
        fileUrls: ['https://datafiles.chinhphu.vn/x/bldds.pdf'],
        subdir: '02-luat-nghi-quyet-quoc-hoi/luat-bo-luat',
        folder: '91-2015-QH13_bo-luat-dan-su',
        filename: '91-2015-QH13_bo-luat-dan-su.pdf',
      };
      await service.upsertEntry(entry);
      expect(mockedFs.writeFile).toHaveBeenCalled();
      const writtenData = JSON.parse(
        (mockedFs.writeFile as jest.Mock).mock.calls[0][1],
      );
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].citation).toBe('91/2015/QH13');
    });

    it('updates existing entry with same subdir/folder/filename', async () => {
      const existing: ManifestEntry[] = [
        {
          citation: '45/2019/QH14',
          title: 'Old Title',
          date: '20/11/2019',
          docUrl: 'old-url',
          fileUrls: ['old-file'],
          subdir: '02-luat',
          folder: '45-2019-QH14',
          filename: '45-2019-QH14.pdf',
        },
      ];
      mockedFs.readFile.mockResolvedValue(JSON.stringify(existing));

      const updated: ManifestEntry = {
        citation: '45/2019/QH14',
        title: 'New Title',
        date: '20/11/2019',
        docUrl: 'new-url',
        fileUrls: ['new-file'],
        subdir: '02-luat',
        folder: '45-2019-QH14',
        filename: '45-2019-QH14.pdf',
      };
      await service.upsertEntry(updated);
      const writtenData = JSON.parse(
        (mockedFs.writeFile as jest.Mock).mock.calls[0][1],
      );
      expect(writtenData[0].title).toBe('New Title');
      expect(writtenData).toHaveLength(1);
    });
  });

  describe('moveEntry', () => {
    it('updates subdir for matching entry', async () => {
      const existing: ManifestEntry[] = [
        {
          citation: '45/2019/QH14',
          title: 'Bộ luật Lao động',
          date: '20/11/2019',
          docUrl: 'url',
          fileUrls: ['file'],
          subdir: 'old-subdir',
          folder: '45-2019-QH14',
          filename: '45-2019-QH14.pdf',
        },
      ];
      mockedFs.readFile.mockResolvedValue(JSON.stringify(existing));
      await service.moveEntry(
        'old-subdir',
        '45-2019-QH14',
        '45-2019-QH14.pdf',
        'new-subdir',
      );
      const writtenData = JSON.parse(
        (mockedFs.writeFile as jest.Mock).mock.calls[0][1],
      );
      expect(writtenData[0].subdir).toBe('new-subdir');
    });

    it('does nothing when entry is not found', async () => {
      mockedFs.readFile.mockResolvedValue('[]');
      await service.moveEntry('old', 'folder', 'file.pdf', 'new');
      expect(mockedFs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('appendLogEntry', () => {
    it('appends CSV row with header when log file missing', async () => {
      mockedFs.access.mockRejectedValue({ code: 'ENOENT' });
      await service.appendLogEntry({
        citation: '45/2019/QH14',
        subdir: '02-luat',
        filename: '45-2019-QH14.pdf',
        httpCode: 200,
        bytes: 1024,
      });
      expect(mockedFs.appendFile).toHaveBeenCalled();
      const appended = (mockedFs.appendFile as jest.Mock).mock.calls[0][1];
      expect(appended).toContain('citation,subdir,filename,http_code,bytes');
      expect(appended).toContain('45/2019/QH14');
    });

    it('appends CSV row without header when log file exists', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      await service.appendLogEntry({
        citation: '91/2015/QH13',
        subdir: '02-luat',
        filename: '91-2015-QH13.pdf',
        httpCode: 200,
        bytes: 2048,
      });
      const appended = (mockedFs.appendFile as jest.Mock).mock.calls[0][1];
      expect(appended).not.toContain(
        'citation,subdir,filename,http_code,bytes',
      );
      expect(appended).toContain('91/2015/QH13');
    });

    it('escapes double quotes in CSV fields', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      await service.appendLogEntry({
        citation: '1/2025/QH15',
        subdir: 'tier",test',
        filename: 'file",name.pdf',
        httpCode: 200,
        bytes: 100,
      });
      const appended = (mockedFs.appendFile as jest.Mock).mock.calls[0][1];
      expect(appended).toContain('""');
    });
  });
});
