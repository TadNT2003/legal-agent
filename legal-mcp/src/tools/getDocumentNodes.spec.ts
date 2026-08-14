import { describe, expect, it, jest } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getDocumentNodesHandler } from './getDocumentNodes.js';
import type { LawApiClient } from '../lawApi/client.js';
import type { LawNodeResult } from '../lawApi/types.js';

function buildMockClient(): LawApiClient {
  return { getNodes: jest.fn() } as unknown as LawApiClient;
}

function fullResult(): LawNodeResult {
  return {
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
}

function textOf(result: CallToolResult): string {
  const block = result.content[0];
  if (block.type !== 'text') {
    throw new Error(`Expected a text content block, got "${block.type}"`);
  }
  return block.text;
}

describe('getDocumentNodesHandler', () => {
  it('strips fullText/textContent when no nodeType/nodeId given (outline mode)', async () => {
    const client = buildMockClient();
    jest.mocked(client.getNodes).mockResolvedValue(fullResult());

    const result = await getDocumentNodesHandler(client, {
      documentId: 'doc-1',
    });

    const payload = JSON.parse(textOf(result)) as {
      nodes: Array<Record<string, unknown>>;
    };
    expect(payload.nodes[0]).not.toHaveProperty('fullText');
    expect(payload.nodes[0]).not.toHaveProperty('textContent');
    expect(payload.nodes[0].label).toBe('Điều 5');
  });

  it('keeps fullText when nodeType+number are given', async () => {
    const client = buildMockClient();
    jest.mocked(client.getNodes).mockResolvedValue(fullResult());

    const result = await getDocumentNodesHandler(client, {
      documentId: 'doc-1',
      nodeType: 'dieu',
      number: '5',
    });

    const payload = JSON.parse(textOf(result)) as {
      nodes: Array<{ fullText: string }>;
    };
    expect(payload.nodes[0].fullText).toContain('Full legal text here.');
  });

  it('keeps fullText when nodeId is given', async () => {
    const client = buildMockClient();
    jest.mocked(client.getNodes).mockResolvedValue(fullResult());

    const result = await getDocumentNodesHandler(client, {
      documentId: 'doc-1',
      nodeId: 'n1',
    });

    const payload = JSON.parse(textOf(result)) as {
      nodes: Array<{ fullText: string }>;
    };
    expect(payload.nodes[0].fullText).toContain('Full legal text here.');
  });
});
