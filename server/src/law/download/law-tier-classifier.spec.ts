import { classifyTier } from './law-tier-classifier';

describe('classifyTier', () => {
  it.each([
    ['Hiến pháp', null, null, 1, '01-hien-phap'],
    ['Luật', 'Quốc hội', 'Luật Đất đai', 2, '02-luat-nghi-quyet-quoc-hoi/luat'],
    [
      'Bộ luật',
      'Quốc hội',
      'Bộ luật Lao động',
      2,
      '02-luat-nghi-quyet-quoc-hoi/luat',
    ],
    [
      'Luật',
      'Quốc hội',
      'Luật sửa đổi, bổ sung một số điều của Luật Đất đai',
      2,
      '02-luat-nghi-quyet-quoc-hoi/luat-sua-doi-bo-sung',
    ],
    [
      'Nghị quyết',
      'Quốc hội',
      'Nghị quyết về chương trình xây dựng luật',
      2,
      '02-luat-nghi-quyet-quoc-hoi/nghi-quyet-quoc-hoi',
    ],
    [
      'Nghị quyết',
      'Ủy ban Thường vụ Quốc hội',
      'Nghị quyết',
      3,
      '03-phap-lenh-nghi-quyet-ubtvqh',
    ],
    [
      'Pháp lệnh',
      'Ủy ban Thường vụ Quốc hội',
      'Pháp lệnh',
      3,
      '03-phap-lenh-nghi-quyet-ubtvqh',
    ],
    [
      'Lệnh',
      'Chủ tịch nước',
      'Lệnh công bố luật',
      4,
      '04-lenh-quyet-dinh-chu-tich-nuoc',
    ],
    [
      'Quyết định',
      'Chủ tịch nước',
      'Quyết định về đặc xá',
      4,
      '04-lenh-quyet-dinh-chu-tich-nuoc',
    ],
    [
      'Nghị định',
      'Chính phủ',
      'Nghị định quy định chi tiết',
      5,
      '05-nghi-dinh-nghi-quyet-chinh-phu',
    ],
    [
      'Nghị quyết',
      'Chính phủ',
      'Nghị quyết phiên họp thường kỳ',
      5,
      '05-nghi-dinh-nghi-quyet-chinh-phu',
    ],
    [
      'Quyết định',
      'Thủ tướng Chính phủ',
      'Quyết định phê duyệt quy hoạch',
      6,
      '06-quyet-dinh-thu-tuong-chinh-phu',
    ],
    [
      'Nghị quyết',
      'Hội đồng Thẩm phán Tòa án nhân dân tối cao',
      'Nghị quyết hướng dẫn áp dụng',
      7,
      '07-nghi-quyet-hoi-dong-tham-phan-tandtc',
    ],
    [
      'Thông tư',
      'Bộ Tài chính',
      'Thông tư hướng dẫn',
      8,
      '08-thong-tu-bo-nganh',
    ],
    [
      'Thông tư liên tịch',
      'Bộ Tài chính, Bộ Tư pháp',
      'Thông tư liên tịch hướng dẫn',
      9,
      '09-thong-tu-lien-tich',
    ],
    [
      'Nghị quyết',
      'Hội đồng nhân dân tỉnh Khánh Hòa',
      'Nghị quyết về ngân sách',
      10,
      '10-nghi-quyet-hdnd-cap-tinh',
    ],
    [
      'Quyết định',
      'Ủy ban nhân dân tỉnh Khánh Hòa',
      'Quyết định ban hành quy chế',
      11,
      '11-quyet-dinh-ubnd-cap-tinh',
    ],
    [
      'Nghị quyết',
      'Hội đồng nhân dân huyện Cam Lâm',
      'Nghị quyết về dự toán',
      13,
      '13-nghi-quyet-hdnd-cap-huyen',
    ],
    [
      'Quyết định',
      'Ủy ban nhân dân huyện Cam Lâm',
      'Quyết định ban hành quy chế',
      14,
      '14-quyet-dinh-ubnd-cap-huyen',
    ],
  ])(
    'classifies %s / %s as tier %i (%s)',
    (docType, issuingBody, title, tier, subdir) => {
      expect(classifyTier(docType, issuingBody, title)).toEqual({
        tier,
        subdir,
      });
    },
  );

  it('returns null for a "Văn bản hợp nhất" (not one of the 14 tiers)', () => {
    expect(
      classifyTier(
        'Văn bản hợp nhất',
        'Bộ Nông nghiệp và Môi trường',
        'Hợp nhất',
      ),
    ).toBeNull();
  });

  it('returns null when docType is missing', () => {
    expect(classifyTier(null, 'Chính phủ', 'Một văn bản')).toBeNull();
  });

  it('returns null for an unrecognized "Quyết định" issuing body', () => {
    expect(
      classifyTier('Quyết định', 'Tổng công ty XYZ', 'Quyết định nội bộ'),
    ).toBeNull();
  });
});
