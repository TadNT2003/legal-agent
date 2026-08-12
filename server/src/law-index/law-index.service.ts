import { Injectable, Logger } from '@nestjs/common';
import { VbplClientService } from '../crawl/vbpl-client.service';
import { VbplSitemapService } from '../crawl/vbpl-sitemap.service';
import { parseVbplPage, parseVbplSearchPage } from '../crawl/vbpl.parser';
import type {
  VbplSearchFilters,
  VbplSearchResult,
  VbplSearchResultItem,
} from '../crawl/vbpl-document.interface';
import { DocumentRepository } from './persistence/document.repository';
import { DocumentNodeRepository } from './persistence/document-node.repository';
import type { SearchSyncDocumentsDto } from '../crawl/dto/search-sync-documents.dto';

export interface SyncDocumentResult {
  documentId: string | null;
  changed: boolean;
  skippedReason?: string;
  healedReferences: number;
}

export interface UpdateDocumentByUrlResult {
  documentId: string;
  citationId: string;
  changed: boolean;
  healedReferences: number;
}

export interface UpdateDocumentByUrlError {
  message: string;
  citationId: string;
  url: string;
}

export interface SyncSummary {
  totalUrls: number;
  synced: number;
  skipped: number;
  healedReferences: number;
  errors: Array<{ url: string; error: string }>;
}

export interface BatchUpdateSummary {
  totalUrls: number;
  updated: number;
  unchanged: number;
  healedReferences: number;
  notFound: Array<{ url: string; citationId: string; message: string }>;
  errors: Array<{ url: string; error: string }>;
}

export interface SearchAndSyncSummary {
  total: number;
  page: number;
  pageSize: number;
  items: Array<
    VbplSearchResultItem & {
      syncResult:
        | { documentId: string; changed: boolean }
        | { skippedReason: string }
        | { error: string }
        | null;
    }
  >;
  synced: number;
  skipped: number;
  healedReferences: number;
  errors: Array<{ url: string; error: string }>;
}

/**
 * Reported by the batch/all/search-and-sync methods as each document
 * finishes, so the job-queue worker (see job-queue/job-worker.ts) can relay
 * it to BullMQ's job.updateProgress(). `total` is null when it isn't known
 * yet — syncAll without a `limit` discovers document URLs incrementally as
 * it walks the sitemap, so there's no true total until the run is already
 * finished (see syncAll's own comment).
 */
export type ProgressCallback = (
  processed: number,
  total: number | null,
) => void;

export interface ProgressOptions {
  onProgress?: ProgressCallback;
}

@Injectable()
export class LawIndexService {
  private readonly logger = new Logger(LawIndexService.name);

  constructor(
    private readonly sitemap: VbplSitemapService,
    private readonly client: VbplClientService,
    private readonly repo: DocumentRepository,
    private readonly nodeRepo: DocumentNodeRepository,
  ) {}

