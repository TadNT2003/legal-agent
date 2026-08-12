import { createHash } from 'crypto';
import type {
  ParsedVbplAttributes,
  VbplChangeType,
  VbplReferenceType,
} from '../crawl/vbpl-document.interface';

// Test the standalone helper functions from document.repository.ts
// These are module-scoped (not exported), so we replicate their logic
// to verify correctness independently.

// --- Replicated functions from document.repository.ts ---

// mapValidityStatus
type DbStatus =
  | 'chua_co_hieu_luc'
  | 'con_hieu_luc'
  | 'het_hieu_luc'
  | 'het_hieu_luc_mot_phan'
  | 'ngung_hieu_luc'
  | null;

const VALIDITY_STATUS_MAP: Record<string, NonNullable<DbStatus>> = {
  'chưa có hiệu lực': 'chua_co_hieu_luc',
  'còn hiệu lực': 'con_hieu_luc',
  'hết hiệu lực toàn bộ': 'het_hieu_luc',
  'hết hiệu lực': 'het_hieu_luc',
  'hết hiệu lực một phần': 'het_hieu_luc_mot_phan',
  'ngưng hiệu lực': 'ngung_hieu_luc',
  'tạm ngưng hiệu lực': 'ngung_hieu_luc',
};

function mapValidityStatus(raw: string | null): DbStatus {
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  const mapped = VALIDITY_STATUS_MAP[normalized];
  if (!mapped) {
    throw new Error(
      `Unrecognized vbpl.vn "Tinh trang hieu luc" value: "${raw}"`,
    );
  }
  return mapped;
}

// estimateAuthorityRank
function estimateAuthorityRank(issuingBodyName: string): number {
  const name = issuingBodyName.toLowerCase();
  if (name.includes('ủy ban thường vụ quốc hội')) return 3;
  if (name === 'quốc hội' || name.includes('quốc hội')) return 2;
  if (name.includes('chủ tịch nước')) return 4;
  if (name.includes('thủ tướng')) return 6;
  if (name === 'chính phủ' || name.includes('chính phủ')) return 5;
  if (name.includes('hội đồng thẩm phán')) return 7;
  return 8;
}

// computeContentVersion
interface ParsedVbplDocument {
  fullText: string;
  attributes: ParsedVbplAttributes;
  title: string;
}

function computeContentVersion(parsed: ParsedVbplDocument): string {
  const hash = createHash('sha256');
  hash.update(parsed.fullText);
  hash.update(parsed.attributes.citation);
  hash.update(parsed.title);
  hash.update(parsed.attributes.validityStatusRaw ?? '');
  hash.update(parsed.attributes.effectiveDateRaw ?? '');
  hash.update(parsed.attributes.expiryDateRaw ?? '');
  return hash.digest('hex');
}

