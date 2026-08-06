import type {
  LawDocument,
  LawNodeParams,
  LawNodeResult,
  LawSearchParams,
  LawSearchResult,
} from './types.js';

/**
 * Thin HTTP client over the scraper server's (../server) existing
 * /laws/index/retrieve/* endpoints. This app never talks to Postgres
 * directly — retrieval only ever goes through here.
 *
 * Vietnamese filter values must be NFC-normalized before being sent: the
 * scraper's document_type/issuing_body columns store NFC text, and an NFD
 * (decomposed) input string with the same visible characters otherwise
 * silently matches zero rows instead of erroring.
 */
export class LawApiClient {
  constructor(private readonly baseUrl: string) {}

  async search(params: LawSearchParams): Promise<LawSearchResult> {
    const query = new URLSearchParams();
    if (params.keyword) query.set('keyword', normalize(params.keyword));
    if (params.searchScope) query.set('searchScope', params.searchScope);
    for (const type of params.documentTypes ?? []) {
      query.append('documentTypes', normalize(type));
    }
    for (const body of params.issuingBodies ?? []) {
      query.append('issuingBodies', normalize(body));
    }
    if (params.validityStatus) {
      query.set('validityStatus', normalize(params.validityStatus));
    }
    if (params.issuedFrom) query.set('issuedFrom', params.issuedFrom);
    if (params.issuedTo) query.set('issuedTo', params.issuedTo);
    if (params.effectiveFrom) query.set('effectiveFrom', params.effectiveFrom);
    if (params.effectiveTo) query.set('effectiveTo', params.effectiveTo);
    query.set('page', String(params.page ?? 1));
    query.set('pageSize', String(params.pageSize ?? 10));

    return this.get<LawSearchResult>(`/laws/index/retrieve?${query}`);
  }

  async getById(documentId: string): Promise<LawDocument> {
    return this.get<LawDocument>(
      `/laws/index/retrieve/${encodeURIComponent(documentId)}`,
    );
  }

  async getNodes(params: LawNodeParams): Promise<LawNodeResult> {
    const query = new URLSearchParams();
    query.set('documentId', params.documentId);
    if (params.nodeType) query.set('nodeType', params.nodeType);
    if (params.number) query.set('number', params.number);
    if (params.nodeId) query.set('nodeId', params.nodeId);

    return this.get<LawNodeResult>(`/laws/index/retrieve/nodes?${query}`);
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Law API request failed: GET ${path} -> ${response.status} ${body}`,
      );
    }
    return (await response.json()) as T;
  }
}

function normalize(value: string): string {
  return value.normalize('NFC');
}
