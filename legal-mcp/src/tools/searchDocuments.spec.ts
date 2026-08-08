import { describe, expect, it, jest } from '@jest/globals';
import {
  DEFAULT_VALIDITY_STATUS,
  searchDocumentsHandler,
} from './searchDocuments.js';
import type { LawApiClient } from '../lawApi/client.js';
import type { LawSearchResult } from '../lawApi/types.js';

function buildMockClient(): LawApiClient {
  return { search: jest.fn() } as unknown as LawApiClient;
}

const emptyResult: LawSearchResult = {
  total: 0,
  page: 1,
  pageSize: 10,
  items: [],
};

describe('searchDocumentsHandler', () => {
  it('defaults validityStatus to "Còn hiệu lực" when omitted', async () => {
    const client = buildMockClient();
    jest.mocked(client.search).mockResolvedValue(emptyResult);

    await searchDocumentsHandler(client, { keyword: 'Luật Doanh nghiệp' });

    expect(jest.mocked(client.search)).toHaveBeenCalledWith({
      keyword: 'Luật Doanh nghiệp',
      validityStatus: DEFAULT_VALIDITY_STATUS,
    });
  });

  it('does not apply the default when includeHistorical is true', async () => {
    const client = buildMockClient();
    jest.mocked(client.search).mockResolvedValue(emptyResult);

    await searchDocumentsHandler(client, {
      keyword: 'Hiến pháp 1946',
      includeHistorical: true,
    });

    const callArgs = jest.mocked(client.search).mock.calls[0][0];
    expect(callArgs.validityStatus).toBeUndefined();
  });

  it('lets an explicit validityStatus win over the default', async () => {
    const client = buildMockClient();
    jest.mocked(client.search).mockResolvedValue(emptyResult);

    await searchDocumentsHandler(client, {
      keyword: 'Luật Doanh nghiệp',
      validityStatus: 'Hết hiệu lực toàn bộ',
    });

    const callArgs = jest.mocked(client.search).mock.calls[0][0];
    expect(callArgs.validityStatus).toBe('Hết hiệu lực toàn bộ');
  });

  it('does not forward includeHistorical to LawApiClient.search (not a wire param)', async () => {
    const client = buildMockClient();
    jest.mocked(client.search).mockResolvedValue(emptyResult);

    await searchDocumentsHandler(client, {
      keyword: 'x',
      includeHistorical: true,
    });

    const callArgs = jest.mocked(client.search).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArgs).not.toHaveProperty('includeHistorical');
  });

  it('returns the search result JSON-stringified as text content', async () => {
    const client = buildMockClient();
    const result: LawSearchResult = {
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          documentId: 'doc-1',
          sourceUrl: 'https://vbpl.vn/x',
          citation: '59/2020/QH14',
          title: 'Luật Doanh nghiệp',
          documentType: 'Luật',
          issuingBody: 'Quốc hội',
          issuedDate: '17/06/2020',
          effectiveDate: '01/01/2021',
          expiryDate: null,
          validityStatus: 'Còn hiệu lực',
        },
      ],
    };
    jest.mocked(client.search).mockResolvedValue(result);

    const toolResult = await searchDocumentsHandler(client, {
      keyword: 'Luật Doanh nghiệp',
    });

    expect(toolResult.content).toEqual([
      { type: 'text', text: JSON.stringify(result) },
    ]);
  });
});
