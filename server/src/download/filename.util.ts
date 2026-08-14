import { extname } from 'path';
import { foldDiacritics } from '../utils/text-normalize.util';

const MAX_SLUG_LENGTH = 80;

function slugify(text: string, maxLength: number): string {
  return foldDiacritics(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

function citationSlug(citation: string): string {
  return citation.replace(/\//g, '-').replace(/\s+/g, '');
}

/**
 * The per-law folder name: `{citation-slug}_{title-slug}`, no extension, no
 * attachment suffix. Every file belonging to one law (main text and every
 * phụ lục alike) is nested under this single folder — this is what makes it
 * the right key to group attachments by, as opposed to `buildFilename`'s
 * per-file name below.
 */
export function buildLawFolderName(citation: string, title: string): string {
  return `${citationSlug(citation)}_${slugify(title, MAX_SLUG_LENGTH)}`;
}

/**
 * Matches the existing laws/manifest.json convention: `{citation-slug}_{title-slug}{ext}`.
 * A document can have several attachments (e.g. a decree plus phụ lục annexes) —
 * when there's more than one, a 1-based `-{index}` suffix keeps filenames distinct
 * within their shared `buildLawFolderName` folder; a single-attachment document
 * (the common case) gets the plain, suffix-free name.
 */
export function buildFilename(
  citation: string,
  title: string,
  fileUrl: string,
  fileIndex = 0,
  fileCount = 1,
): string {
  const titleSlug = slugify(title, MAX_SLUG_LENGTH);
  const ext = extname(new URL(fileUrl).pathname) || '.pdf';
  const suffix = fileCount > 1 ? `-${fileIndex + 1}` : '';
  return `${citationSlug(citation)}_${titleSlug}${suffix}${ext}`;
}
