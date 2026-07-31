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
import {
  extractCitationFromTitle,
  extractVbplInternalId,
  parseVbplDate,
} from '../crawl/vbpl.parser';
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
  hash.update(parsed.attributes.issuingBody);
  hash.update(parsed.attributes.validityStatusRaw ?? '');
  hash.update(parsed.attributes.effectiveDateRaw ?? '');
  hash.update(parsed.attributes.expiryDateRaw ?? '');
  return hash.digest('hex');
}

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
  documentId: string | null;
  changed: boolean;
  /** Set (and documentId left null) when the document was not persisted — see upsertDocument's citation-collision handling. */
  skippedReason?: string;
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

  /**
   * Upserts the document row (skipping the write entirely if content_version
   * is unchanged) and its relations.
   *
   * Handles vbpl.vn citation collisions before doing anything else — see
   * docs/monitoring/law-index-flagged-documents.md §5/§6. vbpl.vn's citation
   * isn't actually unique for two known real cases: every pre-Đổi Mới law
   * predating the modern citation scheme is recorded as the literal string
   * "Không số" ("no number"), and a handful of pre-1998 batch instrument
   * numbers (e.g. "3-LCT/HĐNN7") were reused across genuinely different laws
   * passed in the same legislative session. `citation_id` is UNIQUE, so a
   * naive upsert-by-citation would silently overwrite whichever different
   * document currently holds that citation. Resolution:
   *   - This exact `sourceUrl` was already synced before (regardless of what
   *     citation it's currently stored under — matters once a document has
   *     been disambiguated per the next bullet, since vbpl.vn always
   *     reports its *bare* citation on every scrape, not whatever
   *     disambiguated form it was stored under) -> it's a re-sync of that
   *     same document, not a collision. Proceed normally, keeping its
   *     existing (possibly-disambiguated) citation.
   *   - Otherwise, if some *other* document already occupies this citation
   *     -> a real collision. If this document is not "còn hiệu lực" (in
   *     force), skip it entirely rather than clobber the existing row with
   *     dead law. If it *is* still in force, disambiguate by appending
   *     vbpl.vn's own internal document id to the citation
   *     (`"<citation> (vbpl-<id>)"`) so it gets its own row instead.
   */
  async upsertDocument(parsed: ParsedVbplDocument): Promise<UpsertResult> {
    const issuingBodyId = await this.resolveOrCreateIssuingBody(
      parsed.attributes.issuingBody,
    );
    const contentVersion = computeContentVersion(parsed);

    let citation = parsed.attributes.citation;
    const existing = await this.db.query.document.findFirst({
      where: sql`${document.rawSource}->>'sourceUrl' = ${parsed.sourceUrl}`,
    });

    if (!existing) {
      const byCitation = await this.db.query.document.findFirst({
        where: eq(document.citationId, citation),
      });
      if (byCitation) {
        const status = mapValidityStatus(parsed.attributes.validityStatusRaw);
        if (status !== 'con_hieu_luc') {
          return {
            documentId: null,
            changed: false,
            skippedReason: `citation "${citation}" already used by a different document (id ${byCitation.id}) and this one is not còn hiệu lực — skipped rather than overwritten`,
          };
        }
        const internalId = extractVbplInternalId(parsed.sourceUrl);
        if (!internalId) {
          throw new Error(
            `Citation collision on "${citation}" (${parsed.sourceUrl}) but no vbpl.vn internal id could be extracted to disambiguate it`,
          );
        }
        citation = `${citation} (vbpl-${internalId})`;
      }
    } else {
      // Re-sync of an already-known document — keep whatever citation it's
      // already stored under (bare or previously disambiguated).
      citation = existing.citationId;
    }

    if (existing && existing.contentVersion === contentVersion) {
      return { documentId: existing.id, changed: false };
    }

    const enactedDate = parseVbplDate(parsed.attributes.issuedDateRaw);
    if (!enactedDate) {
      throw new Error(
        `Document ${citation} has no parseable "Ngày ban hành" — got "${parsed.attributes.issuedDateRaw}"`,
      );
    }

    const isConsolidated =
      parsed.consolidation.consolidatesRawTitles.length > 0;
    const consolidatesDocumentId = await this.resolveFirstCitation(
      parsed.consolidation.consolidatesRawTitles,
    );

    const values = {
      citationId: citation,
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
   * Search locally synced documents in Postgres using the same filter
   * parameters as the vbpl.vn crawl search endpoint. Converts dd/mm/yyyy
   * date strings to yyyy-MM-dd for DB comparison.
   */
  async searchLocalDocuments(
    filters: VbplSearchFilters,
  ): Promise<VbplSearchResult> {
    const conditions: SQL[] = [];

    if (filters.keyword) {
      // or() is typed as SQL | undefined generically (empty-args case) — always
      // defined here since exactly 2 conditions are always passed.
      const keywordCondition = or(
        ilike(document.title, `%${filters.keyword}%`),
        ilike(document.citationId, `%${filters.keyword}%`),
      );
      if (keywordCondition) conditions.push(keywordCondition);
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
