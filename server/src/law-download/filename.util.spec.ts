import { buildFilename, buildLawFolderName } from './filename.util';

describe('buildFilename', () => {
  it('slugifies diacritics and joins citation with title, matching the existing manifest convention', () => {
    expect(
      buildFilename(
        '45/2019/QH14',
        'Bộ luật Lao động',
        'https://datafiles.chinhphu.vn/cpp/files/vbpq/2019/bldd.pdf',
      ),
    ).toBe('45-2019-QH14_bo-luat-lao-dong.pdf');
  });

  it('keeps the extension from the file URL, not always .pdf', () => {
    expect(
      buildFilename(
        '10/2008/QH12',
        'Luật sửa đổi, bổ sung một số điều của Luật Dầu khí',
        'https://datafiles.chinhphu.vn/cpp/files/vbpq/2008/10qh.doc',
      ),
    ).toBe(
      '10-2008-QH12_luat-sua-doi-bo-sung-mot-so-dieu-cua-luat-dau-khi.doc',
    );
  });

  it('keeps a single attachment name suffix-free', () => {
    expect(
      buildFilename(
        '45/2019/QH14',
        'Bộ luật Lao động',
        'https://datafiles.chinhphu.vn/cpp/files/vbpq/2019/bldd.pdf',
        0,
        1,
      ),
    ).toBe('45-2019-QH14_bo-luat-lao-dong.pdf');
  });

  it('disambiguates multiple attachments of the same document (e.g. a decree plus phụ lục)', () => {
    const citation = '78/2025/NĐ-CP';
    const title = 'Quy định chi tiết một số điều';
    const urls = [
      'https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/4/78ndcp-1.signed.pdf',
      'https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/4/78-pl1.pdf',
      'https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/4/pl2.pdf',
    ];
    const filenames = urls.map((url, i) =>
      buildFilename(citation, title, url, i, urls.length),
    );

    expect(filenames).toEqual([
      '78-2025-NĐ-CP_quy-dinh-chi-tiet-mot-so-dieu-1.pdf',
      '78-2025-NĐ-CP_quy-dinh-chi-tiet-mot-so-dieu-2.pdf',
      '78-2025-NĐ-CP_quy-dinh-chi-tiet-mot-so-dieu-3.pdf',
    ]);
    expect(new Set(filenames).size).toBe(urls.length);
  });

  it('truncates very long titles to a bounded slug length', () => {
    const longTitle =
      'Luật sửa đổi, bổ sung một số điều của các luật liên quan đến đầu tư xây dựng cơ bản của Nhà nước Cộng hòa xã hội chủ nghĩa Việt Nam';
    const filename = buildFilename(
      '38/2009/QH12',
      longTitle,
      'https://datafiles.chinhphu.vn/cpp/files/vbpq/2009/38qh.doc',
    );
    const titleSlug = filename.split('_')[1].replace('.doc', '');
    expect(titleSlug.length).toBeLessThanOrEqual(80);
  });
});

describe('buildLawFolderName', () => {
  it('matches the citation+title slug, with no extension and no attachment suffix', () => {
    expect(buildLawFolderName('45/2019/QH14', 'Bộ luật Lao động')).toBe(
      '45-2019-QH14_bo-luat-lao-dong',
    );
  });

  it('is the same for every attachment of a multi-file document — the whole point is grouping them', () => {
    const citation = '78/2025/NĐ-CP';
    const title = 'Quy định chi tiết một số điều';
    const urls = [
      'https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/4/78ndcp-1.signed.pdf',
      'https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/4/78-pl1.pdf',
      'https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/4/pl2.pdf',
    ];
    const folders = urls.map(() => buildLawFolderName(citation, title));
    expect(new Set(folders).size).toBe(1);
    expect(folders[0]).toBe('78-2025-NĐ-CP_quy-dinh-chi-tiet-mot-so-dieu');
  });
});
