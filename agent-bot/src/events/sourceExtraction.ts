import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

/**
 * A single legal document referenced in a session's tool-call history, with an
 * optional source link so users can open the document on vbpl.vn.
 */
export interface SourceRef {
  title: string;
  citation: string;
  sourceUrl?: string;
}

/**
 * The keys under which the MCP `search_documents` tool returns its documents,
 * in priority order. `items` is the real shape returned by legal-mcp today
 * (LawSearchResult.items); `documents`/`results` are defensive fallbacks for
 * any other tool or a future shape change.
 */
const DOC_ARRAY_KEYS = ['items', 'documents', 'results'] as const;

function toStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function firstString(doc: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = toStr(doc[key]);
    if (value) return value;
  }
  return undefined;
}

/**
 * Extracts the legal documents an agent consulted during a session from its
 * tool-call history. Scans every `tool` message, JSON-parses the content, and
 * pulls each document's title, citation, and source link from the first
 * present array under `items`/`documents`/`results`. Deduplicates by
 * (citation, sourceUrl) — a document surfaced by several rounds appears once.
 *
 * Returns an empty array when the session has no tool calls or none of the
 * tool results contained a document array (rather than throwing), so callers
 * can simply check `.length`.
 */
export function extractSources(
  messages: ChatCompletionMessageParam[],
): SourceRef[] {
  const sources: SourceRef[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== 'tool' || typeof msg.content !== 'string') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.content);
    } catch {
      // Not JSON (e.g. an error string). Nothing to extract.
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;

    const record = parsed as Record<string, unknown>;
    for (const key of DOC_ARRAY_KEYS) {
      const arr = record[key];
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) {
        if (typeof raw !== 'object' || raw === null) continue;
        const doc = raw as Record<string, unknown>;

        const title = firstString(doc, ['title', 'tieuDe']) ?? '';
        const citation =
          firstString(doc, ['citation', 'soHieu']) ?? '';
        const sourceUrl = firstString(doc, ['sourceUrl', 'source_url', 'link']);

        if (!title && !citation) continue;

        const dedupeKey = `${citation}\u0000${sourceUrl ?? ''}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        sources.push({
          title,
          citation,
          ...(sourceUrl ? { sourceUrl } : {}),
        });
      }
      break; // first matching array key wins for this message
    }
  }

  return sources;
}

/**
 * Renders extracted sources as a plain "title — citation" list (no links),
 * matching the format the follow-up "Chi tiết" button has always shown.
 * Kept separate from extractSources so that path's output stays byte-for-byte
 * what existing users (and tests) already expect.
 */
export function sourcesToCitationLines(sources: SourceRef[]): string[] {
  return sources.map((s) => {
    const entry = `${s.title ? `${s.title} — ` : ''}${s.citation || '(không có trích dẫn)'}`;
    return entry;
  });
}