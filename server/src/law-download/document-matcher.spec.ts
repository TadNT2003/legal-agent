import {
  filterByDateRange,
  findByCitation,
  findByTitleFuzzy,
  parseManifestDate,
  resolveBestMatch,
} from './document-matcher';
import type { ManifestEntry } from './interfaces/download-outcome.interface';

const ENTRIES: ManifestEntry[] = [
  {
    citation: '45/2019/QH14',
    title: 'Bộ luật Lao động',
    date: '20/11/2019',
    pdf: 'https://datafiles.chinhphu.vn/x/bldd.pdf',
    subdir: '02-luat-nghi-quyet-quoc-hoi/luat',
    filename: '45-2019-QH14_bo-luat-lao-dong.pdf',
  },
  {
    citation: '91/2015/QH13',
    title: 'Bộ luật Dân sự',
    date: '24/11/2015',
    pdf: 'https://datafiles.chinhphu.vn/x/bldds.pdf',
    subdir: '02-luat-nghi-quyet-quoc-hoi/luat',
    filename: '91-2015-QH13_bo-luat-dan-su.pdf',
  },
  {
    citation: '78/2025/NĐ-CP',
    title: 'Quy định chi tiết một số điều',
    date: '01/04/2025',
    pdf: 'https://datafiles.chinhphu.vn/x/78ndcp-1.pdf',
    subdir: '05-nghi-dinh-nghi-quyet-chinh-phu',
    filename: '78-2025-NĐ-CP_quy-dinh-chi-tiet-mot-so-dieu-1.pdf',
  },
  {
    citation: '78/2025/NĐ-CP',
    title: 'Quy định chi tiết một số điều',
    date: '01/04/2025',
    pdf: 'https://datafiles.chinhphu.vn/x/pl2.pdf',
    subdir: '05-nghi-dinh-nghi-quyet-chinh-phu',
    filename: '78-2025-NĐ-CP_quy-dinh-chi-tiet-mot-so-dieu-2.pdf',
  },
];

describe('parseManifestDate', () => {
  it('parses DD/MM/YYYY into a real Date', () => {
    expect(parseManifestDate('20/11/2019')).toEqual(
      new Date(Date.UTC(2019, 10, 20)),
    );
  });

  it('returns null for missing or malformed input', () => {
    expect(parseManifestDate(null)).toBeNull();
    expect(parseManifestDate('2019-11-20')).toBeNull();
  });
});

describe('filterByDateRange', () => {
  it('returns everything when no range is given', () => {
    expect(filterByDateRange(ENTRIES, undefined, undefined)).toHaveLength(4);
  });

  it('applies a true date comparison, not text matching', () => {
    const result = filterByDateRange(ENTRIES, '2018-01-01', '2020-01-01');
    expect(result.map((e) => e.citation)).toEqual(['45/2019/QH14']);
  });

  it('is inclusive at both range ends', () => {
    const result = filterByDateRange(ENTRIES, '2019-11-20', '2019-11-20');
    expect(result).toHaveLength(1);
  });
});

describe('findByCitation', () => {
  it('matches case- and whitespace-insensitively', () => {
    expect(findByCitation(ENTRIES, ' 45/2019/qh14 ')).toHaveLength(1);
  });

  it('returns all files sharing a citation (multi-attachment document)', () => {
    expect(findByCitation(ENTRIES, '78/2025/NĐ-CP')).toHaveLength(2);
  });

  it('returns nothing for an unknown citation', () => {
    expect(findByCitation(ENTRIES, '999/2099/QH99')).toHaveLength(0);
  });
});

describe('findByTitleFuzzy', () => {
  it('matches despite missing diacritics', () => {
    const results = findByTitleFuzzy(ENTRIES, 'bo luat lao dong');
    expect(results[0]?.entry.citation).toBe('45/2019/QH14');
  });

  it('matches a partial title', () => {
    const results = findByTitleFuzzy(ENTRIES, 'dan su');
    expect(results[0]?.entry.citation).toBe('91/2015/QH13');
  });

  it('returns nothing for an unrelated query', () => {
    expect(findByTitleFuzzy(ENTRIES, 'quy hoach do thi mien nui')).toHaveLength(
      0,
    );
  });
});

describe('resolveBestMatch', () => {
  it('prefers an exact citation match over title', () => {
    const match = resolveBestMatch(ENTRIES, {
      citation: '91/2015/QH13',
      title: 'unrelated',
    });
    expect(match?.entry.citation).toBe('91/2015/QH13');
    expect(match?.score).toBe(0);
  });

  it('picks the first-inserted file when a citation matches several attachments', () => {
    const match = resolveBestMatch(ENTRIES, { citation: '78/2025/NĐ-CP' });
    expect(match?.entry.filename).toBe(
      '78-2025-NĐ-CP_quy-dinh-chi-tiet-mot-so-dieu-1.pdf',
    );
  });

  it('falls back to fuzzy title when no citation is given', () => {
    const match = resolveBestMatch(ENTRIES, { title: 'luat lao dong' });
    expect(match?.entry.citation).toBe('45/2019/QH14');
  });

  it('narrows by date range before matching', () => {
    const match = resolveBestMatch(ENTRIES, {
      title: 'bo luat',
      dateFrom: '2015-01-01',
      dateTo: '2015-12-31',
    });
    expect(match?.entry.citation).toBe('91/2015/QH13');
  });

  it('returns null when nothing matches', () => {
    expect(resolveBestMatch(ENTRIES, { citation: 'nope' })).toBeNull();
    expect(resolveBestMatch(ENTRIES, {})).toBeNull();
  });
});
