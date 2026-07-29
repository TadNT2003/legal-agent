export interface DownloadOutcome {
  citation: string;
  title: string;
  sourceUrl: string;
  fileUrl: string | null;
  subdir: string | null;
  folder: string | null;
  filename: string | null;
  httpStatus: number | null;
  bytes: number | null;
  skipped: boolean;
  error: string | null;
}

export interface ManifestEntry {
  citation: string;
  title: string;
  date: string | null;
  pdf: string;
  subdir: string;
  /** Per-law folder (one law = one folder) nested under `subdir` — holds every file for this citation, main text and phụ lục alike. */
  folder: string;
  filename: string;
}
