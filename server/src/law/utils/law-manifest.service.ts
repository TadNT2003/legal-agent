import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  appendFile,
  access,
} from 'fs/promises';
import { join } from 'path';
import { lawDownloadConfig } from './law-download.config';
import type { ManifestEntry } from './download-outcome.interface';
import { TIER_DEFINITIONS } from './tier-definitions';

const LOG_HEADER = 'citation,subdir,filename,http_code,bytes';

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

@Injectable()
export class LawManifestService implements OnModuleInit {
  constructor(
    @Inject(lawDownloadConfig.KEY)
    private readonly config: ConfigType<typeof lawDownloadConfig>,
  ) {}

  /**
   * Scaffolds LAWS_DOWNLOAD_DIR on startup: the 14 tier folders (tier 2's
   * known luat/luat-het-hieu-luc/luat-sua-doi-bo-sung/nghi-quyet-quoc-hoi
   * split included), manifest.json, download-log.csv, and a dataset README.
   * Every step only fills in what's missing — pointing this at the existing
   * ../laws/ dataset is a no-op, not a resync.
   */
  async onModuleInit(): Promise<void> {
    await mkdir(this.config.dir, { recursive: true });

    for (const tier of TIER_DEFINITIONS) {
      const tierDir = join(this.config.dir, tier.subdir);
      await mkdir(tierDir, { recursive: true });
      for (const child of tier.children ?? []) {
        await mkdir(join(tierDir, child), { recursive: true });
      }
      await this.ensureTierReadme(tier.subdir, tier.description);
    }

    await this.ensureManifestFile();
    await this.ensureLogFile();
    await this.ensureDatasetReadme();
  }

  private async ensureTierReadme(
    subdir: string,
    description: string,
  ): Promise<void> {
    const tierDir = join(this.config.dir, subdir);
    const entries = await readdir(tierDir);
    if (entries.length > 0) return; // real docs, known sub-folders, or an existing README — leave it alone

    const tierNumber = parseInt(subdir.split('-')[0], 10);
    const content = `# Tier ${tierNumber}\n\n${description}\n\nNguồn: Điều 4 Luật Ban hành văn bản quy phạm pháp luật - số 64/2025/QH15 (xem [docs/vn-legal-document-structure.md](../../docs/vn-legal-document-structure.md)).\n\nNo documents downloaded for this tier yet.\n`;
    await writeFile(join(tierDir, 'README.md'), content);
  }

  private async ensureManifestFile(): Promise<void> {
    try {
      await access(this.manifestPath);
    } catch {
      await writeFile(this.manifestPath, '[]\n');
    }
  }

  private async ensureLogFile(): Promise<void> {
    try {
      await access(this.logPath);
    } catch {
      await writeFile(this.logPath, LOG_HEADER + '\n');
    }
  }

  private async ensureDatasetReadme(): Promise<void> {
    const readmePath = join(this.config.dir, 'README.md');
    try {
      await access(readmePath);
      return; // never overwrite a hand-written one (e.g. the real laws/README.md)
    } catch {
      // fall through and create it
    }

    const tierRows = TIER_DEFINITIONS.map(
      (tier) =>
        `| \`${tier.subdir}/\` | ${parseInt(tier.subdir.split('-')[0], 10)}. ${tier.description.replace(/\.$/, '')} |`,
    ).join('\n');

    const content = `# Downloaded laws

Populated by \`server/src/law/download/\` (see [server/README.md](../server/README.md#law-document-downloads)) from [vanban.chinhphu.vn](https://vanban.chinhphu.vn/).

## Structure

Top-level folders correspond to the 14 tiers of the "Hệ thống văn bản quy phạm pháp luật" (Điều 4, Luật 64/2025/QH15 — see [docs/vn-legal-document-structure.md](../docs/vn-legal-document-structure.md)). Only tiers with downloaded documents have content; the rest contain a \`README.md\` placeholder describing the tier.

| Folder | Tier |
| - | - |
${tierRows}

## Files

- \`manifest.json\` — tracking list of every downloaded file: citation, title, date, source URL, subdir, filename. Reflects current state — one row per file on disk.
- \`download-log.csv\` — append-only HTTP status and byte size per download attempt, for verifying nothing is truncated/corrupt. Distinct from \`manifest.json\`: a re-download adds a new row here but only updates the one existing manifest entry.
`;
    await writeFile(readmePath, content);
  }

  get dir(): string {
    return this.config.dir;
  }

  private get manifestPath(): string {
    return join(this.config.dir, 'manifest.json');
  }

  private get logPath(): string {
    return join(this.config.dir, 'download-log.csv');
  }

  /** `relativeDir` is a path relative to `this.dir` — typically `join(subdir, folder)`. */
  async fileExists(relativeDir: string, filename: string): Promise<boolean> {
    try {
      await access(join(this.config.dir, relativeDir, filename));
      return true;
    } catch {
      return false;
    }
  }

  /** `relativeDir` is a path relative to `this.dir` — typically `join(subdir, folder)`. */
  async ensureTargetDir(relativeDir: string): Promise<string> {
    const dir = join(this.config.dir, relativeDir);
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
      (e) =>
        e.subdir === entry.subdir &&
        e.folder === entry.folder &&
        e.filename === entry.filename,
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

  /** Repoints an existing entry to a new subdir in place (folder name is unchanged) — the caller is responsible for moving the file itself. */
  async moveEntry(
    oldSubdir: string,
    folder: string,
    filename: string,
    newSubdir: string,
  ): Promise<void> {
    const manifest = await this.readManifest();
    const idx = manifest.findIndex(
      (e) =>
        e.subdir === oldSubdir &&
        e.folder === folder &&
        e.filename === filename,
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
