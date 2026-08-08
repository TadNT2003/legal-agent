import { describe, expect, it, jest } from '@jest/globals';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  CallToolResult,
  GetPromptResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  callMcpTool,
  fetchPromptText,
  listOpenAiTools,
  toOpenAiTools,
} from './tools.js';

function buildMockClient(): Client {
  return {
    listTools: jest.fn(),
    callTool: jest.fn(),
    getPrompt: jest.fn(),
  } as unknown as Client;
}

describe('toOpenAiTools', () => {
  it('reshapes MCP tools into OpenAI function-calling tool schemas', () => {
    const mcpTools: Tool[] = [
      {
        name: 'search_documents',
        description: 'Search legal documents.',
        inputSchema: {
          type: 'object',
          properties: { keyword: { type: 'string' } },
        },
      },
    ];

    const result = toOpenAiTools(mcpTools);

    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'search_documents',
          description: 'Search legal documents.',
          parameters: {
            type: 'object',
            properties: { keyword: { type: 'string' } },
          },
        },
      },
    ]);
  });
});

describe('callMcpTool', () => {
  it('parses arguments, calls the tool, and returns the text content', async () => {
    const client = buildMockClient();
    const result: CallToolResult = {
      content: [{ type: 'text', text: '{"total":1}' }],
    };
    jest.mocked(client.callTool).mockResolvedValue(result);

    const text = await callMcpTool(
      client,
      'search_documents',
      JSON.stringify({ keyword: 'x' }),
    );

    expect(jest.mocked(client.callTool)).toHaveBeenCalledWith({
      name: 'search_documents',
      arguments: { keyword: 'x' },
    });
    expect(text).toBe('{"total":1}');
  });

  it('treats an empty rawArgs string as no arguments', async () => {
    const client = buildMockClient();
    jest.mocked(client.callTool).mockResolvedValue({
      content: [{ type: 'text', text: '{}' }],
    });

    await callMcpTool(client, 'get_document', '');

    expect(jest.mocked(client.callTool)).toHaveBeenCalledWith({
      name: 'get_document',
      arguments: {},
    });
  });

  it('throws using the content text when the MCP result has isError set', async () => {
    const client = buildMockClient();
    jest.mocked(client.callTool).mockResolvedValue({
      content: [{ type: 'text', text: 'Document not found' }],
      isError: true,
    });

    await expect(
      callMcpTool(client, 'get_document', '{"documentId":"missing"}'),
    ).rejects.toThrow('Document not found');
  });
});

describe('fetchPromptText', () => {
  it('extracts the first message text content', async () => {
    const client = buildMockClient();
    const result: GetPromptResult = {
      messages: [
        { role: 'user', content: { type: 'text', text: 'Follow this recipe...' } },
      ],
    };
    jest.mocked(client.getPrompt).mockResolvedValue(result);

    const text = await fetchPromptText(client, 'legal_lookup_guidance');

    expect(jest.mocked(client.getPrompt)).toHaveBeenCalledWith({
      name: 'legal_lookup_guidance',
    });
    expect(text).toBe('Follow this recipe...');
  });

  it('throws when the prompt has no text content', async () => {
    const client = buildMockClient();
    jest.mocked(client.getPrompt).mockResolvedValue({
      messages: [],
    });

    await expect(
      fetchPromptText(client, 'legal_lookup_guidance'),
    ).rejects.toThrow('did not return text content');
  });
});

describe('listOpenAiTools', () => {
  it('fetches tools/list from the client and reshapes them', async () => {
    const client = buildMockClient();
    const mcpTools: Tool[] = [
      { name: 'get_document', description: 'Get a document.', inputSchema: { type: 'object' } },
    ];
    jest.mocked(client.listTools).mockResolvedValue({ tools: mcpTools });

    const result = await listOpenAiTools(client);

    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_document',
          description: 'Get a document.',
          parameters: { type: 'object' },
        },
      },
    ]);
  });
});
