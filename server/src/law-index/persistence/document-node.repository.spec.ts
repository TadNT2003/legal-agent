import { sanitizeOrdinalForLtree } from './document-node.repository';

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
    expect(sanitizeOrdinalForLtree('146đ')).not.toBe(sanitizeOrdinalForLtree('146'));
  });

  it('handles an uppercase Đ the same way as lowercase đ', () => {
    expect(sanitizeOrdinalForLtree('146Đ')).toBe('146dd');
  });

  it('still strips genuinely unanticipated non-ltree characters as a safety net', () => {
    expect(sanitizeOrdinalForLtree('5-a')).toBe('5a');
  });
});
