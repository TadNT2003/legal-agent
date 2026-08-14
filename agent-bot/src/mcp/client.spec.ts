import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import 'dotenv/config';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ReconnectingMcpClient } from './client.js';

process.env.MCP_SERVER_URL = 'http://localhost:3202/mcp';
process.env.OPENAI_BASE_URL = 'http://localhost:8800/v1';
process.env.OPENAI_API_KEY = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
process.env.DISCORD_BOT_TOKEN = 'test-token';

function buildMockClient(): jest.Mocked<Client> {
  return {
    callTool: jest.fn(),
    listTools: jest.fn(),
    getPrompt: jest.fn(),
    close: jest.fn(),
  } as unknown as jest.Mocked<Client>;
}

describe('ReconnectingMcpClient', () => {
  let mockClient: jest.Mocked<Client>;
  let wrapper: ReconnectingMcpClient;

  beforeEach(() => {
    mockClient = buildMockClient();
    wrapper = new ReconnectingMcpClient(mockClient);
  });

  it('delegates callTool to the underlying client on success', async () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: '{"found":true}' }],
    };
    mockClient.callTool.mockResolvedValue(result);

    const res = await wrapper.callTool('search_documents', { keyword: 'test' });

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'search_documents',
      arguments: { keyword: 'test' },
    });
    expect(res).toBe(result);
  });

  it('delegates listTools to the underlying client', async () => {
    const tools = { tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' as const } }] };
    mockClient.listTools.mockResolvedValue(tools);

    const res = await wrapper.listTools();

    expect(mockClient.listTools).toHaveBeenCalled();
    expect(res).toBe(tools);
  });

  it('delegates getPrompt to the underlying client', async () => {
    const prompt = { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'guide' } }] };
    mockClient.getPrompt.mockResolvedValue(prompt);

    const res = await wrapper.getPrompt('legal_lookup_guidance');

    expect(mockClient.getPrompt).toHaveBeenCalledWith({
      name: 'legal_lookup_guidance',
    });
    expect(res).toBe(prompt);
  });

  it('throws non-connection errors without reconnecting', async () => {
    mockClient.callTool.mockRejectedValue(new Error('Tool not found'));

    await expect(
      wrapper.callTool('bad_tool', {}),
    ).rejects.toThrow('Tool not found');

    expect(mockClient.close).not.toHaveBeenCalled();
  });

  it('passes through non-Error throws without reconnecting', async () => {
    mockClient.callTool.mockRejectedValue('string error');

    await expect(
      wrapper.callTool('bad_tool', {}),
    ).rejects.toBe('string error');

    expect(mockClient.close).not.toHaveBeenCalled();
  });
});