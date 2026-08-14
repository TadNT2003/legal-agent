import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import type { ParsedChinhPhuDocument } from '../crawl/chinhphu-document.interface';
import { parseVbplDate } from '../crawl/vbpl.parser';
import { DRIZZLE, type DrizzleDb } from './db.module';
import { document } from './schema';
import { DocumentRepository } from './document.repository';

function computeChinhPhuContentVersion(parsed: ParsedChinhPhuDocument): string {
  const hash = createHash('sha256');
  hash.update(parsed.fullText ?? '');
  hash.update(parsed.attributes.citation);
  hash.update(parsed.title);
  hash.update(parsed.attributes.issuingBody);
  hash.update(parsed.attributes.signerName ?? '');
  hash.update(parsed.attributes.signerTitle ?? '');
  hash.update(parsed.attachmentFileUrls.join(','));
  return hash.digest('hex');
}

export interface ChinhPhuUpsertResult {
  documentId: string | null;
  changed: boolean;
  /** Set (and documentId left null) when the document was not persisted — see upsertDocument's citation-collision handling. */
  skippedReason?: string;
}

/**
 * Persistence for vanban.chinhphu.vn as a SUPPLEMENTARY source — deliberately
 * separate from DocumentRepository (which owns vbpl.vn, the primary source;
 * see docs/plan/law-index-plan.md's Context section) rather than a shared
 * upsert path, since DocumentRepository's citation-collision/consolidation/
 * relation logic is written specifically against vbpl.vn's data shape and
 * known failure modes (e.g. its "Không số" citation reuse) that don't
 * necessarily apply here. Reuses
 * DocumentRepository.resolveOrCreateIssuingBody rather than duplicating it —
 * issuing_body is a shared table with no source-specific meaning.
 *
 * KNOWN LIMITATION, permanent (not a TODO): this repository never writes
 * document_reference rows. vbpl.vn's "Lược đồ" tab gives crawl.service.ts's
 * upsertRelations + extractTextReferences a curated relationship graph plus
 * enough full text to mine inline citations from; vanban.chinhphu.vn has
 * neither — no relationship graph at all, and (until DOCUMENT_TEXT_EXTRACTOR
 * is wired to a real implementation, see document-text-extractor.ts) no
 * body text to extract citations from either. A chinhphu-sourced document
 * therefore has zero outgoing/incoming references in the graph until it is
 * re-synced from vbpl.vn instead (if vbpl.vn ever indexes it) — this
 * repository does not and cannot backfill that gap on its own.
 */
@Injectable()
export class ChinhPhuDocumentRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly documentRepo: DocumentRepository,
  ) {}

  /**
   * Upserts document metadata only — document_reference/document_node stay
   * this repository's caller's responsibility once fullText is available
   * (see chinhphu-crawl.service.ts). Never overwrites a document already
   * indexed under the same citation by another source (most likely vbpl.vn,
   * the primary source): a chinhphu-sourced sync only fills a genuine
   * coverage gap (a citation nothing has scraped yet) or re-syncs a
   * document this source itself already created, matching the
   * "supplementary" framing this repository exists under. Unlike
   * DocumentRepository.upsertDocument, there is no disambiguation path for
   * a genuine collision — it is always skipped, never split into a second
   * row, since (unlike vbpl.vn's validity-status field) this source has no
   * signal to decide which of two same-citation documents should win.
   */
  async upsertDocument(
    parsed: ParsedChinhPhuDocument,
  ): Promise<ChinhPhuUpsertResult> {
    const citation = parsed.attributes.citation;
    const contentVersion = computeChinhPhuContentVersion(parsed);

    const existing = await this.db.query.document.findFirst({
      where: sql`${document.rawSource}->>'sourceUrl' = ${parsed.sourceUrl}`,
    });

    if (!existing) {
      const byCitation = await this.db.query.document.findFirst({
        where: eq(document.citationId, citation),
      });
      if (byCitation) {
        return {
          documentId: null,
          changed: false,
          skippedReason: `citation "${citation}" already indexed (id ${byCitation.id}) — vanban.chinhphu.vn is a supplementary source and never overwrites an existing row`,
        };
      }
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

    const issuingBodyId = await this.documentRepo.resolveOrCreateIssuingBody(
      parsed.attributes.issuingBody,
    );

    const values = {
      citationId: citation,
      title: parsed.title,
      documentType: parsed.attributes.documentType,
      issuingBodyId,
      signerName: parsed.attributes.signerName,
      signerTitle: parsed.attributes.signerTitle,
      enactedDate,
      // 'metadata_only' is exactly the case this column was designed for
      // (see document.schema.ts's own comment) — a document with no body
      // text to chunk/index yet, only bibliographic metadata.
      indexScope: (parsed.fullText === null
        ? 'metadata_only'
        : 'full') as (typeof document.$inferInsert)['indexScope'],
      originalDocumentUrls: parsed.attachmentFileUrls,
      rawSource: {
        source: 'vanban.chinhphu.vn',
        fullText: parsed.fullText,
        extractionMethod: parsed.extractionMethod,
        scrapedAt: new Date().toISOString(),
        sourceUrl: parsed.sourceUrl,
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
}
