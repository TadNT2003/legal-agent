/** Strips Vietnamese diacritics (post-NFD combining marks) and folds đ/Đ to d, for matching/slugging. */
export function foldDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd');
}
