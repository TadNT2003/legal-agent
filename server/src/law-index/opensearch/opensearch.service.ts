import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Client } from '@opensearch-project/opensearch';
import type {
  BulkResponse,
  SearchResponse,
} from '@opensearch-project/opensearch/api/types';
import { asc, eq, gt, inArray } from 'drizzle-orm';
import { OPENSEARCH_CLIENT } from './opensearch-client.module';
import { opensearchProjectorConfig } from './opensearch.config';
import {
  projectDocument,
  type DocumentProjectionMeta,
  type KhoanEntry,
  type LegalProvisionDocument,
} from './provision.projection';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { DocumentRepository } from '../persistence/document.repository';
import { document, issuingBody } from '../persistence/schema';

const DOCUMENT_PAGE_SIZE = 200;
/** Non-fatal errors (per-document processing failures, per-item bulk
 * failures) are capped so a cluster-wide failure can't return a 70K-element
 * body — a connection-level failure still throws rather than accumulating
 * here (see flushBulk). */
const MAX_SUMMARY_ERRORS = 100;

export interface BackfillOptions {
  limit?: number;
  afterDocumentId?: string;
  /** When set, backfills exactly these documents and ignores limit/afterDocumentId. */
  documentIds?: string[];
}

export interface BackfillError {
  /** Either a document.id (the document's own processing failed before any
   * provisions were produced) or a provision's document_node.id (that one
   * provision failed to index, per a bulk response item error). */
  id: string;
  error: string;
}

export interface BackfillSummary {
  documentsProcessed: number;
  provisionsIndexed: number;
  templatePhuLucSkipped: number;
  errors: BackfillError[];
  errorsTruncated: boolean;
}

export interface ReprojectParams {
  documentId?: string;
  citation?: string;
}

export interface ReprojectResult {
  documentId: string;
  citationId: string;
  provisionsIndexed: number;
  templatePhuLucSkipped: number;
}

export interface SearchProvisionsParams {
  query: string;
  page?: number;
  pageSize?: number;
}

export interface MatchedKhoan {
  khoanId: string;
  label: string;
  text: string;
}

export interface SearchProvisionHit {
  documentId: string;
  citationId: string;
  documentType: string;
  path: string;
  label: string;
  heading?: string;
  score: number;
  matchedKhoan: MatchedKhoan[];
}

export interface SearchProvisionsResult {
  total: number;
  page: number;
  pageSize: number;
  items: SearchProvisionHit[];
}

interface DocumentMetaRow {
  id: string;
  citationId: string;
  documentType: string;
  issuingBodyId: string;
  authorityRank: number;
  enactedDate: string;
  effectiveDate: string | null;
  contentVersion: string;
}

function toProjectionMeta(row: DocumentMetaRow): DocumentProjectionMeta {
  return {
    documentId: row.id,
    citationId: row.citationId,
    documentType: row.documentType,
    issuingBodyId: row.issuingBodyId,
    authorityRank: row.authorityRank,
    enactedDate: row.enactedDate,
    effectiveDate: row.effectiveDate,
    contentVersion: row.contentVersion,
  };
}

