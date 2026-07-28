import { Injectable, NotFoundException } from '@nestjs/common';
import { access, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { resolveBestMatch, type DocumentQuery } from './document-matcher';
import type { ManifestEntry } from './interfaces/download-outcome.interface';
import { LawManifestService } from './law-manifest.service';

const EXCLUDED_FILENAMES = new Set(['README.md']);

export interface FolderStats {
  subdir: string;
  documentCount: number;
  totalBytes: number;
  children?: FolderStats[];
}

export interface DocumentLookupResult {
  entry: ManifestEntry;
  score: number;
  absolutePath: string;
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
        ),
      ),
    );
  }

  async findDocument(query: DocumentQuery): Promise<DocumentLookupResult> {
    const manifest = await this.manifest.readManifest();
    const match = resolveBestMatch(manifest, query);
    if (!match) {
      throw new NotFoundException('No matching document found.');
    }

    const absolutePath = join(
      this.manifest.dir,
      match.entry.subdir,
      match.entry.filename,
    );
    try {
      await access(absolutePath);
    } catch {
      throw new NotFoundException(
        `"${match.entry.filename}" is listed in manifest.json but is missing on disk.`,
      );
    }

    return { entry: match.entry, score: match.score, absolutePath };
  }

  private async scanDirectory(
    absoluteDir: string,
    relativeSubdir: string,
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
        );
        children.push(childStats);
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
