import {
  buildSearchResultUrl,
  correctQuocHoiIssuingBody,
  extractCitationFromTitle,
  extractRscJsonPayload,
  extractVbplInternalId,
  normalizeCitation,
  parseAttributes,
  parseRelations,
  parseVbplDate,
  parseVbplPage,
  parseVbplSearchPage,
  parseVbplSearchResponse,
} from './vbpl.parser';
import type {
  RawAttributeEntry,
  RawRelationSection,
  RawVbplPage,
  RawVbplSearchResponse,
} from './vbpl-document.interface';

const ATTRIBUTES: RawAttributeEntry[] = [
  { label: 'Số hiệu', value: '05/2026/TT-BNG' },
  { label: 'Loại văn bản', value: 'Thông tư' },
  { label: 'Ngành', value: 'Ngoại giao' },
  { label: 'Ngày ban hành', value: '30/06/2026' },
  { label: 'Lĩnh vực', value: 'Dịch Quốc hiệu' },
  { label: 'Ngày có hiệu lực', value: '15/08/2026' },
  { label: 'Tình trạng hiệu lực', value: 'Chưa có hiệu lực' },
  { label: 'Ngày hết hiệu lực', value: '--' },
  { label: 'Cơ quan ban hành', value: 'Bộ Ngoại giao' },
  { label: 'Chức danh', value: 'Bộ trưởng' },
  { label: 'Người ký', value: 'Ngô Lê Văn' },
];

describe('extractCitationFromTitle', () => {
  it.each([
    [
      'Thông tư số 03/2009/TT-BNG Hướng dẫn dịch Quốc hiệu...',
      '03/2009/TT-BNG',
    ],
    ['Luật số 45/2019/QH14 Bộ luật Lao động', '45/2019/QH14'],
    ['Nghị định số 78/2025/NĐ-CP quy định chi tiết...', '78/2025/NĐ-CP'],
  ])('extracts the citation from %s', (title, expected) => {
    expect(extractCitationFromTitle(title)).toBe(expected);
  });

  it('returns null when there is no "số " marker', () => {
    expect(
      extractCitationFromTitle('Văn bản không có số ký hiệu rõ ràng'),
    ).toBeNull();
  });
});

describe('parseVbplDate', () => {
  it('converts DD/MM/YYYY to YYYY-MM-DD', () => {
    expect(parseVbplDate('30/06/2026')).toBe('2026-06-30');
  });

  it('treats the "--" placeholder as null', () => {
    expect(parseVbplDate('--')).toBeNull();
  });

  it('treats empty/missing input as null', () => {
    expect(parseVbplDate(null)).toBeNull();
    expect(parseVbplDate(undefined)).toBeNull();
    expect(parseVbplDate('')).toBeNull();
  });
});

describe('parseAttributes', () => {
  it('maps every known label to its field', () => {
    expect(parseAttributes(ATTRIBUTES)).toEqual({
      citation: '05/2026/TT-BNG',
      documentType: 'Thông tư',
      industry: 'Ngoại giao',
      field: 'Dịch Quốc hiệu',
      issuingBody: 'Bộ Ngoại giao',
      signerTitle: 'Bộ trưởng',
      signerName: 'Ngô Lê Văn',
      issuedDateRaw: '30/06/2026',
      effectiveDateRaw: '15/08/2026',
      expiryDateRaw: '--',
      validityStatusRaw: 'Chưa có hiệu lực',
    });
  });

  it('tolerates missing optional fields (industry/field/signer)', () => {
    const required = ATTRIBUTES.filter((e) =>
      [
        'Số hiệu',
        'Loại văn bản',
        'Cơ quan ban hành',
        'Tình trạng hiệu lực',
      ].includes(e.label),
    );
    const parsed = parseAttributes(required);
    expect(parsed.industry).toBeNull();
    expect(parsed.signerName).toBeNull();
  });

  it('throws when a required field (citation/documentType/issuingBody) is missing', () => {
    const missingIssuingBody = ATTRIBUTES.filter(
      (e) => e.label !== 'Cơ quan ban hành',
    );
    expect(() => parseAttributes(missingIssuingBody)).toThrow(
      /missing a required field/,
    );
  });

  it('corrects issuingBody for a "Luật" mis-attributed to a ministry (real vbpl.vn mismatch)', () => {
    const mismatched: RawAttributeEntry[] = ATTRIBUTES.map((e) =>
      e.label === 'Số hiệu'
        ? { ...e, value: '135/2025/QH15' }
        : e.label === 'Loại văn bản'
          ? { ...e, value: 'Luật' }
          : e.label === 'Cơ quan ban hành'
            ? { ...e, value: 'Bộ Xây dựng' }
            : e,
    );
    expect(parseAttributes(mismatched).issuingBody).toBe('Quốc hội');
  });

  it('leaves validityStatusRaw null instead of throwing when "Tình trạng hiệu lực" is absent', () => {
    // Confirmed live on some very-recently-issued documents (e.g. Luật Trí
    // tuệ nhân tạo số 134/2025/QH15) — vbpl.vn's own attributes tab has no
    // such row at all, an upstream data gap rather than a scrape failure.
    const missingStatus = ATTRIBUTES.filter(
      (e) => e.label !== 'Tình trạng hiệu lực',
    );
    const parsed = parseAttributes(missingStatus);
    expect(parsed.validityStatusRaw).toBeNull();
    expect(parsed.citation).toBe('05/2026/TT-BNG');
  });
});

