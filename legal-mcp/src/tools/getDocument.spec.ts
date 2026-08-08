import { describe, expect, it, jest } from '@jest/globals';
import { getDocumentHandler } from './getDocument.js';
import type { LawApiClient } from '../lawApi/client.js';
import type { LawDocument } from '../lawApi/types.js';

function buildMockClient(): LawApiClient {
  return { getById: jest.fn() } as unknown as LawApiClient;
}

describe('getDocumentHandler', () => {
  it('forwards documentId to LawApiClient.getById and returns JSON text content', async () => {
    const client = buildMockClient();
    const document: LawDocument = {
      id: 'doc-1',
      citationId: '254/2026/NĐ-CP',
      title: 'Nghị định về hóa đơn điện tử',
      documentType: 'Nghị định',
      issuingBody: 'Chính phủ',
      industry: null,
      field: null,
      signerName: null,
      signerTitle: null,
      enactedDate: '2026-01-01',
      effectiveDate: '2026-07-01',
      gazettePublishedDate: null,
      validityStatus: 'Còn hiệu lực',
      isConsolidated: false,
      consolidatesDocumentId: null,
      sourceUrl: 'https://vbpl.vn/x',
    };
    jest.mocked(client.getById).mockResolvedValue(document);

    const result = await getDocumentHandler(client, { documentId: 'doc-1' });

    expect(jest.mocked(client.getById)).toHaveBeenCalledWith('doc-1');
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(document) },
    ]);
  });
});
