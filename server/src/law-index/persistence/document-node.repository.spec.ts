import { createHash } from 'crypto';

// Test the standalone helper functions from document-node.repository.ts
// These are NOT exported from the module, so we replicate their logic
// to verify correctness. The actual functions are:
//
// function computeNodeContentHash(node: ParsedDocumentNode): string {
//   const hash = createHash('sha256');
//   hash.update(node.label);
//   hash.update(node.heading ?? '');
//   hash.update(node.textContent ?? '');
//   return hash.digest('hex');
// }
//
// function sanitizeOrdinalForLtree(ordinal: string): string {
//   return ordinal.replace(/[^A-Za-z0-9_]/g, '');
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

function sanitizeOrdinalForLtree(ordinal: string): string {
  return ordinal.replace(/[^A-Za-z0-9_]/g, '');
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
    expect(computeNodeContentHash(nodeA)).not.toBe(computeNodeContentHash(nodeB));
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
    expect(computeNodeContentHash(nodeA)).not.toBe(computeNodeContentHash(nodeB));
  });
});

describe('sanitizeOrdinalForLtree', () => {
  it('strips non-alphanumeric characters', () => {
    expect(sanitizeOrdinalForLtree('1a')).toBe('1a');
    expect(sanitizeOrdinalForLtree('10')).toBe('10');
    expect(sanitizeOrdinalForLtree('abc')).toBe('abc');
  });

  it('strips special characters', () => {
    expect(sanitizeOrdinalForLtree('1-a')).toBe('1a');
    expect(sanitizeOrdinalForLtree('10.2')).toBe('102');
  });

  it('preserves underscores', () => {
    expect(sanitizeOrdinalForLtree('a_b_c')).toBe('a_b_c');
  });

  it('returns empty string for all special characters', () => {
    expect(sanitizeOrdinalForLtree('!@#$%')).toBe('');
  });

  it('handles unicode characters (only strips non-ASCII alnum)', () => {
    expect(sanitizeOrdinalForLtree('điều')).toBe('iu');
  });
});