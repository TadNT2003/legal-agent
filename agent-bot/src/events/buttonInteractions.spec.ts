import { describe, expect, it } from '@jest/globals';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { extractCitations } from './buttonInteractions.js';

describe('extractCitations', () => {
  it('extracts title and citation from JSON tool messages', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'hỏi gì đó' },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: JSON.stringify({
          documents: [
            { title: 'Bộ luật Dân sự 2015', citation: 'Số 91/2015/QH13' },
            { title: 'Luật Hôn nhân và Gia đình 2014', citation: 'Số 52/2014/QH13' },
          ],
        }),
      },
    ];

    const citations = extractCitations(messages);
    expect(citations).toEqual([
      'Bộ luật Dân sự 2015 — Số 91/2015/QH13',
      'Luật Hôn nhân và Gia đình 2014 — Số 52/2014/QH13',
    ]);
  });

  it('supports the results key and Vietnamese field names', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: JSON.stringify({
          results: [
            { tieuDe: 'Nghị định 123/2020/NĐ-CP', soHieu: '123/2020/NĐ-CP' },
          ],
        }),
      },
    ];

    const citations = extractCitations(messages);
    expect(citations).toEqual(['Nghị định 123/2020/NĐ-CP — 123/2020/NĐ-CP']);
  });

  it('supports the items[] shape the real search_documents tool returns (with sourceUrl)', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: JSON.stringify({
          total: 2,
          items: [
            {
              documentId: 'd1',
              sourceUrl: 'https://vbpl.vn/doc/1',
              citation: 'Số 91/2015/QH13',
              title: 'Bộ luật Dân sự 2015',
            },
          ],
        }),
      },
    ];

    // extractCitations renders "title — citation" and drops the link, but the
    // key point is it no longer silently extracts nothing from the real shape.
    expect(extractCitations(messages)).toEqual([
      'Bộ luật Dân sự 2015 — Số 91/2015/QH13',
    ]);
  });

  it('omits the title part when a document has no title', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: JSON.stringify({
          documents: [{ citation: 'Số 1/2020/VBHN' }],
        }),
      },
    ];

    const citations = extractCitations(messages);
    expect(citations).toEqual(['Số 1/2020/VBHN']);
  });

  it('deduplicates repeated entries across tool messages', () => {
    const payload = JSON.stringify({
      documents: [{ title: 'Luật Đất đai 2024', citation: 'Số 31/2024/QH15' }],
    });
    const messages: ChatCompletionMessageParam[] = [
      { role: 'tool', tool_call_id: 'call_1', content: payload },
      { role: 'tool', tool_call_id: 'call_2', content: payload },
    ];

    const citations = extractCitations(messages);
    expect(citations).toEqual(['Luật Đất đai 2024 — Số 31/2024/QH15']);
  });

  it('ignores non-tool messages and empty document lists', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'Bộ luật Dân sự' },
      { role: 'assistant', content: 'Bộ luật Dân sự được ban hành năm 2015.' },
      { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify({ documents: [] }) },
    ];

    expect(extractCitations(messages)).toEqual([]);
  });

  it('includes short non-JSON tool content verbatim as a fallback', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'tool', tool_call_id: 'call_1', content: 'Không tìm thấy văn bản phù hợp.' },
    ];

    expect(extractCitations(messages)).toEqual(['Không tìm thấy văn bản phù hợp.']);
  });

  it('skips long non-JSON tool content', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'tool', tool_call_id: 'call_1', content: 'x'.repeat(600) },
    ];

    expect(extractCitations(messages)).toEqual([]);
  });
});