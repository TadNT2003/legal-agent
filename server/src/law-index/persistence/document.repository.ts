import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  and,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type {
  ParsedVbplDocument,
  VbplChangeType,
  VbplReferenceType,
  VbplSearchFilters,
  VbplSearchResult,
} from '../crawl/vbpl-document.interface';
import { extractCitationFromTitle, parseVbplDate } from '../crawl/vbpl.parser';
import { DRIZZLE, type DrizzleDb } from './db.module';
import { document, issuingBody, documentReference } from './schema';

/** `eq()` never matches NULL — use this for columns (like changeType) that are legitimately nullable. */
function nullSafeEq(column: AnyPgColumn, value: string | null) {
  return value === null ? isNull(column) : eq(column, value);
}

/** Rough issuing-body-name -> tier proxy for the required, not-null
 * `authority_rank` column. vbpl.vn's attributes tab gives us the issuing
 * body's *name*, not a rank — this is a best-effort heuristic (lower =
 * higher authority, mirroring Điều 4's tier ordering), not a verified
 * mapping. Revisit once a real classifier is needed. */
function estimateAuthorityRank(issuingBodyName: string): number {
  const name = issuingBodyName.toLowerCase();
  if (name.includes('ủy ban thường vụ quốc hội')) return 3;
  if (name === 'quốc hội' || name.includes('quốc hội')) return 2;
  if (name.includes('chủ tịch nước')) return 4;
  if (name.includes('thủ tướng')) return 6;
  if (name === 'chính phủ' || name.includes('chính phủ')) return 5;
  if (name.includes('hội đồng thẩm phán')) return 7;
  // Ministries, TANDTC/VKSNDTC/Kiểm toán nhà nước thông tư-issuing bodies.
  return 8;
}

function computeContentVersion(parsed: ParsedVbplDocument): string {
  const hash = createHash('sha256');
  hash.update(parsed.fullText);
  hash.update(parsed.attributes.citation);
  hash.update(parsed.title);
  hash.update(parsed.attributes.validityStatusRaw ?? '');
  hash.update(parsed.attributes.effectiveDateRaw ?? '');
  hash.update(parsed.attributes.expiryDateRaw ?? '');
  return hash.digest('hex');
}

/** Matches citation patterns in body text: "104/2016/QH13", "78/2025/NĐ-CP", "03/2009/TT-BNG", "203/2025/QH15", "216-NQ-QHK4". */
const CITATION_RE =
  /\b(\d{1,3}\/\d{4}\/(?:[A-Z]{2,5}(?:-\d+)?-CP|TT-[A-Z]{2,5}|QH\d+|NQ-[A-ZĐ]{1,3}\d+|QĐ-[A-Z]{2,5}))\b/;
const CITATION_RE_GLOBAL = new RegExp(CITATION_RE.source, 'g');

const VALIDITY_STATUS_MAP: Record<
  string,
  (typeof document.$inferInsert)['status']
> = {
  'chưa có hiệu lực': 'chua_co_hieu_luc',
  'còn hiệu lực': 'con_hieu_luc',
  'hết hiệu lực toàn bộ': 'het_hieu_luc',
  'hết hiệu lực': 'het_hieu_luc',
  'hết hiệu lực một phần': 'het_hieu_luc_mot_phan',
  'ngưng hiệu lực': 'ngung_hieu_luc',
  'tạm ngưng hiệu lực': 'ngung_hieu_luc',
};

/**
 * Only "Chưa có hiệu lực" has been directly confirmed against the live site
 * so far (see the law-index plan's implementation-time task list) — the
 * other 4 mappings are the best-guess Vietnamese phrasing for
 * docs/schema/legal-agent.dbml's validity_status enum values, not yet
 * cross-checked against real documents. Throws rather than guessing further
 * on an unrecognized (but present) string, matching this codebase's existing
 * fail-loud-on-unclassifiable convention (see law-tier-classifier.ts) — but
 * `raw === null` (vbpl.vn's attributes tab has no "Tình trạng hiệu lực" row
 * at all, confirmed live on some very-recently-issued documents) maps to
 * `null` rather than throwing, since that's a known upstream data gap, not
 * an unrecognized value.
 */