describe('correctQuocHoiIssuingBody', () => {
  it('corrects "Luật" to Quốc hội regardless of the reported issuing body', () => {
    // Real vbpl.vn mismatch: Luật Xây dựng số 135/2025/QH15 reports "Bộ Xây
    // dựng" (the drafting ministry) as "Cơ quan ban hành".
    expect(
      correctQuocHoiIssuingBody('Luật', '135/2025/QH15', 'Bộ Xây dựng'),
    ).toBe('Quốc hội');
  });

  it('corrects "Bộ luật" to Quốc hội regardless of the reported issuing body', () => {
    expect(
      correctQuocHoiIssuingBody('Bộ luật', '91/2015/QH13', 'Bộ Tư pháp'),
    ).toBe('Quốc hội');
  });

  it('corrects "Nghị quyết" to Quốc hội only when the citation carries Quốc hội\'s own QH<khóa> numbering', () => {
    expect(
      correctQuocHoiIssuingBody(
        'Nghị quyết',
        '134/2025/QH15',
        'Văn phòng Quốc hội',
      ),
    ).toBe('Quốc hội');
  });

  it('leaves "Nghị quyết" alone when the citation does not carry QH numbering (e.g. Chính phủ)', () => {
    expect(
      correctQuocHoiIssuingBody('Nghị quyết', '178/2025/NQ-CP', 'Chính phủ'),
    ).toBe('Chính phủ');
  });

  it('leaves non-tier-2/3 document types untouched even with a QH-shaped citation', () => {
    expect(
      correctQuocHoiIssuingBody('Thông tư', '05/2026/TT-BNG', 'Bộ Ngoại giao'),
    ).toBe('Bộ Ngoại giao');
  });

  it('is a no-op when the issuing body is already "Quốc hội"', () => {
    expect(
      correctQuocHoiIssuingBody('Luật', '51/2024/QH15', 'Quốc hội'),
    ).toBe('Quốc hội');
  });

  it('recognizes older batch-era "Nghị quyết" citations ("QHK<khóa>") as Quốc hội\'s own', () => {
    expect(
      correctQuocHoiIssuingBody('Nghị quyết', '216-NQ/QHK4', 'Chính phủ'),
    ).toBe('Quốc hội');
  });

  it('corrects "Luật" to Quốc hội even for citations with no QH marker at all (pre-1998 numbering)', () => {
    expect(
      correctQuocHoiIssuingBody('Luật', '45/LCT', 'Chủ tịch nước'),
    ).toBe('Quốc hội');
  });

  it('corrects "Pháp lệnh" to Ủy ban Thường vụ Quốc hội regardless of the reported issuing body', () => {
    // Real vbpl.vn mismatches: Pháp lệnh số 11/2016/UBTVQH13 reports "Quốc
    // hội"; Pháp lệnh Giống cây trồng số 15/2004/PL-UBTVQH11 reports "Bộ
    // Nông nghiệp và Môi trường" (the drafting ministry).
    expect(
      correctQuocHoiIssuingBody('Pháp lệnh', '11/2016/UBTVQH13', 'Quốc hội'),
    ).toBe('Uỷ ban Thường vụ Quốc hội');
    expect(
      correctQuocHoiIssuingBody(
        'Pháp lệnh',
        '15/2004/PL-UBTVQH11',
        'Bộ Nông nghiệp và Môi trường',
      ),
    ).toBe('Uỷ ban Thường vụ Quốc hội');
  });

  it('corrects "Nghị quyết" to Ủy ban Thường vụ Quốc hội when the citation carries UBTVQH\'s own numbering', () => {
    expect(
      correctQuocHoiIssuingBody(
        'Nghị quyết',
        '1234/2020/UBTVQH14',
        'Chính phủ',
      ),
    ).toBe('Uỷ ban Thường vụ Quốc hội');
  });

  it('does not misclassify an already-correct UBTVQH-numbered "Nghị quyết" as Quốc hội (citation ends in "...QH<khóa>" too)', () => {
    // Regression: "1234/2020/UBTVQH14" ends in "QH14", which the bare
    // Quốc-hội pattern alone would also match — the UBTVQH-specific pattern
    // must be checked first (or the bare pattern must exclude it).
    expect(
      correctQuocHoiIssuingBody(
        'Nghị quyết',
        '1234/2020/UBTVQH14',
        'Uỷ ban Thường vụ Quốc hội',
      ),
    ).toBe('Uỷ ban Thường vụ Quốc hội');
  });
});

