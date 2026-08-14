import { BadGatewayException, Injectable } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { rename, rm, stat } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DEFAULT_MAX_RESULTS, DEFAULT_RECORDS_PER_PAGE } from './constants';
import { DownloadByUrlDto } from './dto/download-by-url.dto';
import { SearchDownloadDto } from './dto/search-download.dto';
import { buildFilename, buildLawFolderName } from './filename.util';
import type { DownloadOutcome } from '../utils/download-outcome.interface';
import type {
  ParsedLawDocument,
  SearchResultRow,
} from './parsed-law-document.interface';
import { classifyTier } from './law-tier-classifier';
import { LawManifestService } from '../utils/law-manifest.service';
import { VanBanChinhPhuClientService } from './vanban-chinh-phu-client.service';
import {
  parseDocumentDetailPage,
  parseSearchPage,
} from './vanban-chinh-phu.parser';

export interface SearchDownloadResult {
  totalMatched: number | null;
  documents: SearchResultRow[];
  downloaded: DownloadOutcome[];
}

export interface UrlStatusFile {
  fileUrl: string;
  subdir: string;
  folder: string;
  filename: string;
  /** Where this file would land (or already lives), regardless of `downloaded`. */
  absolutePath: string;
  downloaded: boolean;
}

export interface UrlStatusResult {
  citation: string;
  title: string;
  sourceUrl: string;
  files: UrlStatusFile[];
  allDownloaded: boolean;
  error: string | null;
}

interface DownloadTarget {
  fileUrl: string;
  filename: string;
}

type ClassifiedTargets =
  | { subdir: string; folder: string; targets: DownloadTarget[] }
  | { error: string };

@Injectable()
export class LawDownloadService {
  constructor(
    private readonly client: VanBanChinhPhuClientService,
    private readonly manifest: LawManifestService,
  ) {}

  async downloadFromUrl(dto: DownloadByUrlDto): Promise<DownloadOutcome[]> {
    const parsed = await this.resolveAndParseDetail(dto.url);
    const resolved = this.classifyAndBuildTargets(parsed, dto.subdirOverride);

    if ('error' in resolved) {
      return [
        this.buildOutcome(parsed, null, null, null, null, {
          error: resolved.error,
        }),
      ];
    }

    const outcomes: DownloadOutcome[] = [];
    for (const target of resolved.targets) {
      outcomes.push(
        await this.persistFile(
          parsed,
          resolved.subdir,
          resolved.folder,
          target.fileUrl,
          target.filename,
          dto.force,
        ),
      );
    }
    return outcomes;
  }

  /** Predicts what downloadFromUrl would do, without fetching or writing any file. */
  async checkStatus(
    url: string,
    subdirOverride?: string,
  ): Promise<UrlStatusResult> {
    const parsed = await this.resolveAndParseDetail(url);
    const resolved = this.classifyAndBuildTargets(parsed, subdirOverride);

    if ('error' in resolved) {
      return {
        citation: parsed.citation,
        title: parsed.title,
        sourceUrl: url,
        files: [],
        allDownloaded: false,
        error: resolved.error,
      };
    }

    const files = await Promise.all(
      resolved.targets.map(async (target) => ({
        fileUrl: target.fileUrl,
        subdir: resolved.subdir,
        folder: resolved.folder,
        filename: target.filename,
        absolutePath: join(
          this.manifest.dir,
          resolved.subdir,
          resolved.folder,
          target.filename,
        ),
        downloaded: await this.manifest.fileExists(
          join(resolved.subdir, resolved.folder),
          target.filename,
        ),
      })),
    );

    return {
      citation: parsed.citation,
      title: parsed.title,
      sourceUrl: url,
      files,
      allDownloaded: files.length > 0 && files.every((f) => f.downloaded),
      error: null,
    };
  }

