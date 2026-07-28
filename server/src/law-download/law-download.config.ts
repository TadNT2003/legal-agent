import { registerAs } from '@nestjs/config';
import { resolve } from 'path';

export const lawDownloadConfig = registerAs('lawDownload', () => ({
  // Resolved against the process cwd (server/ in dev), so the default lands
  // on the repo-root laws/ directory documented in laws/README.md.
  dir: resolve(process.cwd(), process.env.LAWS_DOWNLOAD_DIR ?? '../laws'),
}));