describe('normalizeCitation', () => {
  it('leaves an already-clean citation untouched', () => {
    expect(normalizeCitation('51/2024/QH15')).toBe('51/2024/QH15');
  });

  it('strips a redundant "<Loại văn bản> số " prefix', () => {
    expect(normalizeCitation('Luật số 51/2024/QH15')).toBe('51/2024/QH15');
  });

  it('strips a "số: " prefix with a colon', () => {
    expect(normalizeCitation('số: 34/2024/QH15')).toBe('34/2024/QH15');
  });

  it('collapses a doubled "số số " typo', () => {
    expect(normalizeCitation('số số 99/2025/QH15')).toBe('99/2025/QH15');
  });

  it('strips a "Số hiệu: " prefix (the field\'s own label duplicated into its value)', () => {
    expect(normalizeCitation('Số hiệu: 51/LCT')).toBe('51/LCT');
  });

  it('leaves "Không số" (genuinely no citation number) untouched', () => {
    expect(normalizeCitation('Không số')).toBe('Không số');
  });
});

describe('parseRelations', () => {
  it('maps an outbound relation with a resolvable citation', () => {
    const raw: RawRelationSection[] = [
      {
        categoryLabel: 'Văn bản thay thế (1)',
        entries: ['Thông tư số 03/2009/TT-BNG Hướng dẫn dịch...'],
      },
    ];
    const { relations } = parseRelations(raw);
    expect(relations).toEqual([
      {
        referenceType: 'amends',
        changeType: 'replace',
        thisDocIsSource: true,
        otherDocRawText: 'Thông tư số 03/2009/TT-BNG Hướng dẫn dịch...',
        otherDocCitation: '03/2009/TT-BNG',
      },
    ]);
  });

  it('maps an inbound relation', () => {
    const raw: RawRelationSection[] = [
      {
        categoryLabel: 'Căn cứ ban hành (2)',
        entries: ['Luật số 63/2025/QH15 Tổ chức Chính phủ'],
      },
    ];
    const { relations } = parseRelations(raw);
    expect(relations[0]).toMatchObject({
      referenceType: 'has_basis',
      thisDocIsSource: true,
    });
  });

  it('skips categories whose only entry is the "--" empty-state placeholder', () => {
    const raw: RawRelationSection[] = [
      { categoryLabel: 'Văn bản bãi bỏ (0)', entries: ['--'] },
    ];
    expect(parseRelations(raw).relations).toEqual([]);
  });

  it('excludes "Văn bản liên quan cùng nội dung" (not a legal relationship)', () => {
    const raw: RawRelationSection[] = [
      {
        categoryLabel: 'Văn bản liên quan cùng nội dung (3)',
        entries: ['Something', 'Something else'],
      },
    ];
    expect(parseRelations(raw).relations).toEqual([]);
  });

  it('splits "Văn bản hợp nhất" / "Văn bản được hợp nhất" into consolidation, not relations', () => {
    const raw: RawRelationSection[] = [
      { categoryLabel: 'Văn bản hợp nhất (1)', entries: ['Luật A'] },
      { categoryLabel: 'Văn bản được hợp nhất (1)', entries: ['Luật B'] },
    ];
    const { relations, consolidation } = parseRelations(raw);
    expect(relations).toEqual([]);
    expect(consolidation).toEqual({
      consolidatesRawTitles: ['Luật A'],
      consolidatedIntoRawTitles: ['Luật B'],
    });
  });

  it('throws on an unrecognized category label', () => {
    const raw: RawRelationSection[] = [
      { categoryLabel: 'Một danh mục mới lạ (1)', entries: ['X'] },
    ];
    expect(() => parseRelations(raw)).toThrow(
      /Unrecognized vbpl.vn relation category/,
    );
  });
});