  async syncDocument(url: string): Promise<SyncDocumentResult> {
    const raw = await this.client.fetchDocument(url);
    const parsed = parseVbplPage(raw);

    // Safety net (see law-index plan's Discovery section): the sitemap split
    // is the primary filter, but each page's own breadcrumb is the ground
    // truth — skip anything that turns out to be địa phương regardless of
    // which sitemap bucket it came from.
    if (parsed.scope !== 'trung-uong') {
      this.logger.warn(
        `Skipping ${url} — breadcrumb scope is "${parsed.scope}", not trung-uong`,
      );
      return {
        documentId: null,
        changed: false,
        skippedReason: `scope=${parsed.scope}`,
        healedReferences: 0,
      };
    }

    const { documentId, changed, skippedReason } =
      await this.repo.upsertDocument(parsed);
    if (!documentId) {
      this.logger.warn(`Skipping ${url} — ${skippedReason}`);
      return {
        documentId: null,
        changed: false,
        skippedReason,
        healedReferences: 0,
      };
    }

    await this.repo.upsertRelations(documentId, parsed);
    try {
      await this.repo.extractTextReferences(documentId, parsed);
    } catch (err) {
      this.logger.warn(
        `Failed to extract text references for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await this.nodeRepo.syncNodes(documentId, parsed, changed);
    } catch (err) {
      // A malformed body shouldn't roll back the already-successful
      // document upsert — same per-document resilience as syncAll's
      // try/catch below, just scoped to the node-tree step.
      this.logger.warn(
        `Failed to build document_node tree for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Dangling references are no longer healed per document here (was an
    // O(n²)-ish full dangling-refs scan on every single sync) — batch
    // operations (syncDocumentsBatch/updateDocumentsBatch/syncAll/
    // searchAndSyncDocuments) heal once at the end instead. A single-doc sync
    // via this path leaves any newly-resolvable references dangling until
    // the next batch job or a manual PATCH /laws/index/sync/refs/all call —
    // see the scrape/backfill runbook in CLAUDE.md, which now calls this out
    // explicitly for passes driven by individual POST /crawl/url calls.
    return { documentId, changed, healedReferences: 0 };
  }

  /**
   * Fetches a document from a vbpl.vn URL, finds the existing DB row by
   * citationId, and updates it in place. Fails with a clear error if no
   * matching document exists in the index. Does NOT create new documents.
   *
   * `force` re-writes the row even when content_version matches — needed to
   * backfill a column added after the document was last scraped, which an
   * ordinary update cannot do (the hash is computed from the page, so a new
   * column never changes it and the row is skipped as unchanged).
   */
  async updateDocumentByUrl(
    url: string,
    force = false,
  ): Promise<UpdateDocumentByUrlResult | UpdateDocumentByUrlError> {
    const raw = await this.client.fetchDocument(url);
    const parsed = parseVbplPage(raw);

    if (parsed.scope !== 'trung-uong') {
      this.logger.warn(
        `Skipping update ${url} — breadcrumb scope is "${parsed.scope}", not trung-uong`,
      );
      return {
        message: `Document at URL has scope "${parsed.scope}", not trung-uong. Only trung-uong documents are indexed.`,
        citationId: parsed.attributes.citation,
        url,
      };
    }

    const result = await this.repo.updateDocument(parsed, force);

    if (result.notFound) {
      this.logger.warn(
        `Update failed: no document found for citation "${result.citationId}" (URL: ${url})`,
      );
      return {
        message: `No document found in the index matching citation "${result.citationId}". Sync it first via POST /laws/index/crawl/url.`,
        citationId: result.citationId,
        url,
      };
    }

    if (result.unchanged) {
      this.logger.debug(
        `Update skipped: document "${result.citationId}" unchanged (same content_version).`,
      );
      return {
        documentId: result.documentId,
        citationId: result.citationId,
        changed: false,
        healedReferences: 0,
      };
    }

    await this.repo.upsertRelations(result.documentId, parsed);
    try {
      await this.repo.extractTextReferences(result.documentId, parsed);
    } catch (err) {
      this.logger.warn(
        `Failed to extract text references for update ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await this.nodeRepo.syncNodes(result.documentId, parsed, true);
    } catch (err) {
      this.logger.warn(
        `Failed to update document_node tree for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // See syncDocument's comment above: no longer healed per document —
    // batch operations heal once at the end, individual-URL passes need a
    // manual PATCH /laws/index/sync/refs/all (see CLAUDE.md's runbook).
    return {
      documentId: result.documentId,
      citationId: result.citationId,
      changed: true,
      healedReferences: 0,
    };
  }

  /**
   * Updates a batch of documents from vbpl.vn URLs. Per-URL failures and
   * not-found citations are collected rather than aborting the batch. Returns
   * a summary with updated/unchanged/notFound/error counts and a final
   * dangling-reference heal pass. Does NOT create new documents.
   *
   * `force` is passed straight through to updateDocumentByUrl — with it set,
   * `unchanged` stays 0 and every URL costs a full re-scrape, so keep batches
   * small (see docs/monitoring/law-index-flagged-documents.md §6 on unattended
   * large batches).
   */
  async updateDocumentsBatch(
    urls: string[],
    force = false,
    options?: ProgressOptions,
  ): Promise<BatchUpdateSummary> {
    const summary: BatchUpdateSummary = {
      totalUrls: urls.length,
      updated: 0,
      unchanged: 0,
      healedReferences: 0,
      notFound: [],
      errors: [],
    };

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const result = await this.updateDocumentByUrl(url, force);
        if ('message' in result) {
          summary.notFound.push({
            url,
            citationId: result.citationId,
            message: result.message,
          });
        } else if (result.changed) {
          summary.updated += 1;
          summary.healedReferences += result.healedReferences;
        } else {
          summary.unchanged += 1;
        }
      } catch (err) {
        summary.errors.push({
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      options?.onProgress?.(i + 1, urls.length);
    }

    summary.healedReferences = await this.repo.healDanglingReferences();
    return summary;
  }

  /**
   * Syncs a batch of documents from a list of vbpl.vn URLs. Per-URL failures
   * are collected into `errors` rather than aborting the batch. Returns a
   * summary with synced/skipped/error counts and a final dangling-reference
   * heal pass.
   */
  async syncDocumentsBatch(
    urls: string[],
    options?: ProgressOptions,
  ): Promise<SyncSummary> {
    const summary: SyncSummary = {
      totalUrls: urls.length,
      synced: 0,
      skipped: 0,
      healedReferences: 0,
      errors: [],
    };

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const result = await this.syncDocument(url);
        if (result.skippedReason) {
          summary.skipped += 1;
        } else {
          summary.synced += 1;
        }
        summary.healedReferences += result.healedReferences;
      } catch (err) {
        summary.errors.push({
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      options?.onProgress?.(i + 1, urls.length);
    }

    summary.healedReferences = await this.repo.healDanglingReferences();
    return summary;
  }

  /**
   * Crawls the trung-ương sitemap block and syncs every document URL found,
   * up to `limit` (unset = unbounded — driven via the job queue for a real
   * "hundreds of documents" pass rather than one blocking HTTP request, see
   * job-queue/job-worker.ts). Always smoke-test with a small limit first.
   *
   * Progress reporting: `onProgress` is called with `total: limit` from the
   * very first document when a `limit` was given (a bounded run's total is
   * known upfront), or `total: null` for the whole run when it wasn't —
   * sitemap enumeration is interleaved with syncing here (each sitemap
   * page's URLs are synced before the next page is even fetched), so an
   * unbounded crawl's real total genuinely isn't knowable until the run is
   * already finished, not just during some initial "discovery" phase.
   */
  async syncAll(
    options: { limit?: number } & ProgressOptions = {},
  ): Promise<SyncSummary> {
    const summary: SyncSummary = {
      totalUrls: 0,
      synced: 0,
      skipped: 0,
      healedReferences: 0,
      errors: [],
    };
    const sitemapUrls = await this.sitemap.fetchTrungUongSitemapUrls();

    outer: for (const sitemapUrl of sitemapUrls) {
      const docUrls = await this.sitemap.fetchDocumentUrls(sitemapUrl);
      for (const url of docUrls) {
        if (options.limit !== undefined && summary.totalUrls >= options.limit)
          break outer;
        summary.totalUrls += 1;
        try {
          const result = await this.syncDocument(url);
          if (result.skippedReason) {
            summary.skipped += 1;
          } else {
            summary.synced += 1;
          }
          summary.healedReferences += result.healedReferences;
        } catch (err) {
          summary.errors.push({
            url,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        options.onProgress?.(summary.totalUrls, options.limit ?? null);
      }
    }

    summary.healedReferences = await this.repo.healDanglingReferences();
    return summary;
  }

  /**
   * Targeted/filtered search against vbpl.vn/van-ban/trung-uong — mirrors the
   * site's own "Bộ lọc" sidebar + "Tìm kiếm nâng cao" advanced panel. Purely
   * read-only: returns matched documents' metadata + sourceUrl for the
   * caller to inspect or feed into syncDocument, without syncing them itself.
   */
  async searchDocuments(filters: VbplSearchFilters): Promise<VbplSearchResult> {
    const raw = await this.client.searchDocuments(filters);
    return parseVbplSearchPage(raw);
  }

  /**
   * Searches vbpl.vn with the given filters, then syncs each matched document
   * into Postgres. Per-document failures are collected into `errors` rather
   * than aborting. When `dryRun` is true, only the search results are returned.
   */
  async searchAndSyncDocuments(
    filters: SearchSyncDocumentsDto,
    options?: ProgressOptions,
  ): Promise<SearchAndSyncSummary> {
    const searchResult = await this.searchDocuments(filters);

    const items: SearchAndSyncSummary['items'] = [];

    let synced = 0;
    let skipped = 0;
    let healedReferences = 0;
    const errors: Array<{ url: string; error: string }> = [];

    if (!filters.dryRun) {
      const maxResults = filters.maxResults ?? 50;
      const toSync = searchResult.items.slice(0, maxResults);

      for (let i = 0; i < toSync.length; i++) {
        const item = toSync[i];
        try {
          const result = await this.syncDocument(item.sourceUrl);
          if (result.skippedReason) {
            skipped += 1;
            items.push({
              ...item,
              syncResult: { skippedReason: result.skippedReason },
            });
          } else {
            synced += 1;
            healedReferences += result.healedReferences;
            items.push({
              ...item,
              syncResult: {
                documentId: result.documentId!,
                changed: result.changed,
              },
            });
          }
        } catch (err) {
          errors.push({
            url: item.sourceUrl,
            error: err instanceof Error ? err.message : String(err),
          });
          items.push({
            ...item,
            syncResult: {
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
        options?.onProgress?.(i + 1, toSync.length);
      }

      // Final heal pass across all dangling refs
      healedReferences = await this.repo.healDanglingReferences();

      // Append any remaining search items that weren't synced (exceeded maxResults)
      for (const item of searchResult.items.slice(maxResults)) {
        items.push({ ...item, syncResult: null });
      }
    } else {
      for (const item of searchResult.items) {
        items.push({ ...item, syncResult: null });
      }
    }

    return {
      total: searchResult.total,
      page: searchResult.page,
      pageSize: searchResult.pageSize,
      items,
      synced,
      skipped,
      healedReferences,
      errors,
    };
  }
}
