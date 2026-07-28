import { extname } from 'path';

const MAX_SLUG_LENGTH = 80;

function slugify(text: string, maxLength: number): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (post-NFD combining marks)
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * Matches the existing laws/manifest.json convention: `{citation-slug}_{title-slug}{ext}`.
 * A document can have several attachments (e.g. a decree plus phụ lục annexes) —
 * when there's more than one, a 1-based `-{index}` suffix keeps filenames distinct;
 * a single-attachment document (the common case) gets the plain, suffix-free name.
 */
export function buildFilename(
  citation: string,
  title: string,
  fileUrl: string,
  fileIndex = 0,
  fileCount = 1,
): string {
  const citationSlug = citation.replace(/\//g, '-').replace(/\s+/g, '');
  const titleSlug = slugify(title, MAX_SLUG_LENGTH);
  const ext = extname(new URL(fileUrl).pathname) || '.pdf';
  const suffix = fileCount > 1 ? `-${fileIndex + 1}` : '';
  return `${citationSlug}_${titleSlug}${suffix}${ext}`;
}
