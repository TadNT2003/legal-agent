import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, isNull } from 'drizzle-orm';
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
}