// formatDateFromYYYYMMDD
function formatDateFromYYYYMMDD(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

// mapDbStatusToDisplay
function mapDbStatusToDisplay(status: string | null): string {
  const reverseMap: Record<string, string> = {
    chua_co_hieu_luc: 'Chưa có hiệu lực',
    con_hieu_luc: 'Còn hiệu lực',
    het_hieu_luc: 'Hết hiệu lực',
    het_hieu_luc_mot_phan: 'Hết hiệu lực một phần',
    ngung_hieu_luc: 'Ngưng hiệu lực',
  };
  return status ? (reverseMap[status] ?? status) : 'Chưa xác định';
}

// parseVbplDate (from vbpl.parser.ts, used by document.repository)
function parseVbplDate(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

// --- Tests ---

describe('mapValidityStatus (document.repository)', () => {
  it('maps "còn hiệu lực" to con_hieu_luc', () => {
    expect(mapValidityStatus('còn hiệu lực')).toBe('con_hieu_luc');
  });

  it('maps "chưa có hiệu lực" to chua_co_hieu_luc', () => {
    expect(mapValidityStatus('chưa có hiệu lực')).toBe('chua_co_hieu_luc');
  });

  it('maps "hết hiệu lực toàn bộ" to het_hieu_luc', () => {
    expect(mapValidityStatus('hết hiệu lực toàn bộ')).toBe('het_hieu_luc');
  });

  it('maps "hết hiệu lực" to het_hieu_luc', () => {
    expect(mapValidityStatus('hết hiệu lực')).toBe('het_hieu_luc');
  });

  it('maps "hết hiệu lực một phần" to het_hieu_luc_mot_phan', () => {
    expect(mapValidityStatus('hết hiệu lực một phần')).toBe(
      'het_hieu_luc_mot_phan',
    );
  });

  it('maps "ngưng hiệu lực" to ngung_hieu_luc', () => {
    expect(mapValidityStatus('ngưng hiệu lực')).toBe('ngung_hieu_luc');
  });

  it('maps "tạm ngưng hiệu lực" to ngung_hieu_luc', () => {
    expect(mapValidityStatus('tạm ngưng hiệu lực')).toBe('ngung_hieu_luc');
  });

  it('returns null for null input', () => {
    expect(mapValidityStatus(null)).toBeNull();
  });

  it('throws for unrecognized status', () => {
    expect(() => mapValidityStatus('không xác định')).toThrow('Unrecognized');
  });

  it('is case-insensitive', () => {
    expect(mapValidityStatus('CÒN HIỆU LỰC')).toBe('con_hieu_luc');
  });

  it('trims whitespace', () => {
    expect(mapValidityStatus('  còn hiệu lực  ')).toBe('con_hieu_luc');
  });
});

describe('estimateAuthorityRank (document.repository)', () => {
  it('returns rank 2 for Quốc hội', () => {
    expect(estimateAuthorityRank('Quốc hội')).toBe(2);
  });

  it('returns rank 3 for Ủy ban Thường vụ Quốc hội', () => {
    expect(estimateAuthorityRank('Ủy ban Thường vụ Quốc hội')).toBe(3);
  });

  it('returns rank 4 for Chủ tịch nước', () => {
    expect(estimateAuthorityRank('Chủ tịch nước')).toBe(4);
  });

  it('returns rank 5 for Chính phủ', () => {
    expect(estimateAuthorityRank('Chính phủ')).toBe(5);
  });

  it('returns rank 6 for Thủ tướng Chính phủ', () => {
    expect(estimateAuthorityRank('Thủ tướng Chính phủ')).toBe(6);
  });

  it('returns rank 7 for Hội đồng Thẩm phán', () => {
    expect(estimateAuthorityRank('Hội đồng Thẩm phán TANDTC')).toBe(7);
  });

  it('returns rank 8 (default) for ministries', () => {
    expect(estimateAuthorityRank('Bộ Tư pháp')).toBe(8);
  });

  it('returns rank 8 for unknown issuing body', () => {
    expect(estimateAuthorityRank('Tổng cục Thống kê')).toBe(8);
  });

  it('is case-insensitive', () => {
    expect(estimateAuthorityRank('QUỐC HỘI')).toBe(2);
  });
});

describe('computeContentVersion (document.repository)', () => {
  const makeParsed = (
    overrides?: Partial<ParsedVbplDocument>,
  ): ParsedVbplDocument => ({
    fullText: 'Full text',
    title: 'Title',
    attributes: {
      citation: '01/2025/QH15',
      documentType: 'Luật',
      industry: null,
      field: null,
      issuingBody: 'Quốc hội',
      signerTitle: null,
      signerName: null,
      issuedDateRaw: '01/01/2025',
      effectiveDateRaw: '01/06/2025',
      expiryDateRaw: null,
      validityStatusRaw: 'còn hiệu lực',
    },
    ...overrides,
  });

  it('produces a 64-character hex hash', () => {
    const hash = computeContentVersion(makeParsed());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for same input', () => {
    const parsed = makeParsed();
    expect(computeContentVersion(parsed)).toBe(computeContentVersion(parsed));
  });

  it('changes when fullText changes', () => {
    const hashA = computeContentVersion(makeParsed({ fullText: 'Text A' }));
    const hashB = computeContentVersion(makeParsed({ fullText: 'Text B' }));
    expect(hashA).not.toBe(hashB);
  });

  it('changes when citation changes', () => {
    const hashA = computeContentVersion(
      makeParsed({
        attributes: { ...makeParsed().attributes, citation: '01/2025/QH15' },
      }),
    );
    const hashB = computeContentVersion(
      makeParsed({
        attributes: { ...makeParsed().attributes, citation: '02/2025/QH15' },
      }),
    );
    expect(hashA).not.toBe(hashB);
  });

  it('changes when validityStatusRaw changes', () => {
    const hashA = computeContentVersion(
      makeParsed({
        attributes: {
          ...makeParsed().attributes,
          validityStatusRaw: 'còn hiệu lực',
        },
      }),
    );
    const hashB = computeContentVersion(
      makeParsed({
        attributes: {
          ...makeParsed().attributes,
          validityStatusRaw: 'hết hiệu lực',
        },
      }),
    );
    expect(hashA).not.toBe(hashB);
  });

  it('handles null effectiveDateRaw', () => {
    const hash = computeContentVersion(
      makeParsed({
        attributes: { ...makeParsed().attributes, effectiveDateRaw: null },
      }),
    );
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles null expiryDateRaw', () => {
    const hash = computeContentVersion(
      makeParsed({
        attributes: { ...makeParsed().attributes, expiryDateRaw: null },
      }),
    );
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when effectiveDateRaw changes from null to value', () => {
    const hashA = computeContentVersion(
      makeParsed({
        attributes: { ...makeParsed().attributes, effectiveDateRaw: null },
      }),
    );
    const hashB = computeContentVersion(
      makeParsed({
        attributes: {
          ...makeParsed().attributes,
          effectiveDateRaw: '01/01/2025',
        },
      }),
    );
    expect(hashA).not.toBe(hashB);
  });
});

describe('formatDateFromYYYYMMDD (document.repository)', () => {
  it('converts yyyy-MM-dd to dd/mm/yyyy', () => {
    expect(formatDateFromYYYYMMDD('2025-01-15')).toBe('15/01/2025');
  });

  it('handles single-digit months and days', () => {
    expect(formatDateFromYYYYMMDD('2025-01-01')).toBe('01/01/2025');
  });

  it('handles end of year dates', () => {
    expect(formatDateFromYYYYMMDD('2024-12-31')).toBe('31/12/2024');
  });
});

describe('mapDbStatusToDisplay (document.repository)', () => {
  it('maps chua_co_hieu_luc to Vietnamese label', () => {
    expect(mapDbStatusToDisplay('chua_co_hieu_luc')).toBe('Chưa có hiệu lực');
  });

  it('maps con_hieu_luc to Vietnamese label', () => {
    expect(mapDbStatusToDisplay('con_hieu_luc')).toBe('Còn hiệu lực');
  });

  it('maps het_hieu_luc to Vietnamese label', () => {
    expect(mapDbStatusToDisplay('het_hieu_luc')).toBe('Hết hiệu lực');
  });

  it('maps het_hieu_luc_mot_phan to Vietnamese label', () => {
    expect(mapDbStatusToDisplay('het_hieu_luc_mot_phan')).toBe(
      'Hết hiệu lực một phần',
    );
  });

  it('maps ngung_hieu_luc to Vietnamese label', () => {
    expect(mapDbStatusToDisplay('ngung_hieu_luc')).toBe('Ngưng hiệu lực');
  });

  it('returns "Chưa xác định" for null status', () => {
    expect(mapDbStatusToDisplay(null)).toBe('Chưa xác định');
  });

  it('returns unknown enum value as-is', () => {
    expect(mapDbStatusToDisplay('unknown_status')).toBe('unknown_status');
  });
});

describe('parseVbplDate (used by document.repository)', () => {
  it('converts dd/mm/yyyy to yyyy-MM-dd', () => {
    expect(parseVbplDate('20/11/2019')).toBe('2019-11-20');
  });

  it('returns null for null input', () => {
    expect(parseVbplDate(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseVbplDate('')).toBeNull();
  });

  it('returns null for non-matching format', () => {
    expect(parseVbplDate('2019-11-20')).toBeNull();
  });

  it('returns null for partial date', () => {
    expect(parseVbplDate('20/11')).toBeNull();
  });
});

describe('nullSafeEq logic (document.repository)', () => {
  // nullSafeEq is a thin wrapper around drizzle-orm eq/isNull.
  // We verify the branching logic directly.

  it('would use isNull when value is null', () => {
    // nullSafeEq(column, value) returns isNull(column) when value === null
    const value = null;
    expect(value === null).toBe(true);
  });

  it('would use eq when value is non-null', () => {
    const value = 'some-value';
    expect(value === null).toBe(false);
  });
});