  async downloadBatch(
    documents: DownloadByUrlDto[],
  ): Promise<DownloadOutcome[]> {
    const outcomes: DownloadOutcome[] = [];
    for (const doc of documents) {
      try {
        outcomes.push(...(await this.downloadFromUrl(doc)));
      } catch (err) {
        outcomes.push({
          citation: '',
          title: '',
          sourceUrl: doc.url,
          fileUrl: null,
          subdir: null,
          folder: null,
          filename: null,
          httpStatus: null,
          bytes: null,
          skipped: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return outcomes;
  }

  async search(dto: SearchDownloadDto): Promise<SearchResultRow[]> {
    const { documents } = await this.fetchSearchResults(dto);
    return documents;
  }

  async downloadBySearch(
    dto: SearchDownloadDto,
  ): Promise<SearchDownloadResult> {
    const { collected, totalAvailable, documents } =
      await this.fetchSearchResults(dto);

    if (dto.dryRun) {
      return { totalMatched: totalAvailable, documents, downloaded: [] };
    }

    const downloaded: DownloadOutcome[] = [];
    for (const doc of documents) {
      if (!doc.docUrl) {
        downloaded.push({
          citation: doc.citation,
          title: doc.title,
          sourceUrl: '',
          fileUrl: null,
          subdir: null,
          folder: null,
          filename: null,
          httpStatus: null,
          bytes: null,
          skipped: false,
          error: 'Search result row had no document detail link.',
        });
        continue;
      }
      try {
        downloaded.push(
          ...(await this.downloadFromUrl({
            url: doc.docUrl,
            force: dto.force,
          })),
        );
      } catch (err) {
        downloaded.push({
          citation: doc.citation,
          title: doc.title,
          sourceUrl: doc.docUrl,
          fileUrl: null,
          subdir: null,
          folder: null,
          filename: null,
          httpStatus: null,
          bytes: null,
          skipped: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { totalMatched: totalAvailable, documents, downloaded };
  }

  private async fetchSearchResults(dto: SearchDownloadDto) {
    const recordsPerPage = dto.recordsPerPage ?? DEFAULT_RECORDS_PER_PAGE;
    const maxResults = dto.maxResults ?? DEFAULT_MAX_RESULTS;

    const searchHtml = await this.client.fetchSearchPage();
    const initial = parseSearchPage(searchHtml);
    if (!initial.controls) {
      throw new BadGatewayException(
        'Could not find the expected search form controls on vanban.chinhphu.vn — the page structure may have changed.',
      );
    }
    const { controls } = initial;

    const searchFields: Record<string, string> = {
      ...initial.hiddenFields,
      [controls.category]: dto.categoryId ?? '0',
      [controls.org]: dto.orgId ?? '0',
      [controls.year]: dto.year ?? '0',
      [controls.recordsPerPage]: String(recordsPerPage),
      [controls.keyword]: dto.keyword ?? '',
      [controls.searchButton]: 'Tìm kiếm',
    };
    delete searchFields['__EVENTTARGET'];
    delete searchFields['__EVENTARGUMENT'];

    let page = parseSearchPage(await this.client.postSearch(searchFields));
    const collected: SearchResultRow[] = [...page.rows];
    const totalAvailable = page.totalCount ?? page.rows.length;
    const targetCount = Math.min(maxResults, totalAvailable);
    const realPageSize = page.rows.length || recordsPerPage;
    const pageCap = Math.min(Math.ceil(maxResults / realPageSize) + 1, 50);

    let pageNum = 2;
    while (
      collected.length < targetCount &&
      page.rows.length > 0 &&
      pageNum <= pageCap
    ) {
      const pageFields: Record<string, string> = {
        ...page.hiddenFields,
        [controls.category]: dto.categoryId ?? '0',
        [controls.org]: dto.orgId ?? '0',
        [controls.year]: dto.year ?? '0',
        [controls.recordsPerPage]: String(recordsPerPage),
        [controls.keyword]: dto.keyword ?? '',
        __EVENTTARGET: controls.gridView,
        __EVENTARGUMENT: `Page$${pageNum}`,
      };
      delete pageFields[controls.searchButton];
      page = parseSearchPage(await this.client.postSearch(pageFields));
      collected.push(...page.rows);
      pageNum += 1;
    }

    const documents = collected.slice(0, maxResults);

    return { collected, totalAvailable, documents };
  }

  private classifyAndBuildTargets(
    parsed: ParsedLawDocument,
    subdirOverride: string | undefined,
  ): ClassifiedTargets {
    if (parsed.fileUrls.length === 0) {
      return { error: 'No attached file found on this document page.' };
    }

    const classification = subdirOverride
      ? { subdir: subdirOverride }
      : classifyTier(parsed.docType, parsed.issuingBody);

    if (!classification) {
      return {
        error: `Could not classify document type "${parsed.docType}" / issuing body "${parsed.issuingBody}" into a laws/ tier. Pass subdirOverride to force a location.`,
      };
    }

    const subdir = classification.subdir;
    const folder = buildLawFolderName(parsed.citation, parsed.title);
    const targets = parsed.fileUrls.map((fileUrl, index) => ({
      fileUrl,
      filename: buildFilename(
        parsed.citation,
        parsed.title,
        fileUrl,
        index,
        parsed.fileUrls.length,
      ),
    }));

    return { subdir, folder, targets };
  }

  private async resolveAndParseDetail(url: string): Promise<ParsedLawDocument> {
    const html = await this.client.fetchDocumentPage(url);
    const parsed = parseDocumentDetailPage(html, url);
    if (!parsed) {
      throw new BadGatewayException(
        `Could not parse document metadata from ${url}`,
      );
    }
    return parsed;
  }

  private buildOutcome(
    parsed: ParsedLawDocument,
    fileUrl: string | null,
    subdir: string | null,
    folder: string | null,
    filename: string | null,
    extra: Partial<DownloadOutcome> = {},
  ): DownloadOutcome {
    return {
      citation: parsed.citation,
      title: parsed.title,
      sourceUrl: parsed.sourceUrl,
      fileUrl,
      subdir,
      folder,
      filename,
      httpStatus: null,
      bytes: null,
      skipped: false,
      error: null,
      ...extra,
    };
  }

  private async persistFile(
    parsed: ParsedLawDocument,
    subdir: string,
    folder: string,
    fileUrl: string,
    filename: string,
    force: boolean | undefined,
  ): Promise<DownloadOutcome> {
    const relativeDir = join(subdir, folder);

    if (!force && (await this.manifest.fileExists(relativeDir, filename))) {
      return this.buildOutcome(parsed, fileUrl, subdir, folder, filename, {
        skipped: true,
      });
    }

    try {
      const targetDir = await this.manifest.ensureTargetDir(relativeDir);
      const targetPath = join(targetDir, filename);
      const tmpPath = `${targetPath}.part`;

      const response = await this.client.fetchFile(fileUrl);
      await pipeline(
        Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0],
        ),
        createWriteStream(tmpPath),
      );
      const { size } = await stat(tmpPath);
      await rename(tmpPath, targetPath);

      await this.manifest.upsertEntry({
        citation: parsed.citation,
        title: parsed.title,
        date: parsed.date,
        docUrl: parsed.sourceUrl,
        fileUrls: parsed.fileUrls,
        subdir,
        folder,
        filename,
      });
      await this.manifest.appendLogEntry({
        citation: parsed.citation,
        subdir,
        filename,
        httpCode: response.status,
        bytes: size,
      });

      return this.buildOutcome(parsed, fileUrl, subdir, folder, filename, {
        httpStatus: response.status,
        bytes: size,
      });
    } catch (err) {
      await rm(join(this.manifest.dir, relativeDir, `${filename}.part`), {
        force: true,
      });
      return this.buildOutcome(parsed, fileUrl, subdir, folder, filename, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
