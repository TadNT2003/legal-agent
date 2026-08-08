import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * The reusable "recipe" discovered empirically while building agent-bot
 * (see docs/plan/agent-bot-plan.md's postmortem) — published as a first-class
 * MCP primitive so any consuming client can pull it in directly, instead of
 * every new agent rediscovering it by trial and error. This is guidance a
 * client *chooses* to use, not something the tools enforce server-side —
 * the actual enforcement (validity defaults, outline-vs-full-text bounding)
 * lives in the tools themselves.
 */
const GUIDANCE_TEXT = `Khi tra cứu văn bản pháp luật Việt Nam bằng các công cụ này, làm theo thứ tự sau:

1. Gọi search_documents để tìm văn bản ứng viên. Công cụ này CHỈ trả về metadata (tiêu đề, số hiệu, ngày), KHÔNG có nội dung điều luật.
2. Ngay khi có một documentId phù hợp, gọi get_document_nodes với documentId đó để lấy nội dung thật (dùng nodeType="dieu" + number nếu hỏi về một Điều cụ thể). Đừng lặp lại search_documents nhiều lần với các từ khóa khác nhau khi đã có ứng viên hợp lý — hãy thử lấy nội dung của ứng viên tốt nhất trước.
3. Nếu cần biết văn bản còn hiệu lực hay đã bị sửa đổi/bãi bỏ, gọi get_references (direction="incoming") để xem văn bản nào đã tác động đến nó.
4. Chỉ trả lời sau khi đã đọc được nội dung thật từ get_document_nodes. Luôn trích dẫn số hiệu văn bản (citationId) và Điều/Khoản/Điểm cụ thể.
5. Ưu tiên văn bản còn hiệu lực (mặc định của search_documents) trừ khi được hỏi rõ về văn bản lịch sử/đã hết hiệu lực.
6. Nếu không tìm thấy thông tin phù hợp, nói rõ là không tìm thấy thay vì đoán — đây không phải là tư vấn pháp lý chính thức.`;

export function registerLegalLookupGuidance(server: McpServer): void {
  server.registerPrompt(
    'legal_lookup_guidance',
    {
      title: 'Legal document lookup workflow',
      description:
        'Recommended workflow for answering Vietnamese legal questions with this server\'s tools: ' +
        'search first, then fetch real article text before answering, check amendment/repeal status, ' +
        'always cite precisely.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: GUIDANCE_TEXT },
        },
      ],
    }),
  );
}
