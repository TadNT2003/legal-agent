import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { mkdir, readFile, writeFile, appendFile, access } from 'fs/promises';
import { join } from 'path';
import { lawDownloadConfig } from './law-download.config';
import type { ManifestEntry } from './interfaces/download-outcome.interface';

const LOG_HEADER = 'citation,subdir,filename,http_code,bytes';

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

@Injectable()
export class LawManifestService {
  constructor(
    @Inject(lawDownloadConfig.KEY)
    private readonly config: ConfigType<typeof lawDownloadConfig>,
  ) {}

  get dir(): string {
    return this.config.dir;
  }

  private get manifestPath(): string {
    return join(this.config.dir, 'manifest.json');
  }

  private get logPath(): string {
    return join(this.config.dir, 'download-log.csv');
  }

  async fileExists(subdir: string, filename: string): Promise<boolean> {
    try {
      await access(join(this.config.dir, subdir, filename));
      return true;
    } catch {
      return false;
    }
  }

  async ensureTargetDir(subdir: string): Promise<string> {
    const dir = join(this.config.dir, subdir);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async readManifest(): Promise<ManifestEntry[]> {
    try {
      const raw = await readFile(this.manifestPath, 'utf8');
      return JSON.parse(raw) as ManifestEntry[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async upsertEntry(entry: ManifestEntry): Promise<void> {
    const manifest = await this.readManifest();
    const idx = manifest.findIndex(
      (e) => e.subdir === entry.subdir && e.filename === entry.filename,
    );
    if (idx >= 0) {
      manifest[idx] = entry;
    } else {
      manifest.push(entry);
    }
    await writeFile(
      this.manifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
    );
  }

  /** Repoints an existing entry to a new subdir in place — the caller is responsible for moving the file itself. */
  async moveEntry(
    oldSubdir: string,
    filename: string,
    newSubdir: string,
  ): Promise<void> {
    const manifest = await this.readManifest();
    const idx = manifest.findIndex(
      (e) => e.subdir === oldSubdir && e.filename === filename,
    );
    if (idx === -1) return;
    manifest[idx] = { ...manifest[idx], subdir: newSubdir };
    await writeFile(
      this.manifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
    );
  }

  async appendLogEntry(entry: {
    citation: string;
    subdir: string;
    filename: string;
    httpCode: number;
    bytes: number;
  }): Promise<void> {
    let needsHeader = false;
    try {
      await access(this.logPath);
    } catch {
      needsHeader = true;
    }
    const line = `${csvField(entry.citation)},${csvField(entry.subdir)},${csvField(entry.filename)},${entry.httpCode},${entry.bytes}\n`;
    await appendFile(
      this.logPath,
      (needsHeader ? LOG_HEADER + '\n' : '') + line,
    );
  }
}
