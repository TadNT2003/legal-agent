import { buildFilename } from './filename.util';

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