describe('parseVbplPage', () => {
  it('combines scope/title/fullText/attributes/relations/consolidation', () => {
    const raw: RawVbplPage = {
      sourceUrl: 'https://vbpl.vn/van-ban/chi-tiet/example',
      scope: 'trung-uong',
      title: 'Thông tư số 05/2026/TT-BNG Hướng dẫn dịch Quốc hiệu...',
      fullText: 'Điều 1. Phạm vi điều chỉnh...',
      attributes: ATTRIBUTES,
      relations: [],
    };
    const parsed = parseVbplPage(raw);
    expect(parsed.scope).toBe('trung-uong');
    expect(parsed.title).toBe(raw.title);
    expect(parsed.fullText).toBe(raw.fullText);
    expect(parsed.attributes.citation).toBe('05/2026/TT-BNG');
    expect(parsed.relations).toEqual([]);
    expect(parsed.consolidation).toEqual({
      consolidatesRawTitles: [],
      consolidatedIntoRawTitles: [],
    });
  });
});

describe('extractRscJsonPayload', () => {
  it('extracts the JSON object line from an RSC Flight-protocol stream', () => {
    const body = '0:["$@1",["abc123",null]]\n1:{"total":1,"items":[]}\n';
    expect(extractRscJsonPayload(body)).toEqual({ total: 1, items: [] });
  });

  it('throws when no line has a parseable JSON object payload', () => {
    const body = '0:["$@1",["abc123",null]]\n';
    expect(() => extractRscJsonPayload(body)).toThrow(
      /no parseable JSON object line/,
    );
  });
});

describe('buildSearchResultUrl', () => {
  it('builds a vbpl.vn detail URL from just the id', () => {
    expect(buildSearchResultUrl('32833')).toBe(
      'https://vbpl.vn/van-ban/chi-tiet/van-ban--32833',
    );
  });
});

describe('extractVbplInternalId', () => {
  it('is the exact inverse of buildSearchResultUrl', () => {
    expect(extractVbplInternalId(buildSearchResultUrl('32833'))).toBe('32833');
  });

  it('extracts the id from a real detail URL', () => {
    expect(
      extractVbplInternalId('https://vbpl.vn/van-ban/chi-tiet/van-ban--25506'),
    ).toBe('25506');
  });

  it('returns null for a URL with no id', () => {
    expect(
      extractVbplInternalId('https://vbpl.vn/van-ban/trung-uong'),
    ).toBeNull();
  });
});

describe('parseVbplSearchResponse', () => {
  const raw: RawVbplSearchResponse = {
    total: 52,
    pageNumber: 1,
    pageSize: 20,
    items: [
      {
        id: '32833',
        title: 'Luật Đất đai số 45/2013/QH13',
        docNum: '45/2013/QH13',
        docType: { name: 'Luật' },
        issueDate: '2013-11-29T00:00:00',
        effFrom: '2014-07-01T00:00:00',
        effTo: '2025-01-01T00:00:00',
        effStatus: { name: 'Hết hiệu lực toàn bộ' },
        agencyName: 'Quốc hội',
      },
    ],
  };

  it('maps total/page/pageSize and each item, converting datetimes to dates', () => {
    expect(parseVbplSearchResponse(raw)).toEqual({
      total: 52,
      page: 1,
      pageSize: 20,
      items: [
        {
          sourceUrl: 'https://vbpl.vn/van-ban/chi-tiet/van-ban--32833',
          citation: '45/2013/QH13',
          title: 'Luật Đất đai số 45/2013/QH13',
          documentType: 'Luật',
          issuingBody: 'Quốc hội',
          issuedDate: '2013-11-29',
          effectiveDate: '2014-07-01',
          expiryDate: '2025-01-01',
          validityStatus: 'Hết hiệu lực toàn bộ',
        },
      ],
    });
  });

  it('tolerates a null effTo (still in effect) and null docType/effStatus', () => {
    const result = parseVbplSearchResponse({
      total: 1,
      pageNumber: 1,
      pageSize: 10,
      items: [
        {
          id: 'x',
          title: 'X',
          docNum: '1/2024',
          docType: null,
          issueDate: null,
          effFrom: null,
          effTo: null,
          effStatus: null,
          agencyName: 'Chính phủ',
        },
      ],
    });
    expect(result.items[0]).toMatchObject({
      documentType: '',
      validityStatus: '',
      issuedDate: null,
      effectiveDate: null,
      expiryDate: null,
    });
  });
});

describe('parseVbplSearchPage', () => {
  it('combines RSC extraction and search-response parsing', () => {
    const body =
      '0:["$@1",["abc123",null]]\n1:{"total":1,"pageNumber":1,"pageSize":10,"items":[]}\n';
    expect(parseVbplSearchPage(body)).toEqual({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [],
    });
  });
});
