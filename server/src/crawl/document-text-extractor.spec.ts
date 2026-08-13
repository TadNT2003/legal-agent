import { NullDocumentTextExtractor } from './document-text-extractor';

describe('NullDocumentTextExtractor', () => {
  it('always resolves to null fullText/extractionMethod, regardless of input', async () => {
    const extractor = new NullDocumentTextExtractor();

    await expect(extractor.extractText([])).resolves.toEqual({
      fullText: null,
      extractionMethod: null,
    });
    await expect(
      extractor.extractText(['https://cdn.chinhphu.vn/files/a.pdf']),
    ).resolves.toEqual({ fullText: null, extractionMethod: null });
  });
});
