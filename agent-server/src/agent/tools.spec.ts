import { describe, expect, it, jest } from '@jest/globals';
import { dispatchToolCall } from './tools.js';
import type { LawApiClient } from '../lawApi/client.js';
import type { LawNodeResult, LawSearchResult } from '../lawApi/types.js';

function buildMockClient(): LawApiClient {
  return {
    search: jest.fn(),
    getById: jest.fn(),
    getNodes: jest.fn(),
  } as unknown as LawApiClient;
}

describe('dispatchToolCall', () => {
  it('search_documents forwards parsed args to LawApiClient.search', async () => {
    const client = buildMockClient();
    const expected: LawSearchResult = {
      total: 1,
      page: 1,
      pageSize: 10,
      items: [],
    };
    jest.mocked(client.search).mockResolvedValue(expected);

    const result = await dispatchToolCall(
      client,
      'search_documents',
      JSON.stringify({ keyword: 'vốn điều lệ' }),
    );

    expect(jest.mocked(client.search)).toHaveBeenCalledWith({
      keyword: 'vốn điều lệ',
    });
    expect(result).toBe(expected);
  });

  it('get_document forwards documentId to LawApiClient.getById', async () => {
    const client = buildMockClient();
    jest
      .mocked(client.getById)
      .mockResolvedValue({ id: 'doc-1' } as Awaited<
        ReturnType<LawApiClient['getById']>
      >);

    await dispatchToolCall(
      client,
      'get_document',
      JSON.stringify({ documentId: 'doc-1' }),
    );

    expect(jest.mocked(client.getById)).toHaveBeenCalledWith('doc-1');
  });

  it('get_document_nodes strips fullText/textContent when no nodeType/nodeId given (outline mode)', async () => {
    const client = buildMockClient();
    const full: LawNodeResult = {
      citationId: '59/2020/QH14',
      title: 'Luật Doanh nghiệp',
      nodes: [
        {
          id: 'n1',
          nodeType: 'dieu',
          label: 'Điều 5',
          ordinal: '5',
          heading: 'Vốn điều lệ',
          fullText: 'Điều 5. Vốn điều lệ\nFull legal text here.',
          textContent: 'Full legal text here.',
          contentClass: null,
          path: 'dieu5',
          children: [],
        },
      ],
    };
    jest.mocked(client.getNodes).mockResolvedValue(full);

    const result = (await dispatchToolCall(
      client,
      'get_document_nodes',
      JSON.stringify({ documentId: 'doc-1' }),
    )) as LawNodeResult;

    expect(result.nodes[0]).not.toHaveProperty('fullText');
    expect(result.nodes[0]).not.toHaveProperty('textContent');
    expect(result.nodes[0].label).toBe('Điều 5');
  });

  it('get_document_nodes keeps fullText when nodeType+number are given', async () => {
    const client = buildMockClient();
    const full: LawNodeResult = {
      citationId: '59/2020/QH14',
      title: 'Luật Doanh nghiệp',
      nodes: [
        {
          id: 'n1',
          nodeType: 'dieu',
          label: 'Điều 5',
          ordinal: '5',
          heading: 'Vốn điều lệ',
          fullText: 'Điều 5. Vốn điều lệ\nFull legal text here.',
          textContent: 'Full legal text here.',
          contentClass: null,
          path: 'dieu5',
          children: [],
        },
      ],
    };
    jest.mocked(client.getNodes).mockResolvedValue(full);

    const result = (await dispatchToolCall(
      client,
      'get_document_nodes',
      JSON.stringify({ documentId: 'doc-1', nodeType: 'dieu', number: '5' }),
    )) as LawNodeResult;

    expect(result.nodes[0].fullText).toContain('Full legal text here.');
  });

  it('throws on unknown tool name', async () => {
    const client = buildMockClient();
    await expect(dispatchToolCall(client, 'not_a_tool', '{}')).rejects.toThrow(
      'Unknown tool: not_a_tool',
    );
  });
});
