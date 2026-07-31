import { VBPL_HOST } from './constants';
import type {
  ParsedVbplAttributes,
  ParsedVbplDocument,
  RawAttributeEntry,
  RawRelationSection,
  RawVbplPage,
  RawVbplSearchItem,
  RawVbplSearchResponse,
  VbplChangeType,
  VbplConsolidation,
  VbplReferenceType,
  VbplRelation,
  VbplSearchResult,
  VbplSearchResultItem,
} from './vbpl-document.interface';

/**
 * Maps every relation-card heading vbpl.vn actually renders (confirmed against
 * the live site — both the "VĂN BẢN ĐANG XEM" self-referencing card, which
 * lists the outbound/active-voice headings, and the target-document card,
 * which lists the inbound/passive-voice headings) to a canonical
 * reference_type. `thisDocIsSource: true` = the heading is active-voice
 * ("Văn bản X" = this document does X to another); `false` = passive-voice
 * ("Văn bản được/bị X" = another document did X to this one).
 *
 * "Văn bản (được/bị) hợp nhất" is handled separately (see parseConsolidation)
 * since it's a document-level flag/FK in the schema, not a document_reference
 * row. "Văn bản liên quan cùng nội dung" is a content-similarity suggestion,
 * not a legal relationship, and is intentionally excluded — mapped to null.
 */
const RELATION_LABEL_MAP: Record<
  string,
  {
    referenceType: VbplReferenceType;
    changeType: VbplChangeType;
    thisDocIsSource: boolean;
  } | null
> = {
  'Văn bản được hướng dẫn áp dụng': {
    referenceType: 'guides',
    changeType: null,
    thisDocIsSource: false,
  },
  'Văn bản hướng dẫn áp dụng': {
    referenceType: 'guides',
    changeType: null,
    thisDocIsSource: true,
  },

  'Văn bản được quy định chi tiết, hướng dẫn thi hành': {
    referenceType: 'implements',
    changeType: null,
    thisDocIsSource: false,
  },
  'Văn bản quy định chi tiết, hướng dẫn thi hành': {
    referenceType: 'implements',
    changeType: null,
    thisDocIsSource: true,
  },

  'Văn bản được sửa đổi bổ sung': {
    referenceType: 'amends',
    changeType: null,
    thisDocIsSource: false,
  },
  'Văn bản sửa đổi bổ sung': {
    referenceType: 'amends',
    changeType: null,
    thisDocIsSource: true,
  },

  'Văn bản được đính chính': {
    referenceType: 'corrects',
    changeType: null,
    thisDocIsSource: false,
  },
  'Văn bản đính chính': {
    referenceType: 'corrects',
    changeType: null,
    thisDocIsSource: true,
  },

  'Văn bản được thay thế': {
    referenceType: 'amends',
    changeType: 'replace',
    thisDocIsSource: false,
  },
  'Văn bản thay thế': {
    referenceType: 'amends',
    changeType: 'replace',
    thisDocIsSource: true,
  },

  'Văn bản bị bãi bỏ': {
    referenceType: 'repeals',
    changeType: null,
    thisDocIsSource: false,
  },
  'Văn bản bãi bỏ': {
    referenceType: 'repeals',
    changeType: null,
    thisDocIsSource: true,
  },

  'Văn bản được dẫn chiếu': {
    referenceType: 'cites',
    changeType: null,
    thisDocIsSource: false,
  },
  'Văn bản dẫn chiếu': {
    referenceType: 'cites',
    changeType: null,
    thisDocIsSource: true,
  },

  // "Basis" has no được/bị prefix on either side — direction confirmed by
  // observation: "Căn cứ ban hành (4)" on a document lists the laws *it*
  // cites as its own legal authority (outbound); "Văn bản áp dụng" is the
  // inverse (other documents that cite this one as their basis, inbound).
  'Căn cứ ban hành': {
    referenceType: 'has_basis',
    changeType: null,
    thisDocIsSource: true,
  },
  'Văn bản áp dụng': {
    referenceType: 'has_basis',
    changeType: null,
    thisDocIsSource: false,
  },

  'Văn bản được giải thích': {
    referenceType: 'explains',
    changeType: null,
    thisDocIsSource: false,
  },
  'Văn bản giải thích': {
    referenceType: 'explains',
    changeType: null,
    thisDocIsSource: true,
  },

  'Văn bản bị đình chỉ thi hành': {
    referenceType: 'amends',
    changeType: 'suspend_execution',
    thisDocIsSource: false,
  },
  'Văn bản đình chỉ thi hành': {
    referenceType: 'amends',
    changeType: 'suspend_execution',
    thisDocIsSource: true,
  },

  'Văn bản bị tạm ngưng hiệu lực': {
    referenceType: 'amends',
    changeType: 'suspend_effect',
    thisDocIsSource: false,
  },
  'Văn bản tạm ngưng hiệu lực': {
    referenceType: 'amends',
    changeType: 'suspend_effect',
    thisDocIsSource: true,
  },

  'Văn bản được công bố': {
    referenceType: 'promulgates',
    changeType: null,
    thisDocIsSource: false,
  },
  'Văn bản công bố': {
    referenceType: 'promulgates',
    changeType: null,
    thisDocIsSource: true,
  },

  'Văn bản liên quan cùng nội dung': null,
};

