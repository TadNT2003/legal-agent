import { describe, expect, it, jest } from '@jest/globals';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type OpenAI from 'openai';
import { AgentService } from './agentService.js';

interface MockToolCallMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

interface MockChatCompletion {
  choices: [{ message: MockToolCallMessage }];
}

interface CreateCallArgs {
  model: string;
  messages: Array<{
    role: string;
    content?: string | null;
    tool_call_id?: string;
  }>;
  tools: unknown[];
}

type CreateMock = jest.Mock<
  (args: CreateCallArgs) => Promise<MockChatCompletion>
>;

interface MockOpenAi {
  chat: {
    completions: {
      create: CreateMock;
    };
  };
}

function buildMockOpenAi(responses: MockChatCompletion[]): MockOpenAi {
  const create: CreateMock = jest.fn<
    (args: CreateCallArgs) => Promise<MockChatCompletion>
  >();
  responses.forEach((r) => create.mockResolvedValueOnce(r));
  return { chat: { completions: { create } } };
}

function asOpenAi(mock: MockOpenAi): OpenAI {
  return mock as unknown as OpenAI;
}

function buildMockMcpClient(): Client {
  return { callTool: jest.fn() } as unknown as Client;
}

function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function toolCallResponse(
  name: string,
  args: Record<string, unknown>,
): MockChatCompletion {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

function finalResponse(content: string): MockChatCompletion {
  return {
    choices: [{ message: { role: 'assistant', content } }],
  };
}

const NO_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
const SYSTEM_PROMPT = 'test system prompt';

describe('AgentService', () => {
  it('returns the final message directly when the model makes no tool calls', async () => {
    const openai = buildMockOpenAi([finalResponse('Xin chào')]);
    const mcpClient = buildMockMcpClient();
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      mcpClient,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const reply = await service.chat('hi');

    expect(reply).toBe('Xin chào');
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call via MCP, feeds the result back, and returns the follow-up answer', async () => {
    const openai = buildMockOpenAi([
      toolCallResponse('get_document', { documentId: 'doc-1' }),
      finalResponse('Điều 5 nói về vốn điều lệ, theo 59/2020/QH14.'),
    ]);
    const mcpClient = buildMockMcpClient();
    jest
      .mocked(mcpClient.callTool)
      .mockResolvedValue(
        textResult({ id: 'doc-1', citationId: '59/2020/QH14' }),
      );
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      mcpClient,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const reply = await service.chat('what does doc-1 say?');

    expect(jest.mocked(mcpClient.callTool)).toHaveBeenCalledWith({
      name: 'get_document',
      arguments: { documentId: 'doc-1' },
    });
    expect(reply).toBe('Điều 5 nói về vốn điều lệ, theo 59/2020/QH14.');
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(2);

    const secondCallArgs = openai.chat.completions.create.mock.calls[1][0];
    const toolMessage = secondCallArgs.messages.find(
      (m) => m.role === 'tool',
    );
    expect(toolMessage?.tool_call_id).toBe('call-1');
    expect(JSON.parse(toolMessage?.content ?? '{}')).toEqual({
      id: 'doc-1',
      citationId: '59/2020/QH14',
    });
  });

  it('returns a fallback message when the tool-calling loop never terminates', async () => {
    const infiniteToolCall = toolCallResponse('get_document', {
      documentId: 'doc-1',
    });
    const openai = buildMockOpenAi(
      Array.from({ length: 10 }, () => infiniteToolCall),
    );
    const mcpClient = buildMockMcpClient();
    jest
      .mocked(mcpClient.callTool)
      .mockResolvedValue(textResult({ id: 'doc-1' }));
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      mcpClient,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const reply = await service.chat('loop forever');

    expect(reply).toContain('Xin lỗi');
  });

  it('reports an MCP tool error back to the model instead of throwing', async () => {
    const openai = buildMockOpenAi([
      toolCallResponse('get_document', { documentId: 'missing' }),
      finalResponse('Không tìm thấy văn bản.'),
    ]);
    const mcpClient = buildMockMcpClient();
    jest
      .mocked(mcpClient.callTool)
      .mockRejectedValue(new Error('404 not found'));
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      mcpClient,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const reply = await service.chat('what does missing say?');

    expect(reply).toBe('Không tìm thấy văn bản.');
    const secondCallArgs = openai.chat.completions.create.mock.calls[1][0];
    const toolMessage = secondCallArgs.messages.find(
      (m) => m.role === 'tool',
    );
    const parsed = JSON.parse(toolMessage?.content ?? '{}') as {
      error: string;
    };
    expect(parsed.error).toContain('404 not found');
  });

  it('reports an MCP-level tool error (isError) back to the model instead of throwing', async () => {
    const openai = buildMockOpenAi([
      toolCallResponse('get_document', { documentId: 'missing' }),
      finalResponse('Không tìm thấy văn bản.'),
    ]);
    const mcpClient = buildMockMcpClient();
    jest.mocked(mcpClient.callTool).mockResolvedValue({
      content: [{ type: 'text', text: 'Document not found' }],
      isError: true,
    });
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      mcpClient,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const reply = await service.chat('what does missing say?');

    expect(reply).toBe('Không tìm thấy văn bản.');
    const secondCallArgs = openai.chat.completions.create.mock.calls[1][0];
    const toolMessage = secondCallArgs.messages.find(
      (m) => m.role === 'tool',
    );
    const parsed = JSON.parse(toolMessage?.content ?? '{}') as {
      error: string;
    };
    expect(parsed.error).toContain('Document not found');
  });
});
