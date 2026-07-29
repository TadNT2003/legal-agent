import {
  filterByDateRange,
  findByCitation,
  findByTitleFuzzy,
  findSupersededConflict,
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

describe('findSupersededConflict', () => {
  const LUAT_SUBDIR = '02-luat-nghi-quyet-quoc-hoi/luat';

  it('finds a different document with the same subject in the given subdir', () => {
    const olderVersion: ManifestEntry = {
      citation: '13/2003/QH11',
      title: 'Luật Đất đai',
      date: '26/11/2003',
      pdf: 'https://datafiles.chinhphu.vn/x/dd2003.pdf',
      subdir: LUAT_SUBDIR,
      filename: '13-2003-QH11_luat-dat-dai.pdf',
    };
    const conflict = findSupersededConflict(
      [...ENTRIES, olderVersion],
      LUAT_SUBDIR,
      '31/2024/QH15',
      'Luật Đất đai',
    );
    expect(conflict?.citation).toBe('13/2003/QH11');
  });

  it('matches despite diacritics/case differences', () => {
    const entry: ManifestEntry = {
      citation: '13/2003/QH11',
      title: 'LUẬT ĐẤT ĐAI',
      date: '26/11/2003',
      pdf: 'https://datafiles.chinhphu.vn/x/dd2003.pdf',
      subdir: LUAT_SUBDIR,
      filename: '13-2003-QH11_luat-dat-dai.pdf',
    };
    expect(
      findSupersededConflict(
        [entry],
        LUAT_SUBDIR,
        '31/2024/QH15',
        'luat dat dai',
      ),
    ).not.toBeNull();
  });

  it('never matches the same citation (a re-download is not a supersession conflict)', () => {
    expect(
      findSupersededConflict(
        ENTRIES,
        '02-luat-nghi-quyet-quoc-hoi/luat',
        '45/2019/QH14',
        'Bộ luật Lao động',
      ),
    ).toBeNull();
  });

  it('ignores entries outside the given subdir', () => {
    const sameTitleDifferentSubdir: ManifestEntry = {
      citation: '99/2010/QH12',
      title: 'Bộ luật Lao động',
      date: '10/01/2010',
      pdf: 'https://datafiles.chinhphu.vn/x/x.pdf',
      subdir: '02-luat-nghi-quyet-quoc-hoi/luat-het-hieu-luc',
      filename: 'x.pdf',
    };
    expect(
      findSupersededConflict(
        [...ENTRIES, sameTitleDifferentSubdir],
        LUAT_SUBDIR,
        '45/2019/QH14',
        'Bộ luật Lao động',
      ),
    ).toBeNull();
  });

  it('returns null when no other document shares the subject', () => {
    expect(
      findSupersededConflict(
        ENTRIES,
        LUAT_SUBDIR,
        '99/2099/QH99',
        'Luật hoàn toàn khác',
      ),
    ).toBeNull();
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
