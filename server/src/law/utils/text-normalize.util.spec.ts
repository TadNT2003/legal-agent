import { foldDiacritics } from './text-normalize.util';

describe('foldDiacritics', () => {
  it('strips Vietnamese diacritics', () => {
    expect(foldDiacritics('Bộ luật Lao động')).toBe('Bo luat Lao dong');
  });

  it('folds đ to d', () => {
    expect(foldDiacritics('đường')).toBe('duong');
  });

  it('folds Đ to d (lowercase)', () => {
    expect(foldDiacritics('Đường')).toBe('duong');
  });

  it('passes through ASCII unchanged', () => {
    expect(foldDiacritics('Hello World 123')).toBe('Hello World 123');
  });

  it('handles empty string', () => {
    expect(foldDiacritics('')).toBe('');
  });

  it('handles mixed diacritical characters', () => {
    expect(foldDiacritics('quy phạm pháp luật')).toBe('quy pham phap luat');
  });

  it('preserves spaces and punctuation', () => {
    expect(foldDiacritics('Điều 4, Luật 64/2025/QH15')).toBe('dieu 4, Luat 64/2025/QH15');
  });
});