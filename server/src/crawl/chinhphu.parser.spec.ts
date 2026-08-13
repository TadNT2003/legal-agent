import type { ParsedLawDocument } from '../download/parsed-law-document.interface';
import type { ExtractedDocumentText } from './document-text-extractor';
import { parseChinhPhuDocument } from './chinhphu.parser';

const makeRaw = (
  overrides?: Partial<ParsedLawDocument>,
): ParsedLawDocument => ({
  citation: '51/2024/QH15',
  title: 'Luật Test',
  date: '18/01/2024',
  docType: 'Luật',
  issuingBody: 'Quốc hội',
  signerName: 'Nguyễn Thị Kim Ngân',
  signerTitle: null,
  sourceUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=219000',
  fileUrls: ['https://cdn.chinhphu.vn/files/51-2024-qh15.pdf'],
  ...overrides,
});

const noText: ExtractedDocumentText = {
  fullText: null,
  extractionMethod: null,
};

describe('parseChinhPhuDocument', () => {
  it('maps a fully-populated raw document into the parsed shape', () => {
    const parsed = parseChinhPhuDocument(makeRaw(), noText);

    expect(parsed.sourceUrl).toBe(
      'https://vanban.chinhphu.vn/?pageid=27160&docid=219000',
    );
    expect(parsed.title).toBe('Luật Test');
    expect(parsed.attributes).toEqual({
      citation: '51/2024/QH15',
      documentType: 'Luật',
      issuingBody: 'Quốc hội',
      issuedDateRaw: '18/01/2024',
      signerName: 'Nguyễn Thị Kim Ngân',
      signerTitle: null,
      industry: null,
      field: null,
      effectiveDateRaw: null,
      expiryDateRaw: null,
      validityStatusRaw: null,
    });
    expect(parsed.fullText).toBeNull();
    expect(parsed.extractionMethod).toBeNull();
    expect(parsed.attachmentFileUrls).toEqual([
      'https://cdn.chinhphu.vn/files/51-2024-qh15.pdf',
    ]);
  });

  it('carries fullText/extractionMethod through from the extractor result', () => {
    const parsed = parseChinhPhuDocument(makeRaw(), {
      fullText: 'Điều 1. Phạm vi điều chỉnh...',
      extractionMethod: 'docling-vlm',
    });

    expect(parsed.fullText).toBe('Điều 1. Phạm vi điều chỉnh...');
    expect(parsed.extractionMethod).toBe('docling-vlm');
  });

  it('throws when docType is missing', () => {
    expect(() =>
      parseChinhPhuDocument(makeRaw({ docType: null }), noText),
    ).toThrow(/Loại văn bản/);
  });

  it('throws when issuingBody is missing', () => {
    expect(() =>
      parseChinhPhuDocument(makeRaw({ issuingBody: null }), noText),
    ).toThrow(/Cơ quan ban hành/);
  });

  it('passes through a null date as-is (validated downstream)', () => {
    const parsed = parseChinhPhuDocument(makeRaw({ date: null }), noText);
    expect(parsed.attributes.issuedDateRaw).toBeNull();
  });

  it('passes through null signerName/signerTitle when the page has no "Người ký" row', () => {
    const parsed = parseChinhPhuDocument(
      makeRaw({ signerName: null, signerTitle: null }),
      noText,
    );
    expect(parsed.attributes.signerName).toBeNull();
    expect(parsed.attributes.signerTitle).toBeNull();
  });
});