function pushError(
  summary: Pick<BackfillSummary, 'errors' | 'errorsTruncated'>,
  id: string,
  err: unknown,
): void {
  if (summary.errors.length >= MAX_SUMMARY_ERRORS) {
    summary.errorsTruncated = true;
    return;
  }
  summary.errors.push({
    id,
    error: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Owns the document loop, bulk buffer, and search query. Reads via
 * DocumentNodeRepository.findAllNodes (the projector's only node-read path)
 * and DocumentRepository.getDb() (the documented escape hatch for the one
 * `document ⋈ issuing_body` metadata query) — never DocumentRepository's
 * own higher-level methods, which don't shape data the way projection needs.
 */
@Injectable()
export class OpenSearchService {
  constructor(
    @Inject(OPENSEARCH_CLIENT) private readonly client: Client,
    @Inject(opensearchProjectorConfig.KEY)
    private readonly config: ConfigType<typeof opensearchProjectorConfig>,
    private readonly documentRepository: DocumentRepository,
    private readonly documentNodeRepository: DocumentNodeRepository,
  ) {}

  /**
   * Iterates documents (never loading all 507K document_node rows at once —
   * one document's nodes at a time), projects each, and flushes the bulk
   * buffer at whichever of bulkMaxDocs/bulkMaxBytes is hit first. One
   * explicit refresh at the end; refresh_interval is never disabled, so a
   * crash mid-run doesn't leave the index permanently stale.
   *
   * `documentIds` targets a specific set (used by smaller, verified passes);
   * otherwise iterates the whole corpus keyset-paginated on document.id,
   * which is what makes `afterDocumentId` resumability work.
   */
  async backfill(options: BackfillOptions = {}): Promise<BackfillSummary> {
    const summary: BackfillSummary = {
      documentsProcessed: 0,
      provisionsIndexed: 0,
      templatePhuLucSkipped: 0,
      errors: [],
      errorsTruncated: false,
    };

    let buffer: string[] = [];
    let bufferBytes = 0;
    let bufferDocs = 0;

    const flush = async (): Promise<void> => {
      if (bufferDocs === 0) return;
      await this.flushBulk(buffer, summary);
      buffer = [];
      bufferBytes = 0;
      bufferDocs = 0;
    };

    const processMeta = async (meta: DocumentMetaRow): Promise<void> => {
      try {
        const nodes = await this.documentNodeRepository.findAllNodes(meta.id);
        const { provisions, stats } = projectDocument(
          toProjectionMeta(meta),
          nodes,
        );
        summary.documentsProcessed += 1;
        summary.provisionsIndexed += stats.provisionsProjected;
        summary.templatePhuLucSkipped += stats.templatePhuLucSkipped;

        for (const provision of provisions) {
          const action = JSON.stringify({
            index: { _index: this.config.writeAlias, _id: provision.id },
          });
          const source = JSON.stringify(provision.source);
          buffer.push(action, source);
          bufferBytes += action.length + source.length + 2;
          bufferDocs += 1;
        }
      } catch (err) {
        pushError(summary, meta.id, err);
        return;
      }

      if (
        bufferDocs >= this.config.bulkMaxDocs ||
        bufferBytes >= this.config.bulkMaxBytes
      ) {
        await flush();
      }
    };

    if (options.documentIds?.length) {
      const metas = await this.fetchDocumentMetaByIds(options.documentIds);
      for (const meta of metas) await processMeta(meta);
    } else {
      let afterDocumentId = options.afterDocumentId;
      for (;;) {
        if (
          options.limit !== undefined &&
          summary.documentsProcessed >= options.limit
        ) {
          break;
        }
        const pageSize =
          options.limit !== undefined
            ? Math.min(
                DOCUMENT_PAGE_SIZE,
                options.limit - summary.documentsProcessed,
              )
            : DOCUMENT_PAGE_SIZE;
        const page = await this.fetchDocumentMetaPage(
          afterDocumentId,
          pageSize,
        );
        if (page.length === 0) break;

        for (const meta of page) {
          if (
            options.limit !== undefined &&
            summary.documentsProcessed >= options.limit
          ) {
            break;
          }
          await processMeta(meta);
          afterDocumentId = meta.id;
        }
        if (page.length < pageSize) break;
      }
    }

    await flush();
    await this.client.indices.refresh({ index: this.config.writeAlias });
    return summary;
  }

  /**
   * Reprojects one document by documentId or citation. `document_node.id` is
   * regenerated on every content-changed re-sync (`syncNodes` does a full
   * delete-and-reinsert), so this deletes every previously-indexed provision
   * for the document *before* indexing the fresh set — without this,
   * re-scraping a changed document would orphan its old provisions rather
   * than replace them.
   */
  async reprojectDocument(params: ReprojectParams): Promise<ReprojectResult> {
    const documentId =
      params.documentId ??
      (params.citation
        ? await this.documentRepository.findDocumentIdByCitation(
            params.citation,
          )
        : null);
    if (!documentId) {
      throw new BadRequestException(
        'reprojectDocument requires either documentId or a citation that resolves to a known document',
      );
    }

    const [meta] = await this.fetchDocumentMetaByIds([documentId]);
    if (!meta) {
      throw new BadRequestException(`Document ${documentId} not found`);
    }

    const nodes = await this.documentNodeRepository.findAllNodes(documentId);
    const { provisions, stats } = projectDocument(
      toProjectionMeta(meta),
      nodes,
    );

    await this.client.deleteByQuery({
      index: this.config.writeAlias,
      body: { query: { term: { document_id: documentId } } },
    });

    if (provisions.length > 0) {
      const lines: string[] = [];
      for (const provision of provisions) {
        lines.push(
          JSON.stringify({
            index: { _index: this.config.writeAlias, _id: provision.id },
          }),
          JSON.stringify(provision.source),
        );
      }
      const errorSink: Pick<BackfillSummary, 'errors' | 'errorsTruncated'> = {
        errors: [],
        errorsTruncated: false,
      };
      await this.flushBulk(lines, errorSink);
      if (errorSink.errors.length > 0) {
        throw new BadRequestException(
          `Reproject partially failed: ${errorSink.errors.map((e) => e.error).join('; ')}`,
        );
      }
    }

    await this.client.indices.refresh({ index: this.config.writeAlias });

    return {
      documentId,
      citationId: meta.citationId,
      provisionsIndexed: stats.provisionsProjected,
      templatePhuLucSkipped: stats.templatePhuLucSkipped,
    };
  }

  /**
   * §3d's query shape: multi_match against heading/body (+ folded fallback
   * fields) plus a nested khoan clause with inner_hits (so a hit can say
   * "matched in Khoản 2", not just "matched somewhere in Điều 5"), filtered
   * to currently-valid provisions. A verification endpoint for v1, not the
   * RAG retrieval API — filters aren't parameterized beyond query/paging.
   */
  async search(
    params: SearchProvisionsParams,
  ): Promise<SearchProvisionsResult> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;

    const { body } = await this.client.search<
      SearchResponse<LegalProvisionDocument>
    >({
      index: this.config.readAlias,
      body: {
        from: (page - 1) * pageSize,
        size: pageSize,
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: params.query,
                  fields: [
                    'heading^2',
                    'body^2',
                    'heading.folded',
                    'body.folded',
                  ],
                  type: 'most_fields',
                },
              },
              {
                nested: {
                  path: 'khoan',
                  query: {
                    multi_match: {
                      query: params.query,
                      fields: ['khoan.text', 'khoan.text.folded'],
                    },
                  },
                  inner_hits: {},
                },
              },
            ],
            filter: [
              { term: { status: 'con_hieu_luc' } },
              { range: { valid_from: { lte: 'now' } } },
              {
                bool: {
                  should: [
                    { bool: { must_not: { exists: { field: 'valid_to' } } } },
                    { range: { valid_to: { gt: 'now' } } },
                  ],
                },
              },
            ],
          },
        },
        highlight: { fields: { body: {}, heading: {} } },
      },
    });

    const totalHits = body.hits.total;
    const total =
      typeof totalHits === 'number' ? totalHits : (totalHits?.value ?? 0);

    const items: SearchProvisionHit[] = body.hits.hits.map((hit) => {
      const source = hit._source;
      const khoanInnerHits = hit.inner_hits?.khoan?.hits.hits ?? [];
      return {
        documentId: source?.document_id ?? '',
        citationId: source?.citation_id ?? '',
        documentType: source?.document_type ?? '',
        path: source?.path ?? '',
        label: source?.label ?? '',
        ...(source?.heading ? { heading: source.heading } : {}),
        score: hit._score ?? 0,
        matchedKhoan: khoanInnerHits.map((inner) => {
          const khoan = inner._source as KhoanEntry;
          return {
            khoanId: khoan.khoan_id,
            label: khoan.label,
            text: khoan.text,
          };
        }),
      };
    });

    return { total, page, pageSize, items };
  }

  /**
   * A connection-level failure (dead cluster, network error) throws rather
   * than being swallowed here — retrying against a dead cluster for
   * thousands of documents would just waste time. Per-item bulk failures
   * (e.g. one document's mapping mismatch) are non-fatal and recorded
   * instead, capped the same way as processMeta's own errors.
   */
  private async flushBulk(
    lines: string[],
    summary: Pick<BackfillSummary, 'errors' | 'errorsTruncated'>,
  ): Promise<void> {
    if (lines.length === 0) return;
    const { body } = await this.client.bulk<BulkResponse, string[]>({
      body: lines,
    });
    if (!body.errors) return;

    for (const item of body.items) {
      const action = item.index ?? item.create ?? item.update ?? item.delete;
      if (action?.error) {
        pushError(
          summary,
          action._id ?? 'unknown',
          `${action.error.type}: ${action.error.reason}`,
        );
      }
    }
  }

  private async fetchDocumentMetaPage(
    afterDocumentId: string | undefined,
    limit: number,
  ): Promise<DocumentMetaRow[]> {
    const db = this.documentRepository.getDb();
    return db
      .select({
        id: document.id,
        citationId: document.citationId,
        documentType: document.documentType,
        issuingBodyId: document.issuingBodyId,
        authorityRank: issuingBody.authorityRank,
        enactedDate: document.enactedDate,
        effectiveDate: document.effectiveDate,
        contentVersion: document.contentVersion,
      })
      .from(document)
      .innerJoin(issuingBody, eq(document.issuingBodyId, issuingBody.id))
      .where(afterDocumentId ? gt(document.id, afterDocumentId) : undefined)
      .orderBy(asc(document.id))
      .limit(limit);
  }

  private async fetchDocumentMetaByIds(
    ids: string[],
  ): Promise<DocumentMetaRow[]> {
    const db = this.documentRepository.getDb();
    return db
      .select({
        id: document.id,
        citationId: document.citationId,
        documentType: document.documentType,
        issuingBodyId: document.issuingBodyId,
        authorityRank: issuingBody.authorityRank,
        enactedDate: document.enactedDate,
        effectiveDate: document.effectiveDate,
        contentVersion: document.contentVersion,
      })
      .from(document)
      .innerJoin(issuingBody, eq(document.issuingBodyId, issuingBody.id))
      .where(inArray(document.id, ids));
  }
}
