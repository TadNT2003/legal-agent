import type OpenAI from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '../tools/logging.js';

const MAX_TOOL_ROUNDS = 5;
const logger = createLogger('agent-service');

/**
 * "none" isn't in the openai SDK's official `ReasoningEffort` union
 * ('low'|'medium'|'high'|null) — it's specific to this Bifrost/vLLM/Qwen
 * deployment, and empirically the only value that actually disables its
 * hidden reasoning. `chat_template_kwargs.enable_thinking: false` (the
 * documented Qwen mechanism) is silently ignored here; DeepSeek-style
 * `{ thinking: { type: "disabled" } }` isn't honored either. Small/weak
 * models spend disproportionate time+tokens on hidden reasoning with
 * degraded results, so this is worth keeping even if the model changes —
 * just re-verify empirically per-provider, since the disable mechanism is
 * provider-specific. Model-specific tuning like this stays here in the
 * consuming agent, not in the legal-mcp harness — see
 * docs/plan/legal-mcp-plan.md's Context section for why.
 */
const REASONING_EFFORT_NONE = 'none' as unknown as NonNullable<
  ChatCompletionCreateParamsNonStreaming['reasoning_effort']
>;

export interface ChatResult {
  reply: string;
  /** Full accumulated history, including this turn — pass back into the next chat() call to continue the conversation. */
  messages: ChatCompletionMessageParam[];
}

export type ProgressPhase = 'round_start' | 'tool_call' | 'final_answer';

export interface ProgressEvent {
  phase: ProgressPhase;
  round?: number;
  toolName?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export interface StreamTokenEvent {
  type: 'token';
  text: string;
}

export interface StreamToolEvent {
  type: 'tool';
  round: number;
  toolName: string;
}

export interface StreamRoundStartEvent {
  type: 'round_start';
  round: number;
}

export interface StreamDoneEvent {
  type: 'done';
  reply: string;
  messages: ChatCompletionMessageParam[];
}

export type StreamEvent =
  | StreamTokenEvent
  | StreamToolEvent
  | StreamRoundStartEvent
  | StreamDoneEvent;

export type StreamCallback = (event: StreamEvent) => void;

/**
 * Async function that calls an MCP tool by name and arguments.
 * This abstraction allows the AgentService to work with both the raw
 * MCP Client and the ReconnectingMcpClient wrapper.
 */
export type McpToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<CallToolResult>;

export class AgentService {
  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
    private readonly callTool: McpToolCaller,
    private readonly tools: OpenAI.Chat.Completions.ChatCompletionTool[],
    private readonly systemPrompt: string,
  ) {}

  /**
   * `history` is the prior conversation's accumulated messages (empty for a
   * fresh session) — the system prompt is seeded only when history is empty,
   * since it's already present at the start of any non-empty history.
   *
   * `onProgress` is an optional callback invoked at key points in the
   * tool-calling loop (round start, tool call, final answer). Useful for
   * driving persistent typing indicators or progress displays.
   */
  async chat(
    history: ChatCompletionMessageParam[],
    userMessage: string,
    onProgress?: ProgressCallback,
  ): Promise<ChatResult> {
    const messages: ChatCompletionMessageParam[] =
      history.length > 0
        ? [...history, { role: 'user', content: userMessage }]
        : [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: userMessage },
          ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      onProgress?.({ phase: 'round_start', round });
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        tools: this.tools,
        reasoning_effort: REASONING_EFFORT_NONE,
      });

      const choice = response.choices[0];
      const message = choice.message;
      messages.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        logger.log(
          `Round ${round}: final answer (${(message.content ?? '').length} chars)`,
        );
        onProgress?.({ phase: 'final_answer' });
        return { reply: message.content ?? '', messages };
      }

      logger.log(
        `Round ${round}: ${message.tool_calls.length} tool call(s) -> ${message.tool_calls
          .map((tc) => (tc.type === 'function' ? tc.function.name : tc.type))
          .join(', ')}`,
      );

