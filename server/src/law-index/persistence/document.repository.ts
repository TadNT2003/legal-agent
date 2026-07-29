import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type {
  ParsedVbplDocument,
  VbplChangeType,
  VbplReferenceType,
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
  hash.update(parsed.attributes.validityStatusRaw);
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
 * on an unrecognized string, matching this codebase's existing
 * fail-loud-on-unclassifiable convention (see law-tier-classifier.ts).
 */
function mapValidityStatus(
  raw: string,
): (typeof document.$inferInsert)['status'] {
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
}