const CONSOLIDATION_LABELS = {
  consolidatedInto: 'Văn bản được hợp nhất',
  consolidates: 'Văn bản hợp nhất',
};

const EMPTY_RELATION_PLACEHOLDER = '--';

/** Strips the trailing " (N)" result-count vbpl.vn appends to every card heading. */
function stripCount(categoryLabel: string): string {
  return categoryLabel.replace(/\s*\(\d+\)\s*$/, '').trim();
}

/**
 * Best-effort extraction of a citation ("45/2019/QH14", "78/2025/NĐ-CP",
 * "216-NQ-QHK4", ...) from a relation entry's raw title text. Relation
 * entries carry no href/id (confirmed — they're React click handlers, not
 * real links), so this text match is the only way to resolve a target;
 * unmatched entries stay unresolved (document_reference.target_document_id
 * left null) rather than guessing, per the forward-reference-healing design.
 */
export function extractCitationFromTitle(title: string): string | null {
  const match = title.match(/số\s+([\dA-ZĐ][\dA-ZĐ/-]*[\dA-ZĐ])/i);
  return match ? match[1] : null;
}

/** "DD/MM/YYYY" -> "YYYY-MM-DD"; "--" (vbpl.vn's empty-value placeholder) -> null. */
export function parseVbplDate(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed === EMPTY_RELATION_PLACEHOLDER) return null;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * vbpl.vn's own "Số hiệu" attribute value is normally already just the bare
 * citation (e.g. "51/2024/QH15"), but it sometimes carries a redundant
 * "<Loại văn bản> số " / "số: " / "Số hiệu: " prefix (the field's own label,
 * duplicated into its value), or even a doubled "số số " typo — confirmed
 * live on vbpl.vn itself (not introduced by scraping): the exact same law
 * appears twice in search results, once with a clean citation and once with
 * one of these dirty variants. Left unstripped, that would fracture one real
 * document into two rows under document.citation_id's uniqueness
 * constraint. Old (pre-1960s) documents citationed as "Không số" ("no
 * number") are deliberately left as-is — those don't start with "số" so
 * this pattern doesn't touch them, and their citation collisions are a
 * separate, accepted issue (see law-index plan).
 */
export function normalizeCitation(raw: string): string {
  const prefixPattern =
    /^(?:(?:bộ\s+)?luật|nghị\s+định|nghị\s+quyết|thông\s+tư(?:\s+liên\s+tịch)?|pháp\s+lệnh|quyết\s+định|chỉ\s+thị|lệnh)?\s*số(?:\s+hiệu)?\s*:?\s*/i;

  let value = raw.trim();
  for (;;) {
    const stripped = value.replace(prefixPattern, '').trim();
    if (stripped === value) break;
    value = stripped;
  }
  return value || raw.trim();
}

export function parseAttributes(
  raw: RawAttributeEntry[],
): ParsedVbplAttributes {
  const byLabel = new Map(raw.map((e) => [e.label.trim(), e.value.trim()]));
  const get = (label: string) => byLabel.get(label) ?? null;

  const citation = get('Số hiệu');
  const documentType = get('Loại văn bản');
  const issuingBody = get('Cơ quan ban hành');
  if (!citation || !documentType || !issuingBody) {
    throw new Error(
      `vbpl.vn attributes tab missing a required field (citation/documentType/issuingBody) — got labels: ${raw.map((e) => e.label).join(', ')}`,
    );
  }

  return {
    citation: normalizeCitation(citation),
    documentType,
    industry: get('Ngành'),
    field: get('Lĩnh vực'),
    issuingBody,
    signerTitle: get('Chức danh'),
    signerName: get('Người ký'),
    issuedDateRaw: get('Ngày ban hành'),
    effectiveDateRaw: get('Ngày có hiệu lực'),
    expiryDateRaw: get('Ngày hết hiệu lực'),
    validityStatusRaw: get('Tình trạng hiệu lực'),
  };
}

export function parseRelations(raw: RawRelationSection[]): {
  relations: VbplRelation[];
  consolidation: VbplConsolidation;
} {
  const relations: VbplRelation[] = [];
  const consolidatesRawTitles: string[] = [];
  const consolidatedIntoRawTitles: string[] = [];

  for (const section of raw) {
    const label = stripCount(section.categoryLabel);
    const realEntries = section.entries.filter(
      (e) => e.trim() && e.trim() !== EMPTY_RELATION_PLACEHOLDER,
    );
    if (realEntries.length === 0) continue;

    if (label === CONSOLIDATION_LABELS.consolidates) {
      consolidatesRawTitles.push(...realEntries);
      continue;
    }
    if (label === CONSOLIDATION_LABELS.consolidatedInto) {
      consolidatedIntoRawTitles.push(...realEntries);
      continue;
    }

    const mapping = RELATION_LABEL_MAP[label];
    if (mapping === undefined) {
      throw new Error(
        `Unrecognized vbpl.vn relation category "${label}" — the RELATION_LABEL_MAP in vbpl.parser.ts needs a new entry (or this is a genuinely new relation type vbpl.vn added).`,
      );
    }
    if (mapping === null) continue; // e.g. "Văn bản liên quan cùng nội dung" — intentionally not persisted

    for (const entry of realEntries) {
      relations.push({
        referenceType: mapping.referenceType,
        changeType: mapping.changeType,
        thisDocIsSource: mapping.thisDocIsSource,
        otherDocRawText: entry,
        otherDocCitation: extractCitationFromTitle(entry),
      });
    }
  }

  return {
    relations,
    consolidation: { consolidatesRawTitles, consolidatedIntoRawTitles },
  };
}

export function parseVbplPage(raw: RawVbplPage): ParsedVbplDocument {
  const attributes = parseAttributes(raw.attributes);
  const { relations, consolidation } = parseRelations(raw.relations);
  return {
    sourceUrl: raw.sourceUrl,
    scope: raw.scope,
    title: raw.title,
    fullText: raw.fullText,
    attributes,
    relations,
    consolidation,
  };
}

// ---- Search (targeted/filtered search against /van-ban/trung-uong) ----

/**
 * vbpl.vn's search POST responses are Next.js RSC ("React Server Components")
 * Flight-protocol streams, not plain JSON: each line is `<id>:<payload>`, and
 * exactly one line's payload is the JSON object carrying the actual search
 * result (the other lines carry framework-internal references). This just
 * extracts and parses that one line — it is not a reimplementation of the
 * Server Action wire protocol (see constants.ts's DISALLOWED_PATH_PREFIXES
 * comment on why that's deliberately avoided elsewhere in this module): the
 * real browser still performs the actual request, this only reads the body
 * it already produced.
 */
export function extractRscJsonPayload(body: string): unknown {
  for (const line of body.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const payload = line.slice(colonIndex + 1).trim();
    if (!payload.startsWith('{')) continue;
    try {
      return JSON.parse(payload);
    } catch {
      continue;
    }
  }
  throw new Error(
    'vbpl.vn search response had no parseable JSON object line — the RSC payload shape may have changed.',
  );
}

/**
 * Search result cards carry no href/id in the DOM (confirmed live — title
 * clicks are a React handler, not a real link), so the detail URL is built
 * from the item's id rather than read off the page. The human-readable slug
 * segment vbpl.vn puts before "--<id>" is purely cosmetic — confirmed live
 * that any placeholder slug resolves the same document — so a fixed segment
 * is used instead of replicating vbpl.vn's exact slugify rules.
 */
export function buildSearchResultUrl(id: string): string {
  return `https://${VBPL_HOST}/van-ban/chi-tiet/van-ban--${id}`;
}

/**
 * Inverse of buildSearchResultUrl — pulls vbpl.vn's own internal document id
 * back out of a document detail URL (e.g. ".../van-ban--25506" -> "25506").
 * Used by document.repository.ts to disambiguate a citation that collides
 * with a different already-stored document (see docs/monitoring/law-index-flagged-documents.md
 * §5/§6 — "Không số" and reused pre-1998 batch citations are not unique on
 * vbpl.vn, but this id always is).
 */
export function extractVbplInternalId(url: string): string | null {
  const match = url.match(/van-ban--(\d+)/);
  return match ? match[1] : null;
}

/** "2024-01-18T00:00:00" -> "2024-01-18"; null/empty -> null. */
function toDateOnly(raw: string | null | undefined): string | null {
  return raw ? raw.slice(0, 10) : null;
}

function parseSearchItem(raw: RawVbplSearchItem): VbplSearchResultItem {
  return {
    sourceUrl: buildSearchResultUrl(raw.id),
    citation: raw.docNum,
    title: raw.title,
    documentType: raw.docType?.name ?? '',
    issuingBody: raw.agencyName,
    issuedDate: toDateOnly(raw.issueDate),
    effectiveDate: toDateOnly(raw.effFrom),
    expiryDate: toDateOnly(raw.effTo),
    validityStatus: raw.effStatus?.name ?? '',
  };
}

export function parseVbplSearchResponse(
  raw: RawVbplSearchResponse,
): VbplSearchResult {
  return {
    total: raw.total,
    page: raw.pageNumber,
    pageSize: raw.pageSize,
    items: raw.items.map(parseSearchItem),
  };
}

/** Combines extractRscJsonPayload + parseVbplSearchResponse — the one entry
 * point vbpl-client.service.ts's raw response body is turned into by
 * law-index.service.ts. */
export function parseVbplSearchPage(body: string): VbplSearchResult {
  const payload = extractRscJsonPayload(body) as RawVbplSearchResponse;
  return parseVbplSearchResponse(payload);
}
