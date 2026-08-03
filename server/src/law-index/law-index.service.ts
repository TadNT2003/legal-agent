import { Injectable, Logger } from '@nestjs/common';
import { VbplClientService } from './crawl/vbpl-client.service';
import { VbplSitemapService } from './crawl/vbpl-sitemap.service';
import { parseVbplPage, parseVbplSearchPage } from './crawl/vbpl.parser';
import type {
  VbplSearchFilters,
  VbplSearchResult,
} from './crawl/vbpl-document.interface';
import { DocumentRepository } from './persistence/document.repository';
import { DocumentNodeRepository } from './persistence/document-node.repository';

export interface SyncDocumentResult {
  documentId: string | null;
  changed: boolean;
  skippedReason?: string;
  healedReferences: number;
}

export interface SyncSummary {
  totalUrls: number;
  synced: number;
  skipped: number;
  healedReferences: number;
  errors: Array<{ url: string; error: string }>;
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

    const { documentId, changed } = await this.repo.upsertDocument(parsed);
    await this.repo.upsertRelations(documentId, parsed);
    try {
      await this.repo.extractPreambleReferences(documentId, parsed.fullText);
    } catch (err) {
      this.logger.warn(
        `Failed to extract preamble references for ${url}: ${err instanceof Error ? err.message : String(err)}`,
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
    const healedReferences = await this.repo.healDanglingReferences();
    return { documentId, changed, healedReferences };
  }

  /**
   * Syncs a batch of documents from a list of vbpl.vn URLs. Per-URL failures
   * are collected into `errors` rather than aborting the batch. Returns a
   * summary with synced/skipped/error counts and a final dangling-reference
   * heal pass.
   */
  async syncDocumentsBatch(urls: string[]): Promise<SyncSummary> {
    const summary: SyncSummary = {
      totalUrls: urls.length,
      synced: 0,
      skipped: 0,
      healedReferences: 0,
      errors: [],
    };

    for (const url of urls) {
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
    }

    summary.healedReferences = await this.repo.healDanglingReferences();
    return summary;
  }

  /**
   * Crawls the trung-ương sitemap block and syncs every document URL found,
   * up to `limit` (unset = unbounded — a full crawl currently means one very
   * long-running call; there's no resumable cursor/job-queue yet, so for now
   * a full trung-ương crawl should be driven in externally-chunked `limit`
   * batches rather than one unbounded call. See the law-index plan's
   * Verification section: always smoke-test with a small limit first.)
   */
  async syncAll(options: { limit?: number } = {}): Promise<SyncSummary> {
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
}
