import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import { callMcpTool } from '../mcp/tools.js';
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

export class AgentService {
  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
    private readonly mcpClient: Client,
    private readonly tools: OpenAI.Chat.Completions.ChatCompletionTool[],
    private readonly systemPrompt: string,
  ) {}

  /**
   * `history` is the prior conversation's accumulated messages (empty for a
   * fresh session) — the system prompt is seeded only when history is empty,
   * since it's already present at the start of any non-empty history.
   */
  async chat(
    history: ChatCompletionMessageParam[],
    userMessage: string,
  ): Promise<ChatResult> {
    const messages: ChatCompletionMessageParam[] =
      history.length > 0
        ? [...history, { role: 'user', content: userMessage }]
        : [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: userMessage },
          ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
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
        return { reply: message.content ?? '', messages };
      }

      logger.log(
        `Round ${round}: ${message.tool_calls.length} tool call(s) -> ${message.tool_calls
          .map((tc) => (tc.type === 'function' ? tc.function.name : tc.type))
          .join(', ')}`,
      );

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== 'function') continue;
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

  private async runTool(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  ): Promise<ChatCompletionToolMessageParam> {
    const { name, arguments: rawArgs } = toolCall.function;
    try {
      const content = await callMcpTool(this.mcpClient, name, rawArgs);
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
