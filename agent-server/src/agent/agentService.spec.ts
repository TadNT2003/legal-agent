import { describe, expect, it, jest } from '@jest/globals';
import type OpenAI from 'openai';
import { AgentService } from './agentService.js';
import type { LawApiClient } from '../lawApi/client.js';
import type { LawDocument } from '../lawApi/types.js';

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

function mockGetById(
  result: LawDocument,
): jest.Mock<(documentId: string) => Promise<LawDocument>> {
  const mock = jest.fn<(documentId: string) => Promise<LawDocument>>();
  mock.mockResolvedValue(result);
  return mock;
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

describe('AgentService', () => {
  it('returns the final message directly when the model makes no tool calls', async () => {
    const openai = buildMockOpenAi([finalResponse('Xin chào')]);
    const lawApi = {} as LawApiClient;
    const service = new AgentService(asOpenAi(openai), 'test-model', lawApi);

    const reply = await service.chat('hi');

    expect(reply).toBe('Xin chào');
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call, feeds the result back, and returns the follow-up answer', async () => {
    const openai = buildMockOpenAi([
      toolCallResponse('get_document', { documentId: 'doc-1' }),
      finalResponse('Điều 5 nói về vốn điều lệ, theo 59/2020/QH14.'),
    ]);
    const lawApi = {
      getById: mockGetById({
        id: 'doc-1',
        citationId: '59/2020/QH14',
      } as LawDocument),
    } as unknown as LawApiClient;
    const service = new AgentService(asOpenAi(openai), 'test-model', lawApi);

    const reply = await service.chat('what does doc-1 say?');

    expect(jest.mocked(lawApi.getById)).toHaveBeenCalledWith('doc-1');
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
    const lawApi = {
      getById: mockGetById({ id: 'doc-1' } as LawDocument),
    } as unknown as LawApiClient;
    const service = new AgentService(asOpenAi(openai), 'test-model', lawApi);

    const reply = await service.chat('loop forever');

    expect(reply).toContain('Xin lỗi');
  });

  it('reports a tool error back to the model instead of throwing', async () => {
    const openai = buildMockOpenAi([
      toolCallResponse('get_document', { documentId: 'missing' }),
      finalResponse('Không tìm thấy văn bản.'),
    ]);
    const getById = jest.fn<(documentId: string) => Promise<LawDocument>>();
    getById.mockRejectedValue(new Error('404 not found'));
    const lawApi = { getById } as unknown as LawApiClient;
    const service = new AgentService(asOpenAi(openai), 'test-model', lawApi);

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
});
