import type OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import type { LawApiClient } from '../lawApi/client.js';
import { createLogger } from '../tools/logging.js';
import { AGENT_TOOLS, dispatchToolCall } from './tools.js';

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
 * provider-specific.
 */
const REASONING_EFFORT_NONE = 'none' as unknown as NonNullable<
  ChatCompletionCreateParamsNonStreaming['reasoning_effort']
>;

const SYSTEM_PROMPT = `Bạn là trợ lý tra cứu văn bản pháp luật Việt Nam.

Quy trình bắt buộc, theo đúng thứ tự:
1. Gọi search_documents để tìm văn bản ứng viên. Công cụ này CHỈ trả về metadata (tiêu đề, số hiệu, ngày), KHÔNG có nội dung điều luật.
2. Ngay khi có một documentId phù hợp, PHẢI gọi get_document_nodes với documentId đó để lấy nội dung thật (dùng nodeType="dieu" + number nếu người dùng hỏi về một Điều cụ thể). KHÔNG được lặp lại search_documents nhiều lần với các từ khóa khác nhau khi đã có ứng viên hợp lý — hãy thử lấy nội dung của ứng viên tốt nhất trước.
3. Chỉ trả lời sau khi đã đọc được nội dung thật từ get_document_nodes.

Quy tắc bắt buộc:
- Chỉ trả lời dựa trên kết quả từ các công cụ (tools) được cung cấp. Không tự bịa nội dung điều luật.
- Luôn trích dẫn số hiệu văn bản (citationId) và Điều/Khoản/Điểm cụ thể khi trả lời.
- Ưu tiên văn bản "Còn hiệu lực" trừ khi người dùng hỏi rõ về văn bản lịch sử/đã hết hiệu lực.
- Nếu không tìm thấy thông tin phù hợp qua các công cụ, nói rõ là không tìm thấy thay vì đoán.
- Đây không phải là tư vấn pháp lý chính thức — nhắc người dùng tham khảo luật sư cho các quyết định quan trọng.`;

export class AgentService {
  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
    private readonly lawApi: LawApiClient,
  ) {}

  async chat(userMessage: string): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        tools: AGENT_TOOLS,
        reasoning_effort: REASONING_EFFORT_NONE,
      });

      const choice = response.choices[0];
      const message = choice.message;
      messages.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        logger.log(
          `Round ${round}: final answer (${(message.content ?? '').length} chars)`,
        );
        return message.content ?? '';
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
    return 'Xin lỗi, tôi chưa thể hoàn thành câu trả lời sau nhiều bước tra cứu. Vui lòng thử hỏi cụ thể hơn.';
  }

  private async runTool(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
  ): Promise<ChatCompletionToolMessageParam> {
    const { name, arguments: rawArgs } = toolCall.function;
    try {
      const result = await dispatchToolCall(this.lawApi, name, rawArgs);
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
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
