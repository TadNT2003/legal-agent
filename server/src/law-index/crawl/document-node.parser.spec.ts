import { parseDocumentBody, romanToArabic } from './document-node.parser';

describe('romanToArabic', () => {
  it.each([
    ['I', '1'],
    ['IV', '4'],
    ['IX', '9'],
    ['XIV', '14'],
    ['II', '2'],
  ])('converts %s to %s', (roman, arabic) => {
    expect(romanToArabic(roman)).toBe(arabic);
  });

  it('passes through an already-arabic ordinal unchanged', () => {
    expect(romanToArabic('5')).toBe('5');
  });
});

describe('parseDocumentBody', () => {
  it('parses a bare Điều with no Khoản', () => {
    const fullText = [
      'Điều 1. Phạm vi điều chỉnh',
      'Thông tư này quy định về ...',
    ].join('\n');

    const roots = parseDocumentBody(fullText);

    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      nodeType: 'dieu',
      ordinal: '1',
      label: 'Điều 1',
      heading: 'Phạm vi điều chỉnh',
      textContent: 'Thông tư này quy định về ...',
      children: [],
    });
  });

  it('parses an Điều with Khoản and Điểm nested underneath', () => {
    const fullText = [
      'Điều 2. Giải thích từ ngữ',
      '1. Khoản một nói về A.',
      '2. Khoản hai nói về B.',
      'a) Điểm a của khoản hai.',
      'b) Điểm b của khoản hai.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    expect(dieu.nodeType).toBe('dieu');
    expect(dieu.heading).toBe('Giải thích từ ngữ');
    expect(dieu.children).toHaveLength(2);

    const [khoan1, khoan2] = dieu.children;
    expect(khoan1).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1',
      label: 'Khoản 1',
      textContent: 'Khoản một nói về A.',
      children: [],
    });
    expect(khoan2.textContent).toBe('Khoản hai nói về B.');
    expect(khoan2.children).toHaveLength(2);
    expect(khoan2.children[0]).toMatchObject({
      nodeType: 'diem',
      ordinal: 'a',
      label: 'Điểm a',
      textContent: 'Điểm a của khoản hai.',
    });
    expect(khoan2.children[1]).toMatchObject({
      nodeType: 'diem',
      ordinal: 'b',
      label: 'Điểm b',
      textContent: 'Điểm b của khoản hai.',
    });
  });

  it('parses a Chương containing multiple Điều, with the heading read off the next line', () => {
    const fullText = [
      'Chương I',
      'QUY ĐỊNH CHUNG',
      'Điều 1. Phạm vi điều chỉnh',
      'Nội dung điều 1.',
      'Điều 2. Đối tượng áp dụng',
      'Nội dung điều 2.',
    ].join('\n');

    const [chuong] = parseDocumentBody(fullText);

    expect(chuong).toMatchObject({
      nodeType: 'chuong',
      ordinal: '1',
      label: 'Chương I',
      heading: 'QUY ĐỊNH CHUNG',
    });
    expect(chuong.children).toHaveLength(2);
    expect(chuong.children[0]).toMatchObject({
      nodeType: 'dieu',
      ordinal: '1',
      textContent: 'Nội dung điều 1.',
    });
    expect(chuong.children[1]).toMatchObject({
      nodeType: 'dieu',
      ordinal: '2',
      textContent: 'Nội dung điều 2.',
    });
  });

  it('parses a Phụ lục section as a document-root sibling, classified normative by default', () => {
    const fullText = [
      'Điều 5. Điều khoản thi hành',
      'Thông tư này có hiệu lực...',
      'Phụ lục I',
      'DANH MỤC CÁC TRƯỜNG HỢP',
      'Nội dung phụ lục ở đây.',
    ].join('\n');

    const roots = parseDocumentBody(fullText);

    expect(roots).toHaveLength(2);
    expect(roots[1]).toMatchObject({
      nodeType: 'phu_luc',
      ordinal: '1',
      label: 'Phụ lục I',
      heading: 'DANH MỤC CÁC TRƯỜNG HỢP',
      contentClass: 'normative',
      textContent: 'Nội dung phụ lục ở đây.',
    });
  });

  it('classifies a "Mẫu số" heading Phụ lục as template', () => {
    const fullText = ['Phụ lục II', 'Mẫu số 01', 'Nội dung biểu mẫu.'].join(
      '\n',
    );

    const [phuLuc] = parseDocumentBody(fullText);
    expect(phuLuc.contentClass).toBe('template');
  });

  it("opens a sibling Khoản after a preceding Khoản's Điểm list, confirmed against real vbpl.vn output (Nghị quyết 66.10/2025/NQ-CP, Điều 3)", () => {
    const fullText = [
      'Điều 3. Tổ chức sử dụng chung',
      '1. Tổ chức cho sử dụng chung gồm:',
      'a) Doanh nghiệp do Nhà nước nắm giữ 100% vốn điều lệ;',
      'b) Công ty con do doanh nghiệp quy định tại điểm a khoản này.',
      '2. Tổ chức được sử dụng chung gồm:',
      'a) Các đơn vị Quân đội;',
      'b) Các đơn vị Công an;',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[0]).toMatchObject({ nodeType: 'khoan', ordinal: '1' });
    expect(dieu.children[0].children).toHaveLength(2);
    expect(dieu.children[1]).toMatchObject({ nodeType: 'khoan', ordinal: '2' });
    expect(dieu.children[1].children).toHaveLength(2);
    expect(dieu.children[1].children[0]).toMatchObject({
      nodeType: 'diem',
      ordinal: 'a',
      textContent: 'Các đơn vị Quân đội;',
    });
  });

  it('drops the trailing "Nơi nhận:" distribution list and signature block, confirmed against real vbpl.vn output (Thông tư 05/2026/TT-BNG)', () => {
    const fullText = [
      'Điều 4. Hiệu lực thi hành',
      '1. Thông tư này có hiệu lực kể từ ngày 15 tháng 08 năm 2026.',
      'Nơi nhận:',
      '- Ban Bí thư Trung ương Đảng;',
      '- Thủ tướng Chính phủ;',
      'KT. BỘ TRƯỞNG',
      'THỨ TRƯỞNG',
      'Ngô Lê Văn',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu.children).toHaveLength(1);
    expect(dieu.children[0].textContent).toBe(
      'Thông tư này có hiệu lực kể từ ngày 15 tháng 08 năm 2026.',
    );
  });

  it('drops a "TM./KT." attribution-line signature block with no preceding "Nơi nhận:", confirmed against real vbpl.vn output (Nghị quyết 66.10/2025/NQ-CP)', () => {
    const fullText = [
      'Điều 9. Hiệu lực thi hành',
      '1. Nghị quyết này có hiệu lực thi hành kể từ ngày ký.',
      'TM. CHÍNH PHỦ',
      'KT. THỦ TƯỚNG',
      'PHÓ THỦ TƯỚNG',
      'Nguyễn Chí Dũng',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu.children).toHaveLength(1);
    expect(dieu.children[0].textContent).toBe(
      'Nghị quyết này có hiệu lực thi hành kể từ ngày ký.',
    );
  });

  it('does not adopt a parenthetical "(Kèm theo ...)" cross-reference line as a Phụ lục heading, confirmed against real vbpl.vn output (Thông tư 05/2026/TT-BNG)', () => {
    const fullText = [
      'Phụ lục',
      '(Kèm theo Thông tư số 05/2026/TT-BNG ngày 30 tháng 06 năm 2026',
      'của Bộ trưởng Bộ Ngoại giao)',
      '1. Quốc hiệu',
    ].join('\n');

    const [phuLuc] = parseDocumentBody(fullText);
    expect(phuLuc.nodeType).toBe('phu_luc');
    expect(phuLuc.heading).toBeNull();
    expect(phuLuc.textContent).toBe(
      '(Kèm theo Thông tư số 05/2026/TT-BNG ngày 30 tháng 06 năm 2026\ncủa Bộ trưởng Bộ Ngoại giao)\n1. Quốc hiệu',
    );
  });

  it('opens a generic annex node on a re-stated Quốc hiệu header, confirmed against real vbpl.vn output (Thông tư 46/2026/TT-BXD promulgating QCVN 01:2026/BXD)', () => {
    const fullText = [
      'Điều 2. Hiệu lực thi hành',
      '1. Thông tư này có hiệu lực từ ngày 01/01/2027.',
      'Nơi nhận:',
      '- Bộ trưởng (để b/c);',
      'KT. BỘ TRƯỞNG',
      'THỨ TRƯỞNG',
      'Nguyễn Tường Văn',
      'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
      'QCVN 01:2026/BXD',
      'QUY CHUẨN KỸ THUẬT QUỐC GIA VỀ QUY HOẠCH ĐÔ THỊ VÀ NÔNG THÔN',
    ].join('\n');

    const roots = parseDocumentBody(fullText);
    expect(roots).toHaveLength(2);
    expect(roots[1]).toMatchObject({
      nodeType: 'phu_luc',
      contentClass: 'normative',
    });
    expect(roots[1].textContent).toBe(
      'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nQCVN 01:2026/BXD\nQUY CHUẨN KỸ THUẬT QUỐC GIA VỀ QUY HOẠCH ĐÔ THỊ VÀ NÔNG THÔN',
    );
  });

  it('opens a generic annex node on a "Biểu số" report-form title with no "Phụ lục" label, confirmed against real vbpl.vn output (Thông tư 102/2026/TT-BTC)', () => {
    const fullText = [
      'Điều 17. Hiệu lực thi hành',
      '1. Thông tư này có hiệu lực thi hành kể từ ngày ký.',
      'Nơi nhận:',
      '- Công báo;',
      'KT. BỘ TRƯỞNG',
      'THỨ TRƯỞNG',
      'Nguyễn Đức Tâm',
      'TÊN CƠ QUAN ĐẠI DIỆN CHỦ SỞ HỮU',
      'Biểu số 01.A',
      'HOẠT ĐỘNG ĐẦU TƯ VỐN NHÀ NƯỚC ĐỂ THÀNH LẬP DOANH NGHIỆP',
    ].join('\n');

    const roots = parseDocumentBody(fullText);
    expect(roots).toHaveLength(2);
    expect(roots[1]).toMatchObject({
      nodeType: 'phu_luc',
      contentClass: 'normative',
    });
    // "TÊN CƠ QUAN ĐẠI DIỆN CHỦ SỞ HỮU" (no code after it) doesn't match
    // ANNEX_RESTART_PATTERN itself, so it's dropped as still-footer content —
    // only "Biểu số 01.A" onward is recovered.
    expect(roots[1].textContent).toBe(
      'Biểu số 01.A\nHOẠT ĐỘNG ĐẦU TƯ VỐN NHÀ NƯỚC ĐỂ THÀNH LẬP DOANH NGHIỆP',
    );
  });

  it('does not treat a QCVN self-citation inside ordinary annex prose as a new annex restart', () => {
    const fullText = [
      'Điều 1. Test',
      'Nội dung.',
      'Nơi nhận:',
      'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
      'QCVN 01:2026/BXD do Viện Quy hoạch đô thị và nông thôn quốc gia biên soạn.',
    ].join('\n');

    const roots = parseDocumentBody(fullText);
    expect(roots).toHaveLength(2);
    expect(roots[1].nodeType).toBe('phu_luc');
    expect(roots[1].textContent).toBe(
      'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nQCVN 01:2026/BXD do Viện Quy hoạch đô thị và nông thôn quốc gia biên soạn.',
    );
  });

  it('parses a bare "Điều N" with no punctuation, heading on the next line, confirmed against real vbpl.vn output (Luật 61/2014/QH13)', () => {
    const fullText = [
      'Điều 1',
      '',
      'Sửa đổi, bổ sung một số điều của Luật hàng không dân dụng Việt Nam:',
      '1. Sửa đổi, bổ sung khoản 5 Điều 6 như sau:',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu).toMatchObject({
      nodeType: 'dieu',
      ordinal: '1',
      label: 'Điều 1',
    });
    expect(dieu.heading).toBe(
      'Sửa đổi, bổ sung một số điều của Luật hàng không dân dụng Việt Nam:',
    );
    expect(dieu.children).toHaveLength(1);
  });

  it('parses "Điều N: <heading>" (colon separator), confirmed against real vbpl.vn output (Luật 46/2005/QH11)', () => {
    const fullText =
      'Điều 1: Sửa đổi, bổ sung một số điều của Luật khoáng sản như sau:';

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu).toMatchObject({
      nodeType: 'dieu',
      ordinal: '1',
      heading: 'Sửa đổi, bổ sung một số điều của Luật khoáng sản như sau:',
    });
  });

  it('parses "Điều N <heading>" (space, no punctuation at all), confirmed against real vbpl.vn output (Luật 04/1998/QH10)', () => {
    const fullText =
      'Điều 1 Sửa đổi, bổ sung một số điều của Luật thuế xuất khẩu, thuế nhập khẩu:';

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu).toMatchObject({
      nodeType: 'dieu',
      ordinal: '1',
      heading:
        'Sửa đổi, bổ sung một số điều của Luật thuế xuất khẩu, thuế nhập khẩu:',
    });
  });

  it('parses an inserted-amendment ordinal ("Điều 5a") with its alphabetic suffix intact', () => {
    const fullText = ['Điều 5a. Điều bổ sung', 'Nội dung điều bổ sung.'].join(
      '\n',
    );

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu).toMatchObject({
      nodeType: 'dieu',
      ordinal: '5a',
      label: 'Điều 5a',
      heading: 'Điều bổ sung',
      textContent: 'Nội dung điều bổ sung.',
    });
  });

  it('folds a repeated "Phụ lục N" running header into the currently open annex instead of opening a sibling, confirmed against real vbpl.vn output (22/2026/NQ-CP — 21 subsections each restating "Phụ lục I")', () => {
    const fullText = [
      'Phụ lục I',
      '(Kèm theo Nghị quyết số 22/2026/NQ-CP ngày 29 tháng 4 năm 2026 của Chính phủ)',
      'Cắt giảm thủ tục hành chính thuộc lĩnh vực cấp, quản lý căn cước',
      'Phụ lục I',
      'Cắt giảm thủ tục hành chính thuộc lĩnh vực định danh và xác thực điện tử',
    ].join('\n');

    const roots = parseDocumentBody(fullText);

    // Not 2 — a second "Phụ lục I" restating the SAME numeral as the
    // currently open annex must not fragment it into a sibling node (that
    // was the root cause of 61 documents' worth of duplicate
    // (document_id, path) rows — see law-index-flagged-documents.md).
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ nodeType: 'phu_luc', ordinal: '1' });
    expect(roots[0].textContent).toBe(
      '(Kèm theo Nghị quyết số 22/2026/NQ-CP ngày 29 tháng 4 năm 2026 của Chính phủ)\n' +
        'Cắt giảm thủ tục hành chính thuộc lĩnh vực cấp, quản lý căn cước\n' +
        'Phụ lục I\n' +
        'Cắt giảm thủ tục hành chính thuộc lĩnh vực định danh và xác thực điện tử',
    );
  });

  it('opens a genuinely new Phụ lục when the numeral differs from the currently open one', () => {
    const fullText = [
      'Phụ lục I',
      'DANH MỤC I',
      'Nội dung phụ lục I.',
      'Phụ lục II',
      'DANH MỤC II',
      'Nội dung phụ lục II.',
    ].join('\n');

    const roots = parseDocumentBody(fullText);

    expect(roots).toHaveLength(2);
    expect(roots[0]).toMatchObject({
      ordinal: '1',
      heading: 'DANH MỤC I',
      textContent: 'Nội dung phụ lục I.',
    });
    expect(roots[1]).toMatchObject({
      ordinal: '2',
      heading: 'DANH MỤC II',
      textContent: 'Nội dung phụ lục II.',
    });
  });

  it('disambiguates a Khoản ordinal that collides with an already-open sibling via a counter suffix, without renaming its label — regression fixture for the "sửa đổi ... như sau: <quoted text>" shape confirmed live (07/2022/NĐ-CP): quoted replacement text restarts numbering at 1, independently of the amending Điều\'s own structure', () => {
    const fullText = [
      'Điều 1. Sửa đổi, bổ sung một số điều',
      '1. Sửa đổi, bổ sung một số khoản của Điều 3 như sau:',
      '1. Phạt tiền từ 1.000.000 đồng đến 5.000.000 đồng.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1',
      label: 'Khoản 1',
      textContent: 'Sửa đổi, bổ sung một số khoản của Điều 3 như sau:',
    });
    // The path-disambiguating suffix lives only on `ordinal` (what
    // document-node.repository.ts builds the ltree path from) — `label`
    // stays "Khoản 1", faithful to what the source text literally says.
    expect(dieu.children[1]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1_2',
      label: 'Khoản 1',
      textContent: 'Phạt tiền từ 1.000.000 đồng đến 5.000.000 đồng.',
    });
  });
});
