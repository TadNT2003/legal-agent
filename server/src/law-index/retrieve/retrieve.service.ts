import { Injectable, Logger } from '@nestjs/common';
import type {
  VbplSearchFilters,
  VbplSearchResult,
} from '../crawl/vbpl-document.interface';
import { DocumentRepository } from '../persistence/document.repository';

@Injectable()
export class RetrieveService {
  private readonly logger = new Logger(RetrieveService.name);

  constructor(private readonly repo: DocumentRepository) {}

  /**
   * Search locally synced documents in the Postgres database using the same
   * filter parameters as the vbpl.vn crawl search. Returns paginated results
   * from already-scraped records only.
   */
  async search(filters: VbplSearchFilters): Promise<VbplSearchResult> {
    return this.repo.searchLocalDocuments(filters);
  }
}
