import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { VanBanChinhPhuClientService } from '../download/vanban-chinh-phu-client.service';
import { parseDocumentDetailPage } from '../download/vanban-chinh-phu.parser';
import { ChinhPhuDocumentRepository } from '../persistence/chinhphu-document.repository';
import { DocumentNodeRepository } from '../persistence/document-node.repository';
import { parseChinhPhuDocument } from './chinhphu.parser';
import {
  DOCUMENT_TEXT_EXTRACTOR,
  type DocumentTextExtractor,
} from './document-text-extractor';

export interface SyncChinhPhuDocumentResult {
  documentId: string | null;
  changed: boolean;
  skippedReason?: string;
  hasFullText: boolean;
}

/**
 * Orchestrates a vanban.chinhphu.vn document sync — a supplementary source
 * alongside crawl/'s vbpl.vn (the primary source, see
 * docs/plan/law-index-plan.md's Context section on why). Mirrors
 * crawl/crawl.service.ts's syncDocument shape, minus everything that
 * doesn't apply here yet: no relations/lược đồ (vanban.chinhphu.vn has no
 * curated relationship graph), and no document_node tree unless
 * DOCUMENT_TEXT_EXTRACTOR actually produced fullText — see that port's own
 * doc comment for why it's a no-op today.
 */
@Injectable()
export class ChinhPhuCrawlService {
  private readonly logger = new Logger(ChinhPhuCrawlService.name);

  constructor(
    private readonly client: VanBanChinhPhuClientService,
    @Inject(DOCUMENT_TEXT_EXTRACTOR)
    private readonly textExtractor: DocumentTextExtractor,
    private readonly repo: ChinhPhuDocumentRepository,
    private readonly nodeRepo: DocumentNodeRepository,
  ) {}

  async syncDocument(url: string): Promise<SyncChinhPhuDocumentResult> {
    const html = await this.client.fetchDocumentPage(url);
    const raw = parseDocumentDetailPage(html, url);
    if (!raw) {
      throw new BadGatewayException(
        `vanban.chinhphu.vn document page at ${url} has no recognizable "Số ký hiệu" — cannot index it.`,
      );
    }

    const extracted = await this.textExtractor.extractText(raw.fileUrls);
    const parsed = parseChinhPhuDocument(raw, extracted);

    const { documentId, changed, skippedReason } =
      await this.repo.upsertDocument(parsed);
    if (!documentId) {
      this.logger.warn(`Skipping ${url} — ${skippedReason}`);
      return {
        documentId: null,
        changed: false,
        skippedReason,
        hasFullText: false,
      };
    }

    if (parsed.fullText !== null) {
      try {
        await this.nodeRepo.syncNodes(
          documentId,
          { fullText: parsed.fullText },
          changed,
        );
      } catch (err) {
        // A malformed body shouldn't roll back the already-successful
        // document upsert — same per-document resilience as
        // crawl.service.ts's syncDocument.
        this.logger.warn(
          `Failed to build document_node tree for ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { documentId, changed, hasFullText: parsed.fullText !== null };
  }
}