function mapValidityStatus(
  raw: string | null,
): (typeof document.$inferInsert)['status'] {
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  const mapped = VALIDITY_STATUS_MAP[normalized];
  if (!mapped) {
    throw new Error(
      `Unrecognized vbpl.vn "Tình trạng hiệu lực" value: "${raw}" — add it to VALIDITY_STATUS_MAP in document.repository.ts.`,
    );
  }
  return mapped;
}

export interface UpsertResult {
  documentId: string;
  changed: boolean;
}

export interface ReferenceRow {
  id: string;
  sourceDocumentId: string | null;
  sourceCitationId: string | null;
  sourceTitle: string | null;
  targetDocumentId: string | null;
  targetCitationId: string | null;
  targetTitle: string | null;
  referenceType: string;
  changeType: string | null;
  rawCitationText: string;
  createdAt: string;
}

/** Shape written into document.rawSource on every upsert (see upsertDocument
 * below) — kept here so searchLocalDocuments can read it back without an
 * `any` cast. Note there is no expiry-date field: vbpl.vn's "Ngày hết hiệu
 * lực" is parsed (ParsedVbplAttributes.expiryDateRaw) and folded into
 * content_version's hash, but isn't persisted as its own document column or
 * raw_source key yet — searchLocalDocuments's expiryDate is always null
 * until that's added. */
interface DocumentRawSource {
  fullText: string;
  scrapedAt: string;
  sourceUrl: string;
  consolidatesRawTitles: string[];
  consolidatedIntoRawTitles: string[];
}

