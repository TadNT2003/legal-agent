import { LUAT_BO_LUAT_SUBDIR } from '../utils/tier-definitions';

export interface TierClassification {
  tier: number;
  subdir: string;
}

function normalize(text: string | null | undefined): string {
  return (text ?? '').toLowerCase();
}

function isProvincial(issuingBody: string): boolean {
  return (
    issuingBody.includes('tỉnh') ||
    issuingBody.includes('thành phố trực thuộc trung ương') ||
    (issuingBody.includes('thành phố') && !issuingBody.includes('thuộc tỉnh'))
  );
}

function isDistrict(issuingBody: string): boolean {
  return (
    issuingBody.includes('huyện') ||
    issuingBody.includes('quận') ||
    issuingBody.includes('thị xã') ||
    issuingBody.includes('thành phố thuộc tỉnh') ||
    issuingBody.includes('thành phố thuộc thành phố')
  );
}

/**
 * Maps a document to one of the 14 tiers in Điều 4, Luật 64/2025/QH15 (see
 * docs/vn-legal-document-structure.md and laws/README.md), using the
 * "Loại văn bản" + "Cơ quan ban hành" text vanban.chinhphu.vn exposes.
 * Rule order matters: more specific phrases ("thông tư liên tịch") must be
 * checked before the substrings they contain ("thông tư").
 */
export function classifyTier(
  docTypeRaw: string | null,
  issuingBodyRaw: string | null,
): TierClassification | null {
  const docType = normalize(docTypeRaw);
  const issuingBody = normalize(issuingBodyRaw);

  if (!docType) return null;

  if (docType.includes('hiến pháp')) {
    return { tier: 1, subdir: '01-hien-phap' };
  }

  if (docType.includes('bộ luật') || docType.includes('luật')) {
    return { tier: 2, subdir: LUAT_BO_LUAT_SUBDIR };
  }

  if (docType.includes('nghị quyết')) {
    if (issuingBody.includes('ủy ban thường vụ quốc hội')) {
      return { tier: 3, subdir: '03-phap-lenh-nghi-quyet-ubtvqh' };
    }
    if (issuingBody.includes('quốc hội')) {
      return {
        tier: 2,
        subdir: '02-luat-nghi-quyet-quoc-hoi/nghi-quyet-quoc-hoi',
      };
    }
    if (issuingBody.includes('hội đồng thẩm phán')) {
      return { tier: 7, subdir: '07-nghi-quyet-hoi-dong-tham-phan-tandtc' };
    }
    if (issuingBody.includes('hội đồng nhân dân')) {
      if (isDistrict(issuingBody)) {
        return { tier: 13, subdir: '13-nghi-quyet-hdnd-cap-huyen' };
      }
      if (isProvincial(issuingBody)) {
        return { tier: 10, subdir: '10-nghi-quyet-hdnd-cap-tinh' };
      }
    }
    if (issuingBody.includes('chính phủ')) {
      return { tier: 5, subdir: '05-nghi-dinh-nghi-quyet-chinh-phu' };
    }
    return null;
  }

  if (docType.includes('pháp lệnh')) {
    return { tier: 3, subdir: '03-phap-lenh-nghi-quyet-ubtvqh' };
  }

  if (docType.includes('lệnh')) {
    return { tier: 4, subdir: '04-lenh-quyet-dinh-chu-tich-nuoc' };
  }

  if (docType.includes('nghị định')) {
    return { tier: 5, subdir: '05-nghi-dinh-nghi-quyet-chinh-phu' };
  }

  if (docType.includes('quyết định')) {
    if (issuingBody.includes('chủ tịch nước')) {
      return { tier: 4, subdir: '04-lenh-quyet-dinh-chu-tich-nuoc' };
    }
    if (issuingBody.includes('thủ tướng')) {
      return { tier: 6, subdir: '06-quyet-dinh-thu-tuong-chinh-phu' };
    }
    if (issuingBody.includes('ủy ban nhân dân')) {
      if (isDistrict(issuingBody)) {
        return { tier: 14, subdir: '14-quyet-dinh-ubnd-cap-huyen' };
      }
      if (isProvincial(issuingBody)) {
        return { tier: 11, subdir: '11-quyet-dinh-ubnd-cap-tinh' };
      }
    }
    return null;
  }

  if (docType.includes('thông tư liên tịch')) {
    return { tier: 9, subdir: '09-thong-tu-lien-tich' };
  }

  if (docType.includes('thông tư')) {
    return { tier: 8, subdir: '08-thong-tu-bo-nganh' };
  }

  return null;
}
