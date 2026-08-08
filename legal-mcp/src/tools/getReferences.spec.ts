import { describe, expect, it, jest } from '@jest/globals';
import { getReferencesHandler } from './getReferences.js';
import type { LawApiClient } from '../lawApi/client.js';
import type { LawReferencesResult } from '../lawApi/types.js';

function buildMockClient(): LawApiClient {
  return { getReferences: jest.fn() } as unknown as LawApiClient;
}

describe('getReferencesHandler', () => {
  it('forwards documentId, direction, and referenceType to LawApiClient.getReferences', async () => {
    const client = buildMockClient();
    const result: LawReferencesResult = {
      citationId: '59/2020/QH14',
      title: 'Luật Doanh nghiệp',
      total: 1,
      references: [
        {
          id: 'ref-1',
          sourceDocumentId: 'doc-2',
          sourceCitationId: '76/2025/QH15',
          sourceTitle: 'Luật Sửa đổi, bổ sung một số điều của Luật Doanh nghiệp',
          targetDocumentId: 'doc-1',
          targetCitationId: '59/2020/QH14',
          targetTitle: 'Luật Doanh nghiệp',
          referenceType: 'amends',
          changeType: null,
          rawCitationText: 'Luật Doanh nghiệp số 59/2020/QH14',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    jest.mocked(client.getReferences).mockResolvedValue(result);

    const toolResult = await getReferencesHandler(client, {
      documentId: 'doc-1',
      direction: 'incoming',
      referenceType: 'amends',
    });

    expect(jest.mocked(client.getReferences)).toHaveBeenCalledWith({
      documentId: 'doc-1',
      direction: 'incoming',
      referenceType: 'amends',
    });
    expect(toolResult.content).toEqual([
      { type: 'text', text: JSON.stringify(result) },
    ]);
  });
});
