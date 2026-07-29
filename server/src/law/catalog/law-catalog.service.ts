import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { access, readdir, stat } from 'fs/promises';
import { join } from 'path';
import {
  findByCitation,
  resolveBestMatch,
  type DocumentQuery,
} from '../utils/document-matcher';
import type { ManifestEntry } from '../utils/download-outcome.interface';
import { LawManifestService } from '../utils/law-manifest.service';
import { TIER_DEFINITIONS } from '../utils/tier-definitions';

const EXCLUDED_FILENAMES = new Set(['README.md']);

export interface FolderStats {
  subdir: string;
  documentCount: number;
  totalBytes: number;
  children?: FolderStats[];
}

export interface DocumentFile {
  entry: ManifestEntry;
  absolutePath: string;
}

export interface DocumentGroupLookupResult {
  citation: string;
  title: string;
  score: number;
  /** Every file sharing the matched document's citation — main text and phụ lục alike. */
  files: DocumentFile[];
}

export interface DocumentStatusFile {
  /** The raw manifest.json row — citation, title, date, source URL, subdir, folder, filename. */
  entry: ManifestEntry;
  existsOnDisk: boolean;
}

export interface DocumentStatusResult {
  citation: string;
  title: string;
  score: number;
  fileCount: number;
  files: DocumentStatusFile[];
}

@Injectable()
export class LawCatalogService {
  constructor(private readonly manifest: LawManifestService) {}

  async getTierOverview(): Promise<FolderStats[]> {
    let entries;
    try {
      entries = await readdir(this.manifest.dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const tierDirs = entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    return Promise.all(
      tierDirs.map((dirEntry) =>
        this.scanDirectory(
          join(this.manifest.dir, dirEntry.name),
          dirEntry.name,
          false,
        ),
      ),
    );
  }

  /** Document count and total size for one tier (1-14, per Điều 4 Luật 64/2025/QH15), recursing into its sub-folders. */
  async getTierStats(tier: number): Promise<FolderStats> {
    const definition = TIER_DEFINITIONS[tier - 1];
    if (!Number.isInteger(tier) || !definition) {
      throw new BadRequestException(
        `tier must be an integer from 1 to ${TIER_DEFINITIONS.length}.`,
      );
    }

    const absoluteDir = join(this.manifest.dir, definition.subdir);
    try {
      return await this.scanDirectory(absoluteDir, definition.subdir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { subdir: definition.subdir, documentCount: 0, totalBytes: 0 };
      }
      throw err;
    }
  }

  /**
   * Resolves the query to one document (by citation, or closest title match)
   * the same way `findDocument` used to, then returns every file sharing that
   * document's citation — a law with phụ lục attachments comes back as the
   * main text plus every annex, not just whichever file matched first.
   */
  async findDocumentGroup(
    query: DocumentQuery,
  ): Promise<DocumentGroupLookupResult> {
    const manifestEntries = await this.manifest.readManifest();
    const match = resolveBestMatch(manifestEntries, query);
    if (!match) {
      throw new NotFoundException('No matching document found.');
    }

    const siblings = findByCitation(manifestEntries, match.entry.citation);
    const files = await Promise.all(
      siblings.map((entry) => this.resolveOnDisk(entry)),
    );

    return {
      citation: match.entry.citation,
      title: match.entry.title,
      score: match.score,
      files,
    };
  }

  /**
   * Same resolution as `findDocumentGroup` (citation or closest title match,
   * same document group), but reports manifest.json metadata + on-disk
   * presence per file instead of streaming content — a missing file is
   * reported as `existsOnDisk: false`, not a thrown 404, since the point of
   * a status check is to surface exactly that kind of drift.
   */
  async getDocumentStatus(query: DocumentQuery): Promise<DocumentStatusResult> {
    const manifestEntries = await this.manifest.readManifest();
    const match = resolveBestMatch(manifestEntries, query);
    if (!match) {
      throw new NotFoundException('No matching document found.');
    }

    const siblings = findByCitation(manifestEntries, match.entry.citation);
    const files = await Promise.all(
      siblings.map(async (entry) => ({
        entry,
        existsOnDisk: await this.existsOnDisk(entry),
      })),
    );

    return {
      citation: match.entry.citation,
      title: match.entry.title,
      score: match.score,
      fileCount: files.length,
      files,
    };
  }

  private absolutePathFor(entry: ManifestEntry): string {
    return join(this.manifest.dir, entry.subdir, entry.folder, entry.filename);
  }

  private async existsOnDisk(entry: ManifestEntry): Promise<boolean> {
    try {
      await access(this.absolutePathFor(entry));
      return true;
    } catch {
      return false;
    }
  }

  private async resolveOnDisk(entry: ManifestEntry): Promise<DocumentFile> {
    const absolutePath = this.absolutePathFor(entry);
    if (!(await this.existsOnDisk(entry))) {
      throw new NotFoundException(
        `"${entry.filename}" is listed in manifest.json but is missing on disk.`,
      );
    }
    return { entry, absolutePath };
  }

  /**
   * `includeChildren` still walks the full tree either way (needed for
   * accurate totals) — set to `false` to get aggregate counts without the
   * per-law-folder-level breakdown (see `getTierOverview`, which would
   * otherwise list every single downloaded document).
   */
  private async scanDirectory(
    absoluteDir: string,
    relativeSubdir: string,
    includeChildren = true,
  ): Promise<FolderStats> {
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    let documentCount = 0;
    let totalBytes = 0;
    const children: FolderStats[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const childStats = await this.scanDirectory(
          join(absoluteDir, entry.name),
          `${relativeSubdir}/${entry.name}`,
          includeChildren,
        );
        if (includeChildren) children.push(childStats);
        documentCount += childStats.documentCount;
        totalBytes += childStats.totalBytes;
      } else if (
        entry.isFile() &&
        !EXCLUDED_FILENAMES.has(entry.name) &&
        !entry.name.endsWith('.part')
      ) {
        const fileStats = await stat(join(absoluteDir, entry.name));
        documentCount += 1;
        totalBytes += fileStats.size;
      }
    }

    return {
      subdir: relativeSubdir,
      documentCount,
      totalBytes,
      ...(children.length > 0 ? { children } : {}),
    };
  }
}
