import { describe, expect, it, jest } from '@jest/globals';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type { McpToolCaller, StreamEvent } from './agentService.js';
import { AgentService } from './agentService.js';
import type { ProgressEvent } from './agentService.js';

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
  stream?: boolean;
}

type CreateMock = jest.Mock<
  (args: CreateCallArgs) => Promise<MockChatCompletion>
>;

type CreateMockAny = jest.Mock<
  (args: CreateCallArgs) => Promise<unknown>
>;

interface MockOpenAi {
  chat: {
    completions: {
      create: CreateMock | CreateMockAny;
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

function buildMockToolCaller(): jest.MockedFunction<McpToolCaller> {
  return jest.fn();
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
const NO_HISTORY: ChatCompletionMessageParam[] = [];
const MAX_TOOL_ROUNDS_MINUS_ONE = 4;

describe('AgentService', () => {
  it('seeds the system prompt on a fresh (empty-history) call', async () => {
    const openai = buildMockOpenAi([finalResponse('Xin chào')]);
    const callTool = buildMockToolCaller();
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chat(NO_HISTORY, 'hi');

    expect(result.reply).toBe('Xin chào');
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
    const callArgs = openai.chat.completions.create.mock.calls[0][0];
    expect(callArgs.messages[0]).toEqual({
      role: 'system',
      content: SYSTEM_PROMPT,
    });
    expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('continues a session: appends to prior history instead of reseeding the system prompt', async () => {
    // messages is the same mutable array for the whole chat() call — a plain
    // mock.calls[0][0] capture would alias it and see later pushes too, so
    // snapshot a shallow copy at call time instead.
    let seenMessages: CreateCallArgs['messages'] = [];
    const create: CreateMock = jest.fn<
      (args: CreateCallArgs) => Promise<MockChatCompletion>
    >();
    create.mockImplementationOnce((args) => {
      seenMessages = [...args.messages];
      return Promise.resolve(finalResponse('Điều 6 nói về ...'));
    });
    const openai: MockOpenAi = { chat: { completions: { create } } };
    const callTool = buildMockToolCaller();
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );
    const priorHistory: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'Điều 5 nói gì?' },
      { role: 'assistant', content: 'Điều 5 nói về vốn điều lệ.' },
    ];

    const result = await service.chat(priorHistory, 'Còn Điều 6?');

    expect(seenMessages).toEqual([
      ...priorHistory,
      { role: 'user', content: 'Còn Điều 6?' },
    ]);
    // Returned messages accumulate on top of the prior history, ready to
    // pass into the next chat() call for this session.
    expect(result.messages).toEqual([
      ...priorHistory,
      { role: 'user', content: 'Còn Điều 6?' },
      { role: 'assistant', content: 'Điều 6 nói về ...' },
    ]);
  });

  it('executes a tool call via MCP, feeds the result back, and returns the follow-up answer', async () => {
    const openai = buildMockOpenAi([
      toolCallResponse('get_document', { documentId: 'doc-1' }),
      finalResponse('Điều 5 nói về vốn điều lệ, theo 59/2020/QH14.'),
    ]);
    const callTool = buildMockToolCaller();
    callTool.mockResolvedValue(
      textResult({ id: 'doc-1', citationId: '59/2020/QH14' }),
    );
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chat(NO_HISTORY, 'what does doc-1 say?');

    expect(callTool).toHaveBeenCalledWith('get_document', { documentId: 'doc-1' });
    expect(result.reply).toBe('Điều 5 nói về vốn điều lệ, theo 59/2020/QH14.');
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
    const callTool = buildMockToolCaller();
    callTool.mockResolvedValue(textResult({ id: 'doc-1' }));
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chat(NO_HISTORY, 'loop forever');

    expect(result.reply).toContain('Xin lỗi');
  });

  it('reports an MCP tool error back to the model instead of throwing', async () => {
    const openai = buildMockOpenAi([
      toolCallResponse('get_document', { documentId: 'missing' }),
      finalResponse('Không tìm thấy văn bản.'),
    ]);
    const callTool = buildMockToolCaller();
    callTool.mockRejectedValue(new Error('404 not found'));
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chat(NO_HISTORY, 'what does missing say?');

    expect(result.reply).toBe('Không tìm thấy văn bản.');
    const secondCallArgs = openai.chat.completions.create.mock.calls[1][0];
    const toolMessage = secondCallArgs.messages.find(
      (m) => m.role === 'tool',
    );
    const parsed = JSON.parse(toolMessage?.content ?? '{}') as {
      error: string;
    };
    expect(parsed.error).toContain('404 not found');
  });

  it('invokes the onProgress callback at each phase of the tool-calling loop', async () => {
    const events: ProgressEvent[] = [];
    const onProgress = (event: ProgressEvent) => events.push(event);

    const openai = buildMockOpenAi([
      toolCallResponse('search_documents', { keyword: 'test' }),
      finalResponse('Found document.'),
    ]);
    const callTool = buildMockToolCaller();
    callTool.mockResolvedValue(textResult({ id: 'doc-1' }));
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chat(NO_HISTORY, 'search test', onProgress);

    expect(result.reply).toBe('Found document.');
    expect(events).toEqual([
      { phase: 'round_start', round: 0 },
      { phase: 'tool_call', round: 0, toolName: 'search_documents' },
      { phase: 'round_start', round: 1 },
      { phase: 'final_answer' },
    ]);
  });

  it('reports an MCP-level tool error (isError) back to the model instead of throwing', async () => {
    const openai = buildMockOpenAi([
      toolCallResponse('get_document', { documentId: 'missing' }),
      finalResponse('Không tìm thấy văn bản.'),
    ]);
    const callTool = buildMockToolCaller();
    callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Document not found' }],
      isError: true,
    });
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chat(NO_HISTORY, 'what does missing say?');

    expect(result.reply).toBe('Không tìm thấy văn bản.');
    const secondCallArgs = openai.chat.completions.create.mock.calls[1][0];
    const toolMessage = secondCallArgs.messages.find(
      (m) => m.role === 'tool',
    );
    const parsed = JSON.parse(toolMessage?.content ?? '{}') as {
      error: string;
    };
    expect(parsed.error).toContain('Document not found');
  });

  it('chatStream: streams token deltas through tool rounds to final answer', async () => {
    const events: StreamEvent[] = [];
    const onStream = (event: StreamEvent) => events.push(event);

    const toolCall = toolCallResponse('search_documents', { keyword: 'test' });

    const finalStream = makeStreamResponse(['Điều ', '5 ', 'nói ', 'về ', 'vốn ', 'điều ', 'lệ.']);

    const create: CreateMockAny = jest.fn();
    create.mockResolvedValueOnce(toolCall);
    for (let i = 1; i < MAX_TOOL_ROUNDS_MINUS_ONE; i++) {
      create.mockResolvedValueOnce(toolCall);
    }
    create.mockResolvedValueOnce(finalStream);
    const openai: MockOpenAi = { chat: { completions: { create } } };
    const callTool = buildMockToolCaller();
    callTool.mockResolvedValue(textResult({ id: 'doc-1' }));
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chatStream(NO_HISTORY, 'search', onStream);

    expect(result.reply).toBe('Điều 5 nói về vốn điều lệ.');
    const tokenEvents = events.filter((e) => e.type === 'token');
    expect(tokenEvents).toHaveLength(7);
    expect(tokenEvents[0]).toEqual({ type: 'token', text: 'Điều ' });
    expect(tokenEvents[6]).toEqual({ type: 'token', text: 'lệ.' });
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeTruthy();
    expect(doneEvent).toHaveProperty('reply', 'Điều 5 nói về vốn điều lệ.');
  });

  it('chatStream: executes tool rounds non-streaming and streams only final answer', async () => {
    const events: StreamEvent[] = [];
    const onStream = (event: StreamEvent) => events.push(event);

    const finalStream = makeStreamResponse(['Kết quả: ', 'tìm thấy ', '3 ', 'văn bản.']);

    const create: CreateMockAny = jest.fn();
    const toolResp = toolCallResponse('search_documents', { keyword: 'test' });
    for (let i = 0; i < MAX_TOOL_ROUNDS_MINUS_ONE; i++) {
      create.mockResolvedValueOnce(toolResp);
    }
    create.mockResolvedValueOnce(finalStream);
    const openai: MockOpenAi = { chat: { completions: { create } } };
    const callTool = buildMockToolCaller();
    callTool.mockResolvedValue(textResult({ id: 'doc-1' }));
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chatStream(NO_HISTORY, 'search test', onStream);

    expect(result.reply).toBe('Kết quả: tìm thấy 3 văn bản.');
    expect(create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS_MINUS_ONE + 1);
    const firstCall = create.mock.calls[0][0];
    expect(firstCall.stream).toBeUndefined();
    const lastCall = create.mock.calls[MAX_TOOL_ROUNDS_MINUS_ONE][0];
    expect(lastCall.stream).toBe(true);
    expect(events).toContainEqual({ type: 'round_start', round: 0 });
    expect(events).toContainEqual({ type: 'tool', round: 0, toolName: 'search_documents' });
    const tokenEvents = events.filter((e) => e.type === 'token');
    expect(tokenEvents).toHaveLength(4);
  });

  it('chatStream: returns non-streaming answer immediately when model responds without tool calls', async () => {
    const events: StreamEvent[] = [];
    const onStream = (event: StreamEvent) => events.push(event);

    const create: CreateMockAny = jest.fn();
    create.mockResolvedValueOnce(finalResponse('Direct answer.'));
    const openai: MockOpenAi = { chat: { completions: { create } } };
    const callTool = buildMockToolCaller();
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chatStream(NO_HISTORY, 'quick', onStream);

    expect(result.reply).toBe('Direct answer.');
    expect(events).toContainEqual({ type: 'round_start', round: 0 });
    expect(events).toContainEqual({ type: 'done', reply: 'Direct answer.', messages: expect.any(Array) });
  });

  it('chatStream: falls back to streaming final answer on last round', async () => {
    const events: StreamEvent[] = [];
    const onStream = (event: StreamEvent) => events.push(event);

    const infiniteToolCall = toolCallResponse('get_document', { documentId: 'doc-1' });

    const fallbackStream = makeStreamResponse(['Xin lỗi.']);

    const create: CreateMockAny = jest.fn();
    for (let i = 0; i < MAX_TOOL_ROUNDS_MINUS_ONE; i++) {
      create.mockResolvedValueOnce(infiniteToolCall);
    }
    create.mockResolvedValueOnce(fallbackStream);
    const openai: MockOpenAi = { chat: { completions: { create } } };
    const callTool = buildMockToolCaller();
    callTool.mockResolvedValue(textResult({ id: 'doc-1' }));
    const service = new AgentService(
      asOpenAi(openai),
      'test-model',
      callTool,
      NO_TOOLS,
      SYSTEM_PROMPT,
    );

    const result = await service.chatStream(NO_HISTORY, 'loop forever', onStream);

    expect(result.reply).toBe('Xin lỗi.');
    const roundStarts = events.filter((e) => e.type === 'round_start');
    expect(roundStarts).toHaveLength(MAX_TOOL_ROUNDS_MINUS_ONE + 1);
  });
});

function makeStreamResponse(tokens: string[]): AsyncIterable<ChatCompletionChunk> {
  const chunks: ChatCompletionChunk[] = [];
  for (const token of tokens) {
    chunks.push({
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'test-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant' as const,
            content: token,
          },
          finish_reason: null,
        },
      ],
    });
  }
  chunks.push({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1234567890,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
  });

  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        await Promise.resolve();
        yield chunk;
      }
    },
  };
}
