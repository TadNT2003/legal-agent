import { buildContentDisposition, mimeTypeForFilename } from './http-file.util';

describe('mimeTypeForFilename', () => {
  it('returns application/pdf for .pdf files', () => {
    expect(mimeTypeForFilename('document.pdf')).toBe('application/pdf');
  });

  it('returns application/msword for .doc files', () => {
    expect(mimeTypeForFilename('document.doc')).toBe('application/msword');
  });

  it('returns correct MIME for .docx files', () => {
    expect(mimeTypeForFilename('document.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('returns octet-stream for unknown extension', () => {
    expect(mimeTypeForFilename('document.xyz')).toBe('application/octet-stream');
  });

  it('handles uppercase extension', () => {
    expect(mimeTypeForFilename('document.PDF')).toBe('application/pdf');
  });

  it('handles no extension', () => {
    expect(mimeTypeForFilename('README')).toBe('application/octet-stream');
  });
});

describe('buildContentDisposition', () => {
  it('produces RFC 5987 header with UTF-8 encoding', () => {
    const result = buildContentDisposition('45-2019-QH14_bo-luat-lao-dong.pdf');
    expect(result).toContain('attachment;');
    expect(result).toContain('filename="45-2019-QH14_bo-luat-lao-dong.pdf"');
    expect(result).toContain("filename*=UTF-8''");
    expect(result).toContain('45-2019-QH14_bo-luat-lao-dong.pdf');
  });

  it('replaces non-ASCII chars with underscores in ASCII fallback', () => {
    const result = buildContentDisposition('Bộ luật.pdf');
    expect(result).toContain('filename="B_ lu_t.pdf"');
  });

  it('encodes UTF-8 filename in filename* field', () => {
    const result = buildContentDisposition('Bộ luật.pdf');
    expect(result).toContain("filename*=UTF-8''B%E1%BB%99%20lu%E1%BA%ADt.pdf");
  });

  it('handles pure ASCII filename', () => {
    const result = buildContentDisposition('test.pdf');
    expect(result).toBe(
      'attachment; filename="test.pdf"; filename*=UTF-8\'\'test.pdf',
    );
  });
});