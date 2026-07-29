// Referenced by law-tier-classifier.ts for supersession resolution — the
// only two tier-2 subfolders that hold standalone Luật/Bộ luật (not
// amendments, not Quốc hội resolutions), so the only ones a newer document
// can legitimately bump an older one out of.
export const LUAT_SUBDIR = '02-luat-nghi-quyet-quoc-hoi/luat';
export const LUAT_HET_HIEU_LUC_SUBDIR =
  '02-luat-nghi-quyet-quoc-hoi/luat-het-hieu-luc';

export interface TierDefinition {
  subdir: string;
  description: string;
  /** Known sub-folders to pre-create — tier 2 is the only tier with an established split today. */
  children?: string[];
}

// Mirrors Điều 4, Luật 64/2025/QH15 (see docs/vn-legal-document-structure.md) and
// the exact wording already on disk in laws/*/README.md — kept identical so
// bootstrapping the real ../laws/ dataset is a byte-for-byte no-op.
export const TIER_DEFINITIONS: TierDefinition[] = [
  { subdir: '01-hien-phap', description: 'Hiến pháp.' },
  {
    subdir: '02-luat-nghi-quyet-quoc-hoi',
    description: 'Bộ luật, luật, nghị quyết của Quốc hội.',
    children: [
      LUAT_SUBDIR.split('/')[1],
      LUAT_HET_HIEU_LUC_SUBDIR.split('/')[1],
      'luat-sua-doi-bo-sung',
      'nghi-quyet-quoc-hoi',
    ],
  },
  {
    subdir: '03-phap-lenh-nghi-quyet-ubtvqh',
    description:
      'Pháp lệnh, nghị quyết của Ủy ban Thường vụ Quốc hội; nghị quyết liên tịch giữa UBTVQH với Đoàn Chủ tịch UBTƯMTTQVN; nghị quyết liên tịch giữa UBTVQH, Chính phủ với Đoàn Chủ tịch UBTƯMTTQVN.',
  },
  {
    subdir: '04-lenh-quyet-dinh-chu-tich-nuoc',
    description: 'Lệnh, quyết định của Chủ tịch nước.',
  },
  {
    subdir: '05-nghi-dinh-nghi-quyet-chinh-phu',
    description:
      'Nghị định, nghị quyết của Chính phủ; nghị quyết liên tịch giữa Chính phủ với Đoàn Chủ tịch UBTƯMTTQVN.',
  },
  {
    subdir: '06-quyet-dinh-thu-tuong-chinh-phu',
    description: 'Quyết định của Thủ tướng Chính phủ.',
  },
  {
    subdir: '07-nghi-quyet-hoi-dong-tham-phan-tandtc',
    description: 'Nghị quyết của Hội đồng Thẩm phán Tòa án nhân dân tối cao.',
  },
  {
    subdir: '08-thong-tu-bo-nganh',
    description:
      'Thông tư của Chánh án TANDTC; thông tư của Viện trưởng VKSNDTC; thông tư của Bộ trưởng, Thủ trưởng cơ quan ngang Bộ; thông tư của Tổng Kiểm toán nhà nước.',
  },
  {
    subdir: '09-thong-tu-lien-tich',
    description:
      'Thông tư liên tịch giữa Chánh án TANDTC, Viện trưởng VKSNDTC, Tổng Kiểm toán nhà nước, Bộ trưởng, Thủ trưởng cơ quan ngang Bộ.',
  },
  {
    subdir: '10-nghi-quyet-hdnd-cap-tinh',
    description: 'Nghị quyết của Hội đồng nhân dân cấp tỉnh.',
  },
  {
    subdir: '11-quyet-dinh-ubnd-cap-tinh',
    description: 'Quyết định của Ủy ban nhân dân cấp tỉnh.',
  },
  {
    subdir: '12-vbqppl-don-vi-hanh-chinh-kinh-te-dac-biet',
    description:
      'Văn bản quy phạm pháp luật của chính quyền địa phương ở đơn vị hành chính - kinh tế đặc biệt.',
  },
  {
    subdir: '13-nghi-quyet-hdnd-cap-huyen',
    description: 'Nghị quyết của Hội đồng nhân dân cấp huyện.',
  },
  {
    subdir: '14-quyet-dinh-ubnd-cap-huyen',
    description: 'Quyết định của Ủy ban nhân dân cấp huyện.',
  },
];
