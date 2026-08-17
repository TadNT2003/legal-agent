import { describe, expect, it } from '@jest/globals';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { extractSources, sourcesToCitationLines } from './sourceExtraction.js';

describe('extractSources', () => {
  it('extracts title, citation, and sourceUrl from the real search_documents items[] shape', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'điều gì về lao động?' },
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
            {
              documentId: 'd2',
              sourceUrl: 'https://vbpl.vn/doc/2',
              citation: 'Số 52/2014/QH13',
              title: 'Luật Hôn nhân và Gia đình 2014',
            },
          ],
        }),
      },
    ];

    expect(extractSources(messages)).toEqual([
      {
        title: 'Bộ luật Dân sự 2015',
        citation: 'Số 91/2015/QH13',
        sourceUrl: 'https://vbpl.vn/doc/1',
      },
      {
        title: 'Luật Hôn nhân và Gia đình 2014',
        citation: 'Số 52/2014/QH13',
        sourceUrl: 'https://vbpl.vn/doc/2',
      },
    ]);
  });

  it('still supports the documents[] and results[] fallback keys', () => {
    const docs: ChatCompletionMessageParam[] = [
      {
        role: 'tool',
        tool_call_id: 'c1',
        content: JSON.stringify({ documents: [{ title: 'A', citation: 'a-1' }] }),
      },
      {
        role: 'tool',
        tool_call_id: 'c2',
        content: JSON.stringify({ results: [{ title: 'B', citation: 'b-1' }] }),
      },
    ];

    expect(extractSources(docs)).toEqual([
      { title: 'A', citation: 'a-1' },
      { title: 'B', citation: 'b-1' },
    ]);
  });

  it('omits sourceUrl from the returned object when the document has no link', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'tool',
        tool_call_id: 'c1',
        content: JSON.stringify({ items: [{ title: 'No link', citation: 'x-1' }] }),
      },
    ];

    const [src] = extractSources(messages);
    expect(src).toEqual({ title: 'No link', citation: 'x-1' });
    expect(src).not.toHaveProperty('sourceUrl');
  });

  it('deduplicates the same document appearing in multiple tool rounds (by citation+link)', () => {
    const payload = JSON.stringify({
      items: [{ sourceUrl: 'https://vbpl.vn/x', citation: '31/2024', title: 'Luật Đất đai 2024' }],
    });
    const messages: ChatCompletionMessageParam[] = [
      { role: 'tool', tool_call_id: 'c1', content: payload },
      { role: 'tool', tool_call_id: 'c2', content: payload },
    ];

    expect(extractSources(messages)).toEqual([
      {
        title: 'Luật Đất đai 2024',
        citation: '31/2024',
        sourceUrl: 'https://vbpl.vn/x',
      },
    ]);
  });

  it('keeps documents that share a citation but differ only by link separate', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'tool',
        tool_call_id: 'c1',
        content: JSON.stringify({
          items: [
            { citation: '1/2020', title: 'Tờ A', sourceUrl: 'https://vbpl.vn/a' },
            { citation: '1/2020', title: 'Tờ B', sourceUrl: 'https://vbpl.vn/b' },
          ],
        }),
      },
    ];

    expect(extractSources(messages)).toHaveLength(2);
  });

  it('skips items with neither title nor citation', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'tool',
        tool_call_id: 'c1',
        content: JSON.stringify({ items: [{ documentId: 'd', sourceUrl: 'https://x' }] }),
      },
    ];

    expect(extractSources(messages)).toEqual([]);
  });

  it('ignores non-tool messages and non-JSON tool content', () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'assistant', content: 'Bộ luật Dân sự được ban hành 2015.' },
      { role: 'user', content: 'Bộ luật Dân sự' },
      { role: 'tool', tool_call_id: 'c1', content: 'Không tìm thấy văn bản phù hợp.' },
      { role: 'tool', tool_call_id: 'c2', content: JSON.stringify({ total: 0, items: [] }) },
    ];

    expect(extractSources(messages)).toEqual([]);
  });

  it('handles empty messages and tool messages with null content', () => {
    expect(extractSources([])).toEqual([]);
    // A tool message whose content is not a string (null) must be skipped,
    // not crash — the null-cast mirrors a defensively-typed edge case.
    const messages: ChatCompletionMessageParam[] = [
      { role: 'tool', tool_call_id: 'c1', content: null as unknown as string },
    ];
    expect(extractSources(messages)).toEqual([]);
  });

  it('supports the Vietnamese tieuDe/soHieu field aliases', () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'tool',
        tool_call_id: 'c1',
        content: JSON.stringify({
          documents: [{ tieuDe: 'Nghị định 123/2020/NĐ-CP', soHieu: '123/2020/NĐ-CP' }],
        }),
      },
    ];

    expect(extractSources(messages)).toEqual([
      { title: 'Nghị định 123/2020/NĐ-CP', citation: '123/2020/NĐ-CP' },
    ]);
  });
});

describe('sourcesToCitationLines', () => {
  it('renders "title — citation" lines and drops links', () => {
    const lines = sourcesToCitationLines([
      { title: 'Luật A', citation: 'a-1', sourceUrl: 'https://x/a' },
      { title: '', citation: 'b-2' },
    ]);
    expect(lines).toEqual(['Luật A — a-1', 'b-2']);
  });

  it('renders a placeholder for an empty citation', () => {
    const lines = sourcesToCitationLines([{ title: 'Chỉ có tiêu đề', citation: '' }]);
    expect(lines).toEqual(['Chỉ có tiêu đề — (không có trích dẫn)']);
  });
});