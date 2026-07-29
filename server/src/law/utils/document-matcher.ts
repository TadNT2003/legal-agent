import Fuse from 'fuse.js';
import type { ManifestEntry } from './download-outcome.interface';
import { foldDiacritics } from './text-normalize.util';

const TITLE_MATCH_THRESHOLD = 0.4;

export interface DocumentQuery {
  citation?: string;
  title?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface DocumentMatch {
  entry: ManifestEntry;
  /** 0 = exact citation match; otherwise Fuse.js's score (0 = perfect, 1 = worst). */
  score: number;
}

export function parseManifestDate(date: string | null): Date | null {
  if (!date) return null;
  const match = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

export function filterByDateRange(
  entries: ManifestEntry[],
  dateFrom: string | undefined,
  dateTo: string | undefined,
): ManifestEntry[] {
  if (!dateFrom && !dateTo) return entries;
  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(dateTo) : null;
  return entries.filter((entry) => {
    const entryDate = parseManifestDate(entry.date);
    if (!entryDate) return false;
    if (from && entryDate < from) return false;
    if (to && entryDate > to) return false;
    return true;
  });
}

function subjectKey(title: string): string {
  return foldDiacritics(title).toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Finds a different document in `subdir` covering the same subject as `title`
 * (Vietnamese replacement laws — luật thay thế — keep the same title across
 * versions; only the citation changes, unlike amendments which get "sửa đổi,
 * bổ sung" prepended). Excludes entries with the same citation so re-downloading
 * a document already in place is never mistaken for a supersession conflict.
 */
export function findSupersededConflict(
  entries: ManifestEntry[],
  subdir: string,
  citation: string,
  title: string,
): ManifestEntry | null {
  const key = subjectKey(title);
  const normalizedCitation = citation.trim().toLowerCase();
  return (
    entries.find(
      (entry) =>
        entry.subdir === subdir &&
        entry.citation.trim().toLowerCase() !== normalizedCitation &&
        subjectKey(entry.title) === key,
    ) ?? null
  );
}

export function findByCitation(
  entries: ManifestEntry[],
  citation: string,
): ManifestEntry[] {
  const normalized = citation.trim().toLowerCase();
  return entries.filter(
    (entry) => entry.citation.trim().toLowerCase() === normalized,
  );
}

export function findByTitleFuzzy(
  entries: ManifestEntry[],
  title: string,
): DocumentMatch[] {
  if (entries.length === 0) return [];
  const normalizedQuery = foldDiacritics(title).toLowerCase();
  const indexed = entries.map((entry) => ({
    entry,
    normalizedTitle: foldDiacritics(entry.title).toLowerCase(),
  }));
  const fuse = new Fuse(indexed, {
    keys: ['normalizedTitle'],
    includeScore: true,
    threshold: TITLE_MATCH_THRESHOLD,
  });
  return fuse.search(normalizedQuery).map((result) => ({
    entry: result.item.entry,
    score: result.score ?? 1,
  }));
}

/**
 * Citation is an exact (case-insensitive) match against a structured identifier —
 * fuzziness is reserved for title, where "closest match" was explicitly wanted.
 * When several files share a citation (a document with multiple attachments),
 * the one inserted first into the manifest (typically the main text, not an annex) wins.
 */
export function resolveBestMatch(
  entries: ManifestEntry[],
  query: DocumentQuery,
): DocumentMatch | null {
  const dateFiltered = filterByDateRange(entries, query.dateFrom, query.dateTo);

  let candidates: DocumentMatch[];
  if (query.citation) {
    candidates = findByCitation(dateFiltered, query.citation).map((entry) => ({
      entry,
      score: 0,
    }));
  } else if (query.title) {
    candidates = findByTitleFuzzy(dateFiltered, query.title);
  } else {
    candidates = [];
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const aTime = parseManifestDate(a.entry.date)?.getTime() ?? 0;
    const bTime = parseManifestDate(b.entry.date)?.getTime() ?? 0;
    return bTime - aTime;
  });

  return candidates[0];
}
