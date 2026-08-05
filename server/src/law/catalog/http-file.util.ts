import { extname } from 'path';

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function mimeTypeForFilename(filename: string): string {
  return (
    MIME_TYPES[extname(filename).toLowerCase()] ?? 'application/octet-stream'
  );
}

/** RFC 5987 — filenames here carry Vietnamese diacritics that plain `filename=` can't safely encode. */
export function buildContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
