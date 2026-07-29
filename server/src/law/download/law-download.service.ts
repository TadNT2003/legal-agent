import { BadGatewayException, Injectable } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { rename, rm, stat } from 'fs/promises';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DEFAULT_MAX_RESULTS, DEFAULT_RECORDS_PER_PAGE } from './constants';
import { DownloadByUrlDto } from './dto/download-by-url.dto';
import { SearchDownloadDto } from './dto/search-download.dto';
import {
  findSupersededConflict,
  parseManifestDate,
} from '../utils/document-matcher';
import { buildFilename, buildLawFolderName } from './filename.util';
import type {
  DownloadOutcome,
  ManifestEntry,
} from '../utils/download-outcome.interface';
import type {
  ParsedLawDocument,
  SearchResultRow,
} from './parsed-law-document.interface';
import { classifyTier } from './law-tier-classifier';
import {
  LUAT_HET_HIEU_LUC_SUBDIR,
  LUAT_SUBDIR,
} from '../utils/tier-definitions';
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
    const resolved = await this.classifyAndBuildTargets(
      parsed,
      dto.subdirOverride,
    );

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
    const resolved = await this.classifyAndBuildTargets(parsed, subdirOverride);

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

  async downloadBySearch(
    dto: SearchDownloadDto,
  ): Promise<SearchDownloadResult> {
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
    // vanban.chinhphu.vn always renders at most this many rows per response,
    // regardless of the requested drdRecordPerPage value — confirmed by
    // requesting recordsPerPage 50/100/200/500 for the same query and always
    // getting back a first page of the same length. Pagination math must be
    // based on that real, observed page size, not the requested one.
    const realPageSize = page.rows.length || recordsPerPage;
    const pageCap = Math.min(Math.ceil(maxResults / realPageSize) + 1, 50);

    let pageNum = 2;
    while (
      collected.length < targetCount &&
      page.rows.length > 0 &&
      pageNum <= pageCap
    ) {
      // The grid's own paging postback (__doPostBack on grvDocument) only
      // returns results if the filter controls (category/org/year/
      // recordsPerPage/keyword) are resent alongside the hidden ASP.NET
      // fields — omitting them makes the server process the postback as if
      // every filter had been reset, and it comes back with zero rows.
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

  private async classifyAndBuildTargets(
    parsed: ParsedLawDocument,
    subdirOverride: string | undefined,
  ): Promise<ClassifiedTargets> {
    if (parsed.fileUrls.length === 0) {
      return { error: 'No attached file found on this document page.' };
    }

    const classification = subdirOverride
      ? { subdir: subdirOverride }
      : classifyTier(parsed.docType, parsed.issuingBody, parsed.title);

    if (!classification) {
      return {
        error: `Could not classify document type "${parsed.docType}" / issuing body "${parsed.issuingBody}" into a laws/ tier. Pass subdirOverride to force a location.`,
      };
    }

    // An explicit subdirOverride is the caller deliberately choosing a location —
    // don't second-guess it with automatic supersession detection.
    const subdir = subdirOverride
      ? classification.subdir
      : await this.resolveLuatSupersession(parsed, classification.subdir);

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

  /**
   * Only the plain "luat" bucket has a notion of supersession — amendments and
   * Quốc hội resolutions aren't "replaced" the same way a standalone law is.
   * A newer document bumps the current occupant of luat/ out to
   * luat-het-hieu-luc/; an older one goes straight there itself. This is a
   * heuristic (title-subject matching), not an authoritative "replaces"
   * relationship — vanban.chinhphu.vn doesn't expose one (see laws/README.md's
   * Known limitations).
   */
  private async resolveLuatSupersession(
    parsed: ParsedLawDocument,
    subdir: string,
  ): Promise<string> {
    if (subdir !== LUAT_SUBDIR) return subdir;

    const manifestEntries = await this.manifest.readManifest();
    const conflict = findSupersededConflict(
      manifestEntries,
      LUAT_SUBDIR,
      parsed.citation,
      parsed.title,
    );
    if (!conflict) return subdir;

    const incomingDate = parseManifestDate(parsed.date);
    const existingDate = parseManifestDate(conflict.date);
    if (!incomingDate || !existingDate) return subdir; // can't compare safely — leave as classified

    if (incomingDate.getTime() > existingDate.getTime()) {
      await this.moveToSuperseded(conflict);
      return subdir;
    }

    return LUAT_HET_HIEU_LUC_SUBDIR;
  }

  private async moveToSuperseded(entry: ManifestEntry): Promise<void> {
    const oldPath = join(
      this.manifest.dir,
      entry.subdir,
      entry.folder,
      entry.filename,
    );
    const newDir = await this.manifest.ensureTargetDir(
      join(LUAT_HET_HIEU_LUC_SUBDIR, entry.folder),
    );
    const newPath = join(newDir, entry.filename);
    await rename(oldPath, newPath);
    await this.manifest.moveEntry(
      entry.subdir,
      entry.folder,
      entry.filename,
      LUAT_HET_HIEU_LUC_SUBDIR,
    );
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
        pdf: fileUrl,
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
