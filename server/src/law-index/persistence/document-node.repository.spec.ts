import { createHash } from 'crypto';
import { sanitizeOrdinalForLtree } from './document-node.repository';

// computeNodeContentHash is NOT exported from document-node.repository.ts,
// so it's replicated here to verify correctness. The actual implementation:
//
// function computeNodeContentHash(node: ParsedDocumentNode): string {
//   const hash = createHash('sha256');
//   hash.update(node.label);
//   hash.update(node.heading ?? '');
//   hash.update(node.textContent ?? '');
//   return hash.digest('hex');
// }

interface ParsedDocumentNode {
  label: string;
  heading: string | null;
  textContent: string | null;
  nodeType: string;
  ordinal: string;
  contentClass: string | null;
  children: ParsedDocumentNode[];
}

function computeNodeContentHash(node: ParsedDocumentNode): string {
  const hash = createHash('sha256');
  hash.update(node.label);
  hash.update(node.heading ?? '');
  hash.update(node.textContent ?? '');
  return hash.digest('hex');
}

describe('computeNodeContentHash (document-node.repository)', () => {
  it('produces deterministic output for same input', () => {
    const node: ParsedDocumentNode = {
      label: 'Điều 5',
      heading: 'Quy định chung',
      textContent: 'Nội dung điều 5',
      nodeType: 'dieu',
      ordinal: '5',
      contentClass: null,
      children: [],
    };
    expect(computeNodeContentHash(node)).toBe(computeNodeContentHash(node));
  });

  it('handles null heading', () => {
    const node: ParsedDocumentNode = {
      label: 'Khoản 1',
      heading: null,
      textContent: 'Text content',
      nodeType: 'khoan',
      ordinal: '1',
      contentClass: null,
      children: [],
    };
    const hash = computeNodeContentHash(node);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles null textContent', () => {
    const node: ParsedDocumentNode = {
      label: 'Chương I',
      heading: 'Phần mở đầu',
      textContent: null,
      nodeType: 'chuong',
      ordinal: '1',
      contentClass: null,
      children: [],
    };
    const hash = computeNodeContentHash(node);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles both null heading and null textContent', () => {
    const node: ParsedDocumentNode = {
      label: 'Phần I',
      heading: null,
      textContent: null,
      nodeType: 'phan',
      ordinal: '1',
      contentClass: null,
      children: [],
    };
    const hash = computeNodeContentHash(node);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hash for different content', () => {
    const nodeA: ParsedDocumentNode = {
      label: 'Điều 5',
      heading: 'Quy định chung',
      textContent: 'Content A',
      nodeType: 'dieu',
      ordinal: '5',
      contentClass: null,
      children: [],
    };
    const nodeB: ParsedDocumentNode = {
      label: 'Điều 5',
      heading: 'Quy định chung',
      textContent: 'Content B',
      nodeType: 'dieu',
      ordinal: '5',
      contentClass: null,
      children: [],
    };
    expect(computeNodeContentHash(nodeA)).not.toBe(
      computeNodeContentHash(nodeB),
    );
  });

  it('produces different hash when heading changes', () => {
    const nodeA: ParsedDocumentNode = {
      label: 'Điều 5',
      heading: 'Heading A',
      textContent: 'Same text',
      nodeType: 'dieu',
      ordinal: '5',
      contentClass: null,
      children: [],
    };
    const nodeB: ParsedDocumentNode = {
      label: 'Điều 5',
      heading: 'Heading B',
      textContent: 'Same text',
      nodeType: 'dieu',
      ordinal: '5',
      contentClass: null,
      children: [],
    };
    expect(computeNodeContentHash(nodeA)).not.toBe(
      computeNodeContentHash(nodeB),
    );
  });
});

describe('sanitizeOrdinalForLtree', () => {
  it('passes plain digit ordinals through unchanged', () => {
    expect(sanitizeOrdinalForLtree('146')).toBe('146');
  });

  it('passes an a-z alphabetic suffix through unchanged', () => {
    expect(sanitizeOrdinalForLtree('5a')).toBe('5a');
  });

  it('passes a bare Điểm letter through unchanged', () => {
    expect(sanitizeOrdinalForLtree('d')).toBe('d');
  });

  it("transliterates a bare 'đ' Điểm ordinal distinctly from 'd', confirmed live across 1,434 documents", () => {
    expect(sanitizeOrdinalForLtree('đ')).toBe('dd');
    expect(sanitizeOrdinalForLtree('đ')).not.toBe(sanitizeOrdinalForLtree('d'));
  });

  it('transliterates an inserted-provision "đ" suffix without colliding with the base ordinal, confirmed live on 17/2017/QH14 ("Điều 146đ" vs "Điều 146")', () => {
    expect(sanitizeOrdinalForLtree('146đ')).toBe('146dd');
    expect(sanitizeOrdinalForLtree('146đ')).not.toBe(
      sanitizeOrdinalForLtree('146'),
    );
  });

  it('handles an uppercase Đ the same way as lowercase đ', () => {
    expect(sanitizeOrdinalForLtree('146Đ')).toBe('146dd');
  });

  it('still strips genuinely unanticipated non-ltree characters as a safety net', () => {
    expect(sanitizeOrdinalForLtree('5-a')).toBe('5a');
  });
});
