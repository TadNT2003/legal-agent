import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { DocumentRepository } from '../persistence/document.repository';
import { document, documentReference } from '../persistence/schema';
import { extractCitationFromTitle } from '../crawl/vbpl.parser';
import type { SyncRefsResultItem } from './dto/sync-refs-response.dto';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly docRepo: DocumentRepository) {}

  async syncRefsByCitation(
    citation: string,
  ): Promise<{
    documentId: string;
    citationId: string;
    title: string;
    healedReferences: number;
    healed: SyncRefsResultItem[];
  }> {
    const doc = await this.docRepo.getDb().query.document.findFirst({
      where: eq(document.citationId, citation),
      columns: { id: true, citationId: true, title: true },
    });

    if (!doc) {
      throw new NotFoundException(
        `No document found with citation "${citation}"`,
      );
    }

    const healed = await this.healRefsForTarget(doc.id);

    return {
      documentId: doc.id,
      citationId: doc.citationId,
      title: doc.title,
      healedReferences: healed.length,
      healed,
    };
  }

  /**
   * Heals dangling refs for multiple citations in one pass. Each citation is
   * resolved independently — a missing citation produces an error entry rather
   * than aborting the batch. The underlying heal scans all dangling rows once,
   * partitioning healed refs per citation target.
   */
  async syncRefsBulkByCitation(citations: string[]): Promise<{
    healedReferences: number;
    totalDangling: number;
    results: Array<{
      citation: string;
      documentId: string | null;
      title: string | null;
      healedReferences: number;
      healed: SyncRefsResultItem[];
      error?: string | null;
    }>;
  }> {
    const db = this.docRepo.getDb();

    const dangling = await db.query.documentReference.findMany({
      where: isNull(documentReference.targetDocumentId),
    });
    const totalDangling = dangling.length;

    const docMap = new Map<string, { id: string; citationId: string; title: string }>();
    for (const citation of citations) {
      const doc = await db.query.document.findFirst({
        where: eq(document.citationId, citation),
        columns: { id: true, citationId: true, title: true },
      });
      if (doc) {
        docMap.set(citation, doc);
      }
    }

    const targetIds = new Set([...docMap.values()].map((d) => d.id));
    const resultByCitation = new Map<string, SyncRefsResultItem[]>();
    for (const citation of citations) {
      resultByCitation.set(citation, []);
    }

    let totalHealed = 0;
    const healedSourceCitations = new Map<string, string | null>();

    for (const row of dangling) {
      const rawCitation = extractCitationFromTitle(row.rawCitationText);
      if (!rawCitation) continue;

      if (!resultByCitation.has(rawCitation)) continue;

      const targetDoc = docMap.get(rawCitation);
      if (!targetDoc) continue;

      await db
        .update(documentReference)
        .set({ targetDocumentId: targetDoc.id })
        .where(eq(documentReference.id, row.id));

      let sourceCitationId: string | null = null;
      if (row.sourceDocumentId) {
        const cached = healedSourceCitations.get(row.sourceDocumentId);
        if (cached) {
          sourceCitationId = cached;
        } else {
          const sourceDoc = await db.query.document.findFirst({
            where: eq(document.id, row.sourceDocumentId),
            columns: { citationId: true },
          });
          sourceCitationId = sourceDoc?.citationId ?? null;
          healedSourceCitations.set(row.sourceDocumentId, sourceCitationId);
        }
      }

      resultByCitation.get(rawCitation)!.push({
        refId: row.id,
        sourceDocumentId: row.sourceDocumentId,
        sourceCitationId,
        targetDocumentId: targetDoc.id,
        rawCitationText: row.rawCitationText,
        referenceType: row.referenceType,
      });
      totalHealed += 1;
    }

    this.logger.log(`Bulk heal: ${totalHealed} references healed across ${citations.length} citations`);

    const results = citations.map((citation) => {
      const doc = docMap.get(citation);
      if (!doc) {
        return {
          citation,
          documentId: null,
          title: null,
          healedReferences: 0,
          healed: [],
          error: `No document found with citation "${citation}"`,
        };
      }
      const healed = resultByCitation.get(citation)!;
      return {
        citation,
        documentId: doc.id,
        title: doc.title,
        healedReferences: healed.length,
        healed,
        error: null,
      };
    });

    return {
      healedReferences: totalHealed,
      totalDangling,
      results,
    };
  }

  /**
   * Scans all document_reference rows where target_document_id IS NULL and
   * attempts to resolve each one by extracting the citation from
   * raw_citation_text and looking up the document. Returns details of all
   * successfully healed references (globally, not scoped to any document).
   */
  async healAllDanglingRefs(): Promise<{
    healedReferences: number;
    healed: SyncRefsResultItem[];
  }> {
    const healed = await this.healRefsForTarget(null);

    return {
      healedReferences: healed.length,
      healed,
    };
  }

  private async healRefsForTarget(
    targetDocId: string | null,
  ): Promise<SyncRefsResultItem[]> {
    const db = this.docRepo.getDb();

    const dangling = await db.query.documentReference.findMany({
      where: isNull(documentReference.targetDocumentId),
    });

    const healed: SyncRefsResultItem[] = [];

    for (const row of dangling) {
      const citation = extractCitationFromTitle(row.rawCitationText);
      if (!citation) continue;

      const targetId = await this.docRepo.findDocumentIdByCitation(citation);
      if (!targetId) continue;

      if (targetDocId && targetId !== targetDocId) continue;

      await db
        .update(documentReference)
        .set({ targetDocumentId: targetId })
        .where(eq(documentReference.id, row.id));

      const sourceInfo = row.sourceDocumentId
        ? await db.query.document.findFirst({
            where: eq(document.id, row.sourceDocumentId),
            columns: { citationId: true },
          })
        : null;

      healed.push({
        refId: row.id,
        sourceDocumentId: row.sourceDocumentId,
        sourceCitationId: sourceInfo?.citationId ?? null,
        targetDocumentId: targetId,
        rawCitationText: row.rawCitationText,
        referenceType: row.referenceType,
      });
    }

    this.logger.log(`Healed ${healed.length} dangling references`);
    return healed;
  }

  /**
   * Lists all dangling (unresolved) document_reference rows with optional
   * filters. Read-only — does not modify any data.
   */
  async listDanglingRefs(filters: {
    sourceDocumentId?: string;
    referenceType?: string;
    rawCitationText?: string;
  }): Promise<{
    total: number;
    items: Array<{
      id: string;
      sourceDocumentId: string | null;
      sourceCitationId: string | null;
      sourceTitle: string | null;
      referenceType: string;
      rawCitationText: string;
      createdAt: string;
    }>;
  }> {
    const db = this.docRepo.getDb();
    const conditions = [isNull(documentReference.targetDocumentId)];

    if (filters.sourceDocumentId) {
      conditions.push(
        eq(documentReference.sourceDocumentId, filters.sourceDocumentId),
      );
    }
    if (filters.referenceType) {
      conditions.push(
        eq(
          documentReference.referenceType,
          filters.referenceType as (typeof documentReference.$inferSelect)['referenceType'],
        ),
      );
    }
    if (filters.rawCitationText) {
      conditions.push(
        ilike(documentReference.rawCitationText, `%${filters.rawCitationText}%`),
      );
    }

    const where = conditions.length > 1 ? and(...conditions) : conditions[0];

    const rows = await db
      .select({
        id: documentReference.id,
        sourceDocumentId: documentReference.sourceDocumentId,
        referenceType: documentReference.referenceType,
        rawCitationText: documentReference.rawCitationText,
        createdAt: documentReference.createdAt,
      })
      .from(documentReference)
      .where(where)
      .orderBy(sql`${documentReference.createdAt} DESC`);

    const sourceIds = [...new Set(rows.map((r) => r.sourceDocumentId).filter((id): id is string => id !== null))];

    const docMap = new Map<string, { citationId: string; title: string }>();
    if (sourceIds.length > 0) {
      const docs = await db
        .select({
          id: document.id,
          citationId: document.citationId,
          title: document.title,
        })
        .from(document)
        .where(inArray(document.id, sourceIds));
      for (const d of docs) {
        docMap.set(d.id, { citationId: d.citationId, title: d.title });
      }
    }

    const items = rows.map((row) => {
      const src = row.sourceDocumentId ? docMap.get(row.sourceDocumentId) : null;
      return {
        id: row.id,
        sourceDocumentId: row.sourceDocumentId,
        sourceCitationId: src?.citationId ?? null,
        sourceTitle: src?.title ?? null,
        referenceType: row.referenceType,
        rawCitationText: row.rawCitationText,
        createdAt: row.createdAt.toISOString(),
      };
    });

    return {
      total: items.length,
      items,
    };
  }

  /**
   * Re-extracts text-based references for an existing document using its
   * stored raw_source fullText. Re-runs the preamble "Căn cứ" and inline
   * body citation extraction, inserting any new references that don't
   * already exist. Returns the count of newly inserted reference rows.
   */
  async reExtractTextRefs(documentId: string): Promise<{
    documentId: string;
    citationId: string;
    newReferencesInserted: number;
  }> {
    const doc = await this.docRepo.getDb().query.document.findFirst({
      where: eq(document.id, documentId),
      columns: { citationId: true },
    });

    if (!doc) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    const newReferencesInserted =
      await this.docRepo.reExtractTextReferences(documentId);

    this.logger.log(
      `Re-extracted text references for ${documentId}: ${newReferencesInserted} new refs`,
    );

    return {
      documentId,
      citationId: doc.citationId,
      newReferencesInserted,
    };
  }
}