@Injectable()
export class DocumentRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  getDb(): DrizzleDb {
    return this.db;
  }

  async findDocumentIdByCitation(citation: string): Promise<string | null> {
    const row = await this.db.query.document.findFirst({
      where: eq(document.citationId, citation),
      columns: { id: true },
    });
    return row?.id ?? null;
  }

  async resolveOrCreateIssuingBody(name: string): Promise<string> {
    const existing = await this.db.query.issuingBody.findFirst({
      where: eq(issuingBody.name, name),
      columns: { id: true },
    });
    if (existing) return existing.id;

    const [inserted] = await this.db
      .insert(issuingBody)
      .values({ name, authorityRank: estimateAuthorityRank(name) })
      .onConflictDoNothing({ target: issuingBody.name })
      .returning({ id: issuingBody.id });
    if (inserted) return inserted.id;

    // Lost an insert race — the row exists now, fetch it.
    const raceWinner = await this.db.query.issuingBody.findFirst({
      where: eq(issuingBody.name, name),
      columns: { id: true },
    });
    if (!raceWinner)
      throw new Error(`Failed to resolve or create issuing_body "${name}"`);
    return raceWinner.id;
  }

  /** Upserts the document row (skipping the write entirely if content_version is unchanged) and its relations. */
  async upsertDocument(parsed: ParsedVbplDocument): Promise<UpsertResult> {
    const issuingBodyId = await this.resolveOrCreateIssuingBody(
      parsed.attributes.issuingBody,
    );
    const contentVersion = computeContentVersion(parsed);

    const existing = await this.db.query.document.findFirst({
      where: eq(document.citationId, parsed.attributes.citation),
    });
    if (existing && existing.contentVersion === contentVersion) {
      return { documentId: existing.id, changed: false };
    }

    const enactedDate = parseVbplDate(parsed.attributes.issuedDateRaw);
    if (!enactedDate) {
      throw new Error(
        `Document ${parsed.attributes.citation} has no parseable "Ngày ban hành" — got "${parsed.attributes.issuedDateRaw}"`,
      );
    }

    const isConsolidated =
      parsed.consolidation.consolidatesRawTitles.length > 0;
    const consolidatesDocumentId = await this.resolveFirstCitation(
      parsed.consolidation.consolidatesRawTitles,
    );

    const values = {
      citationId: parsed.attributes.citation,
      title: parsed.title,
      documentType: parsed.attributes.documentType,
      issuingBodyId,
      industry: parsed.attributes.industry,
      field: parsed.attributes.field,
      signerName: parsed.attributes.signerName,
      signerTitle: parsed.attributes.signerTitle,
      enactedDate,
      effectiveDate: parseVbplDate(parsed.attributes.effectiveDateRaw),
      status: mapValidityStatus(parsed.attributes.validityStatusRaw),
      isConsolidated,
      consolidatesDocumentId,
      rawSource: {
        fullText: parsed.fullText,
        scrapedAt: new Date().toISOString(),
        sourceUrl: parsed.sourceUrl,
        consolidatesRawTitles: parsed.consolidation.consolidatesRawTitles,
        consolidatedIntoRawTitles:
          parsed.consolidation.consolidatedIntoRawTitles,
      },
      contentVersion,
    };

    if (existing) {
      await this.db
        .update(document)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(document.id, existing.id));
      return { documentId: existing.id, changed: true };
    }

    const [inserted] = await this.db
      .insert(document)
      .values(values)
      .returning({ id: document.id });
    return { documentId: inserted.id, changed: true };
  }

  /**
   * Persists relations from the outbound (this-document-is-source) side only.
   * An inbound-labeled relation (e.g. "Văn bản được thay thế") is the exact
   * mirror of another document's outbound relation ("Văn bản thay thế") — if
   * that other document is already scraped we resolve and insert it now
   * (source = the other doc); if not, we skip rather than insert a
   * null-source row, and rely on that document's own future scrape to
   * report the same edge from its outbound side. This keeps every inserted
   * row anchored to a real, known document on at least one side.
   */
  async upsertRelations(
    thisDocumentId: string,
    parsed: ParsedVbplDocument,
  ): Promise<void> {
    for (const rel of parsed.relations) {
      if (rel.thisDocIsSource) {
        const targetId = rel.otherDocCitation
          ? await this.findDocumentIdByCitation(rel.otherDocCitation)
          : null;
        await this.insertReferenceIfNotExists({
          sourceDocumentId: thisDocumentId,
          targetDocumentId: targetId,
          referenceType: rel.referenceType,
          changeType: rel.changeType,
          rawCitationText: rel.otherDocRawText,
        });
        continue;
      }

      if (!rel.otherDocCitation) continue;
      const sourceId = await this.findDocumentIdByCitation(
        rel.otherDocCitation,
      );
      if (!sourceId) continue;
      await this.insertReferenceIfNotExists({
        sourceDocumentId: sourceId,
        targetDocumentId: thisDocumentId,
        referenceType: rel.referenceType,
        changeType: rel.changeType,
        rawCitationText: rel.otherDocRawText,
      });
    }
  }

  /** Re-resolves document_reference rows left dangling (target unresolved at scrape time) — call periodically, e.g. after each crawl batch. */
  async healDanglingReferences(): Promise<number> {
    const dangling = await this.db.query.documentReference.findMany({
      where: isNull(documentReference.targetDocumentId),
    });

    let healed = 0;
    for (const row of dangling) {
      const citation = extractCitationFromTitle(row.rawCitationText);
      if (!citation) continue;
      const targetId = await this.findDocumentIdByCitation(citation);
      if (!targetId) continue;
      await this.db
        .update(documentReference)
        .set({ targetDocumentId: targetId })
        .where(eq(documentReference.id, row.id));
      healed += 1;
    }
    return healed;
  }

  private async resolveFirstCitation(
    rawTitles: string[],
  ): Promise<string | null> {
    for (const title of rawTitles) {
      const citation = extractCitationFromTitle(title);
      if (!citation) continue;
      const id = await this.findDocumentIdByCitation(citation);
      if (id) return id;
    }
    return null;
  }

  private async insertReferenceIfNotExists(params: {
    sourceDocumentId: string;
    targetDocumentId: string | null;
    referenceType: VbplReferenceType;
    changeType: VbplChangeType;
    rawCitationText: string;
  }): Promise<void> {
    // Dedup key: once the target is resolved, (source, target, type, change)
    // identifies the edge; until then, (source, type, change, rawCitationText)
    // does, since target is null for every unresolved row on the same source.
    // changeType is null far more often than not (only `amends` ever sets
    // one) and eq() doesn't match NULL — nullSafeEq below handles that.
    const dedupWhere = params.targetDocumentId
      ? and(
          eq(documentReference.sourceDocumentId, params.sourceDocumentId),
          eq(documentReference.targetDocumentId, params.targetDocumentId),
          eq(documentReference.referenceType, params.referenceType),
          nullSafeEq(documentReference.changeType, params.changeType),
        )
      : and(
          eq(documentReference.sourceDocumentId, params.sourceDocumentId),
          isNull(documentReference.targetDocumentId),
          eq(documentReference.referenceType, params.referenceType),
          nullSafeEq(documentReference.changeType, params.changeType),
          eq(documentReference.rawCitationText, params.rawCitationText),
        );

    const existing = await this.db.query.documentReference.findFirst({
      where: dedupWhere,
      columns: { id: true },
    });
    if (existing) return;

    await this.db.insert(documentReference).values({
      sourceDocumentId: params.sourceDocumentId,
      targetDocumentId: params.targetDocumentId,
      referenceType: params.referenceType,
      changeType: params.changeType ?? undefined,
      rawCitationText: params.rawCitationText,
    });
  }

  /**
   * Extracts all text-based references: "Căn cứ" preamble lines as
   * `has_basis`, and inline body citations classified by surrounding
   * context keywords. Only inserts rows that don't already exist from
   * vbpl.vn data.
   */
  async extractTextReferences(
    thisDocumentId: string,
    parsed: ParsedVbplDocument,
  ): Promise<void> {
    await this.extractPreambleReferences(thisDocumentId, parsed.fullText);
    await this.extractBodyReferences(
      thisDocumentId,
      parsed.fullText,
      parsed.attributes.citation,
    );
  }

  private async extractPreambleReferences(
    thisDocumentId: string,
    fullText: string,
  ): Promise<void> {
    const preamble = this.extractPreambleBlock(fullText);
    if (!preamble) return;

    const lines = preamble.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.toLowerCase().startsWith('căn cứ')) continue;
      const citation = this.extractCitationFromBody(trimmed);
      if (!citation) continue;
      const targetId = await this.findDocumentIdByCitation(citation);
      await this.insertReferenceIfNotExists({
        sourceDocumentId: thisDocumentId,
        targetDocumentId: targetId,
        referenceType: 'has_basis',
        changeType: null,
        rawCitationText: trimmed,
      });
    }
  }

  private extractPreambleBlock(fullText: string): string | null {
    const upper = fullText.toUpperCase();
    const docTypeMarkers = [
      'NGHỊ ĐỊNH',
      'LUẬT',
      'THÔNG TƯ',
      'QUYẾT ĐỊNH',
      'LỆNH',
      'PHÁP LỆNH',
      'NGHỊ QUYẾT',
    ];
    let docTypePos = -1;
    for (const marker of docTypeMarkers) {
      const idx = upper.indexOf(marker);
      if (idx !== -1 && (docTypePos === -1 || idx < docTypePos)) {
        docTypePos = idx;
      }
    }
    if (docTypePos === -1) return null;
    const afterDocType = fullText.substring(docTypePos);
    const firstChapter = afterDocType.search(
      /[\n\r]\s*CHƯƠNG\s*[\dIVXLC]+[.\s]/i,
    );
    if (firstChapter === -1) {
      return afterDocType.trim();
    }
    return afterDocType.substring(0, firstChapter).trim();
  }

  private extractCitationFromBody(text: string): string | null {
    const citation = extractCitationFromTitle(text);
    if (citation) return citation;
    const directMatch = text.match(CITATION_RE);
    return directMatch ? directMatch[0] : null;
  }

  /**
   * Scans the document body (post-preamble) for inline citations to other
   * documents. Each match is classified by contextual keywords surrounding
   * the citation: "sửa đổi"/"bãi bỏ"/"thay thế" → amends/repeals,
   * "quy định tại"/"theo Điều" → cites (default).
   */
  private async extractBodyReferences(
    thisDocumentId: string,
    fullText: string,
    ownCitationId: string,
  ): Promise<void> {
    const bodyStart = this.findBodyStart(fullText);
    if (bodyStart === -1) return;
    const body = fullText.substring(bodyStart);

    const matches = [...body.matchAll(CITATION_RE_GLOBAL)];
    const seen = new Set<string>();
    for (const m of matches) {
      const citation = m[0];
      if (citation === ownCitationId || seen.has(citation)) continue;

      const contextStart = Math.max(0, m.index - 80);
      const contextEnd = Math.min(
        body.length,
        (m.index || 0) + citation.length + 80,
      );
      const context = body.substring(contextStart, contextEnd).toLowerCase();

      const refType = this.classifyBodyReference(context);
      if (refType === null) continue;

      const targetId = await this.findDocumentIdByCitation(citation);
      await this.insertReferenceIfNotExists({
        sourceDocumentId: thisDocumentId,
        targetDocumentId: targetId,
        referenceType: refType,
        changeType: null,
        rawCitationText: context.trim(),
      });
      seen.add(citation);
    }
  }

  private findBodyStart(fullText: string): number {
    const chapterMatch = fullText.match(/[\n\r]\s*CHƯƠNG\s*[\dIVXLC]+[.\s]/i);
    return chapterMatch ? chapterMatch.index! + chapterMatch[0].length : -1;
  }

  private classifyBodyReference(context: string): VbplReferenceType | null {
    if (/sửa\s+đổi|bổ\s*sung/.test(context)) return 'amends';
    if (/bãi\s+bỏ|hết\s+hiệu\s+lực/.test(context)) return 'repeals';
    if (/thay\s+thế/.test(context)) return 'amends';
    if (/đính\s+chính/.test(context)) return 'corrects';
    if (/hướng\s+dẫn/.test(context)) return 'guides';
    return 'cites';
  }

  /**
   * Fetches document_reference rows for a given document, optionally
   * filtered by direction and reference type. Joins source/target
   * document metadata into each row.
   */
  async findReferences(
    documentId: string,
    direction: 'outgoing' | 'incoming' | 'all' = 'outgoing',
    referenceType?: string,
  ): Promise<{
    citationId: string;
    title: string;
    references: ReferenceRow[];
  }> {
    const docInfo = await this.db.query.document.findFirst({
      where: eq(document.id, documentId),
      columns: { citationId: true, title: true },
    });
    if (!docInfo) {
      throw new Error(`Document ${documentId} not found`);
    }

    const conditions: SQL[] = [];
    if (direction === 'outgoing') {
      conditions.push(eq(documentReference.sourceDocumentId, documentId));
    } else if (direction === 'incoming') {
      conditions.push(eq(documentReference.targetDocumentId, documentId));
    } else {
      const orResult = or(
        eq(documentReference.sourceDocumentId, documentId),
        eq(documentReference.targetDocumentId, documentId),
      );
      if (orResult) conditions.push(orResult);
    }
    if (referenceType) {
      conditions.push(
        eq(
          documentReference.referenceType,
          referenceType as (typeof documentReference.$inferInsert)['referenceType'],
        ),
      );
    }

    const where = conditions.length > 1 ? and(...conditions) : conditions[0];

    const refs = await this.db
      .select({
        id: documentReference.id,
        sourceDocumentId: documentReference.sourceDocumentId,
        targetDocumentId: documentReference.targetDocumentId,
        referenceType: documentReference.referenceType,
        changeType: documentReference.changeType,
        rawCitationText: documentReference.rawCitationText,
        createdAt: documentReference.createdAt,
      })
      .from(documentReference)
      .where(where)
      .orderBy(documentReference.createdAt);

    const sourceIds = refs
      .map((r) => r.sourceDocumentId)
      .filter((id): id is string => id !== null && id !== documentId);
    const targetIds = refs
      .map((r) => r.targetDocumentId)
      .filter((id): id is string => id !== null && id !== documentId);
    const allRelatedIds = [...new Set([...sourceIds, ...targetIds])];

    const docMap = new Map<string, { citationId: string; title: string }>();
    docMap.set(documentId, {
      citationId: docInfo.citationId,
      title: docInfo.title,
    });
    if (allRelatedIds.length > 0) {
      const relatedDocs = await this.db
        .select({
          id: document.id,
          citationId: document.citationId,
          title: document.title,
        })
        .from(document)
        .where(inArray(document.id, allRelatedIds));
      for (const d of relatedDocs) {
        docMap.set(d.id, { citationId: d.citationId, title: d.title });
      }
    }

    const references: ReferenceRow[] = refs.map((ref) => {
      const src = ref.sourceDocumentId
        ? (docMap.get(ref.sourceDocumentId) ?? null)
        : null;
      const tgt = ref.targetDocumentId
        ? (docMap.get(ref.targetDocumentId) ?? null)
        : null;
      return {
        id: ref.id,
        sourceDocumentId: ref.sourceDocumentId,
        sourceCitationId: src?.citationId ?? null,
        sourceTitle: src?.title ?? null,
        targetDocumentId: ref.targetDocumentId,
        targetCitationId: tgt?.citationId ?? null,
        targetTitle: tgt?.title ?? null,
        referenceType: ref.referenceType,
        changeType: ref.changeType,
        rawCitationText: ref.rawCitationText,
        createdAt: ref.createdAt.toISOString(),
      };
    });

    return {
      citationId: docInfo.citationId,
      title: docInfo.title,
      references,
    };
  }

  /**
   * Search locally synced documents in Postgres. Converts dd/mm/yyyy date
   * strings to yyyy-MM-dd for DB comparison.
   */
  async searchLocalDocuments(
    filters: Omit<
      VbplSearchFilters,
      'documentGroups' | 'expiredFrom' | 'expiredTo'
    >,
  ): Promise<VbplSearchResult> {
    const conditions: SQL[] = [];

    if (filters.keyword) {
      const wildcard = filters.exactPhrase ? '' : '%';
      const keywordLike = `${wildcard}${filters.keyword}${wildcard}`;
      // searchScope determines which fields the keyword is matched against.
      // Default (tieu-de) matches title + citation. noi-dung searches the full
      // text stored in raw_source. so-hieu searches citation only.
      const scope = filters.searchScope ?? 'tieu-de';
      const matches: SQL[] = [];
      if (scope === 'noi-dung') {
        matches.push(sql`raw_source->>'fullText' ILIKE ${keywordLike}`);
      }
      if (scope === 'tieu-de') {
        matches.push(ilike(document.title, keywordLike));
        matches.push(ilike(document.citationId, keywordLike));
      }
      if (scope === 'so-hieu') {
        matches.push(ilike(document.citationId, keywordLike));
      }
      if (matches.length > 0) {
        // or() is typed as SQL | undefined generically (empty-args case).
        const keywordCondition = or(...matches);
        if (keywordCondition) conditions.push(keywordCondition);
      }
    }

    if (filters.documentTypes?.length) {
      // Not sql`${col} = ANY(${array}::text[])` — drizzle's sql template
      // spreads a JS array into multiple bind params (`($1, $2)`), which
      // Postgres parses as a record literal, not an array; casting that to
      // text[] fails with "cannot cast type record to text[]" (confirmed
      // live, reproducible with any array length). inArray() generates a
      // correct `IN ($1, $2, ...)` instead.
      conditions.push(inArray(document.documentType, filters.documentTypes));
    }

    if (filters.issuingBodies?.length) {
      conditions.push(inArray(issuingBody.name, filters.issuingBodies));
    }

    if (filters.validityStatus) {
      const mappedStatus =
        VALIDITY_STATUS_MAP[filters.validityStatus.toLowerCase()];
      if (mappedStatus) {
        conditions.push(eq(document.status, mappedStatus));
      }
    }

    if (filters.issuedFrom) {
      const date = parseVbplDate(filters.issuedFrom);
      if (date) conditions.push(gte(document.enactedDate, date));
    }
    if (filters.issuedTo) {
      const date = parseVbplDate(filters.issuedTo);
      if (date) conditions.push(lte(document.enactedDate, date));
    }
    if (filters.effectiveFrom) {
      const date = parseVbplDate(filters.effectiveFrom);
      if (date) conditions.push(gte(document.effectiveDate, date));
    }
    if (filters.effectiveTo) {
      const date = parseVbplDate(filters.effectiveTo);
      if (date) conditions.push(lte(document.effectiveDate, date));
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const pageSize = filters.pageSize ?? 10;
    const page = filters.page ?? 1;
    const offset = (page - 1) * pageSize;

    const [rows, total] = await Promise.all([
      this.db
        .select({
          id: document.id,
          citationId: document.citationId,
          title: document.title,
          documentType: document.documentType,
          issuingBody: issuingBody.name,
          enactedDate: document.enactedDate,
          effectiveDate: document.effectiveDate,
          status: document.status,
          rawSource: document.rawSource,
        })
        .from(document)
        .innerJoin(issuingBody, eq(document.issuingBodyId, issuingBody.id))
        .where(where)
        .orderBy(sql`${document.enactedDate} DESC`)
        .limit(pageSize)
        .offset(offset),
      (async () => {
        const result = await this.db
          .select({ count: sql<number>`count(*)` })
          .from(document)
          .innerJoin(issuingBody, eq(document.issuingBodyId, issuingBody.id))
          .where(where);
        return Number(result[0].count);
      })(),
    ]);

    return {
      total,
      page,
      pageSize,
      items: rows.map((row: (typeof rows)[number]) => {
        const rawSource = row.rawSource as DocumentRawSource | null;
        // rawSource.sourceUrl is written unconditionally by upsertDocument —
        // a missing one means a corrupted/pre-dating row, not a case to
        // paper over with a guess: citation_id (e.g. "51/2024/QH15") is not
        // interchangeable with vbpl.vn's internal document id that its URLs
        // actually key on (confirmed live — see vbpl.parser.ts's
        // buildSearchResultUrl), so fabricating one from it would be wrong.
        if (!rawSource?.sourceUrl) {
          throw new Error(
            `document ${row.id} (citation ${row.citationId}) has no rawSource.sourceUrl`,
          );
        }

        return {
          documentId: row.id,
          sourceUrl: rawSource.sourceUrl,
          citation: row.citationId,
          title: row.title,
          documentType: row.documentType,
          issuingBody: row.issuingBody,
          issuedDate: row.enactedDate
            ? formatDateFromYYYYMMDD(row.enactedDate)
            : null,
          effectiveDate: row.effectiveDate
            ? formatDateFromYYYYMMDD(row.effectiveDate)
            : null,
          // Not persisted anywhere yet — see DocumentRawSource's comment.
          expiryDate: null,
          validityStatus: mapDbStatusToDisplay(row.status),
        };
      }),
    };
  }

  /** List issuing bodies with optional keyword/scope filters and document counts. */
  async findIssuingBodies(filters: {
    keyword?: string;
    scope?: 'national' | 'local';
  }): Promise<{
    items: Array<{
      id: string;
      name: string;
      nameEn: string | null;
      authorityRank: number;
      scope: 'national' | 'local';
      parentBodyId: string | null;
      documentCount: number;
    }>;
    total: number;
  }> {
    const conditions: SQL[] = [];

    if (filters.keyword) {
      conditions.push(ilike(issuingBody.name, `%${filters.keyword}%`));
    }

    if (filters.scope) {
      conditions.push(eq(issuingBody.scope, filters.scope));
    }

    const rows = await this.db
      .select({
        id: issuingBody.id,
        name: issuingBody.name,
        nameEn: issuingBody.nameEn,
        authorityRank: issuingBody.authorityRank,
        scope: issuingBody.scope,
        parentBodyId: issuingBody.parentBodyId,
        documentCount: sql<number>`count(${document.id})`,
      })
      .from(issuingBody)
      .leftJoin(document, eq(issuingBody.id, document.issuingBodyId))
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(
        issuingBody.id,
        issuingBody.name,
        issuingBody.nameEn,
        issuingBody.authorityRank,
        issuingBody.scope,
        issuingBody.parentBodyId,
      )
      .orderBy(issuingBody.authorityRank, issuingBody.name);

    return {
      items: rows.map((row) => ({
        ...row,
        documentCount: Number(row.documentCount),
      })),
      total: rows.length,
    };
  }
}

/** Convert yyyy-MM-dd (DB date string mode) to dd/mm/yyyy display format. */
function formatDateFromYYYYMMDD(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

/** Map DB enum value back to Vietnamese display label. */
function mapDbStatusToDisplay(
  status: (typeof document.$inferSelect)['status'],
): string {
  const reverseMap: Record<string, string> = {
    chua_co_hieu_luc: 'Chưa có hiệu lực',
    con_hieu_luc: 'Còn hiệu lực',
    het_hieu_luc: 'Hết hiệu lực',
    het_hieu_luc_mot_phan: 'Hết hiệu lực một phần',
    ngung_hieu_luc: 'Ngưng hiệu lực',
  };
  return status ? (reverseMap[status] ?? status) : 'Chưa xác định';
}