for (const toolCall of message.tool_calls) {
          if (toolCall.type !== 'function') continue;
          onProgress?.({ phase: 'tool_call', round, toolName: toolCall.function.name });
          logger.log(
            `  ${toolCall.function.name}(${toolCall.function.arguments})`,
          );
          const toolMessage = await this.runTool(toolCall);
          const preview =
            typeof toolMessage.content === 'string'
              ? toolMessage.content
              : JSON.stringify(toolMessage.content);
          logger.log(`  -> ${preview.slice(0, 300)}`);
          messages.push(toolMessage);
        }
    }

    logger.log(
      `Tool-calling loop hit MAX_TOOL_ROUNDS (${MAX_TOOL_ROUNDS}) without a final answer`,
    );
    return {
      reply:
        'Xin lỗi, tôi chưa thể hoàn thành câu trả lời sau nhiều bước tra cứu. Vui lòng thử hỏi cụ thể hơn.',
      messages,
    };
  }

  /**
   * Streaming variant of {@link chat}. Tool-calling rounds execute normally
   * (non-streaming), but the final answer round uses the OpenAI streaming
   * API. Token deltas are emitted via `onStream` as `StreamTokenEvent`
   * events, and intermediate progress as `StreamToolEvent` /
   * `StreamRoundStartEvent`. A `StreamDoneEvent` with the accumulated reply
   * and messages is emitted when the stream completes.
   *
   * The returned `ChatResult` is identical to what `chat()` would return, so
   * callers can still persist the full message history.
   */
  async chatStream(
    history: ChatCompletionMessageParam[],
    userMessage: string,
    onStream: StreamCallback,
  ): Promise<ChatResult> {
    const messages: ChatCompletionMessageParam[] =
      history.length > 0
        ? [...history, { role: 'user', content: userMessage }]
        : [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: userMessage },
          ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      onStream({ type: 'round_start', round });

      if (round === MAX_TOOL_ROUNDS - 1) {
        return await this.finalAnswerStream(messages, onStream);
      }

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        tools: this.tools,
        reasoning_effort: REASONING_EFFORT_NONE,
      });

      const choice = response.choices[0];
      const message = choice.message;
      messages.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        logger.log(
          `Round ${round}: final answer (${(message.content ?? '').length} chars)`,
        );
        const reply = message.content ?? '';
        onStream({ type: 'done', reply, messages });
        return { reply, messages };
      }

      logger.log(
        `Round ${round}: ${message.tool_calls.length} tool call(s) -> ${message.tool_calls
          .map((tc) => (tc.type === 'function' ? tc.function.name : tc.type))
          .join(', ')}`,
      );

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== 'function') continue;
        onStream({ type: 'tool', round, toolName: toolCall.function.name });
        logger.log(
          `  ${toolCall.function.name}(${toolCall.function.arguments})`,
        );
        const toolMessage = await this.runTool(toolCall);
        const preview =
          typeof toolMessage.content === 'string'
            ? toolMessage.content
            : JSON.stringify(toolMessage.content);
        logger.log(`  -> ${preview.slice(0, 300)}`);
        messages.push(toolMessage);
      }
    }

    const fallbackReply =
      'Xin lỗi, tôi chưa thể hoàn thành câu trả lời sau nhiều bước tra cứu. Vui lòng thử hỏi cụ thể hơn.';
    onStream({ type: 'done', reply: fallbackReply, messages });
    return { reply: fallbackReply, messages };
  }

  private async finalAnswerStream(
    messages: ChatCompletionMessageParam[],
    onStream: StreamCallback,
  ): Promise<ChatResult> {
    const stream = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      tools: this.tools,
      reasoning_effort: REASONING_EFFORT_NONE,
      stream: true,
    });

    let reply = '';
    let toolCalls: OpenAI.ChatCompletionAssistantMessageParam['tool_calls'] =
      undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            if (!toolCalls) toolCalls = [];
            const existing = toolCalls.find(
              (t) => t.id === tc.id,
            );
            if (existing && existing.type === 'function') {
              existing.function.name += tc.function.name;
            } else {
              toolCalls.push({
                id: tc.id || '',
                type: 'function',
                function: { name: tc.function.name, arguments: '' },
              });
            }
          }
          if (tc.function?.arguments) {
            if (!toolCalls) toolCalls = [];
            const existing = toolCalls?.find((t) => t.id === tc.id);
            if (existing && existing.type === 'function') {
              existing.function.arguments += tc.function.arguments;
            }
          }
        }
      }

      if (delta.content) {
        reply += delta.content;
        onStream({ type: 'token', text: delta.content });
      }
    }

    const assistantMsg: ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: reply || null,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    };
    messages.push(assistantMsg);

    logger.log(`Streaming final answer (${reply.length} chars)`);
    onStream({ type: 'done', reply, messages });
    return { reply, messages };
  }

  private async runTool(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  ): Promise<ChatCompletionToolMessageParam> {
    const { name, arguments: rawArgs } = toolCall.function;
    try {
      const result = await this.callTool(name, JSON.parse(rawArgs || '{}') as Record<string, unknown>);
      const block = result.content?.[0];
      const content =
        block && block.type === 'text'
          ? block.text
          : JSON.stringify(result);
      if (result.isError) {
        throw new Error(content);
      }
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content,
      };
    } catch (error) {
      logger.error(`Tool call failed: ${name}`, error);
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      };
    }
  }
}
