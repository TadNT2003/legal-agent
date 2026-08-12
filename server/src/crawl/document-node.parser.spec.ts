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

  it('§12b fix: suppresses an embedded data table (header vocabulary Thứ tự/Loại đất, no "Đơn vị tính:") instead of misreading its rows as Khoản numbering, confirmed against real vbpl.vn output (10/2007/NQ-CP)', () => {
    const fullText = [
      'Điều 2. Xét duyệt kế hoạch sử dụng đất',
      '1. Diện tích các loại đất:',
      'Thứ tự',
      'Loại đất',
      'Diện tích (ha)',
      '1',
      'Đất nông nghiệp',
      '1.234',
      '2',
      'Đất phi nông nghiệp',
      '567',
      'Điều 3. Tổ chức thực hiện',
      'Ủy ban nhân dân thành phố có trách nhiệm thực hiện.',
    ].join('\n');

    const [dieu2, dieu3] = parseDocumentBody(fullText);

    expect(dieu2.children).toHaveLength(1);
    expect(dieu2.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1',
      label: 'Khoản 1',
    });
    expect(dieu2.children[0].textContent).toBe(
      [
        'Diện tích các loại đất:',
        'Thứ tự',
        'Loại đất',
        'Diện tích (ha)',
        '1',
        'Đất nông nghiệp',
        '1.234',
        '2',
        'Đất phi nông nghiệp',
        '567',
      ].join('\n'),
    );
    // The table suppression must not leak past the next real Điều.
    expect(dieu3).toMatchObject({
      nodeType: 'dieu',
      ordinal: '3',
      textContent: 'Ủy ban nhân dân thành phố có trách nhiệm thực hiện.',
    });
  });

  it('§12b fix: recognizes the case-sensitive STT/TT column-header abbreviations as a table trigger', () => {
    const fullText = [
      'Điều 5. Biểu thuế suất',
      '1. Mức thuế suất áp dụng như sau:',
      'STT',
      'Mức thuế',
      '1',
      '10%',
      '2',
      '15%',
      'Điều 6. Hiệu lực thi hành',
    ].join('\n');

    const [dieu5, dieu6] = parseDocumentBody(fullText);

    expect(dieu5.children).toHaveLength(1);
    expect(dieu5.children[0].ordinal).toBe('1');
    expect(dieu6.ordinal).toBe('6');
  });

  it('§12c fix: suppresses a quoted target Khoản (curly quotes) instead of letting its own numbering collide with a sibling, confirmed against real vbpl.vn output (07/2022/NĐ-CP)', () => {
    const fullText = [
      'Điều 1. Sửa đổi, bổ sung một số điều',
      '1. Sửa đổi, bổ sung một số khoản của Điều 3 như sau:',
      'a) Sửa đổi, bổ sung khoản 3 như sau:',
      '“3. Sản phẩm của động vật rừng.”',
      'b) Bổ sung khoản 8 như sau:',
      '“8. Động vật hoang dã trên cạn khác.”',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    expect(dieu.children).toHaveLength(1);
    const khoan1 = dieu.children[0];
    expect(khoan1).toMatchObject({ nodeType: 'khoan', ordinal: '1' });
    // Real structure (the citing document's own a)/b) list) is preserved —
    // only the quoted target Khoản numbering inside each is suppressed.
    expect(khoan1.children).toHaveLength(2);
    expect(khoan1.children[0]).toMatchObject({
      nodeType: 'diem',
      ordinal: 'a',
      textContent:
        'Sửa đổi, bổ sung khoản 3 như sau:\n“3. Sản phẩm của động vật rừng.”',
    });
    expect(khoan1.children[1]).toMatchObject({
      nodeType: 'diem',
      ordinal: 'b',
      textContent:
        'Bổ sung khoản 8 như sau:\n“8. Động vật hoang dã trên cạn khác.”',
    });
  });

  it('§12c fix: suppresses a quoted target Điều (straight quotes, no "như sau" wording) instead of opening it as a fake sibling root, confirmed against real vbpl.vn output (12/1999/QH10)', () => {
    const fullText = [
      'Điều 1. Sửa đổi Luật Báo chí',
      '10. Bổ sung Điều 17c:',
      '"Điều 17c. Tài chính của cơ quan báo chí',
      'Cơ quan báo chí được Nhà nước cấp kinh phí."',
      '11. Điều khoản thi hành',
    ].join('\n');

    const roots = parseDocumentBody(fullText);

    // No fake "Điều 17c" root — the quoted heading line must not open a real
    // dieu-level node just because it's shaped like one.
    expect(roots).toHaveLength(1);
    const [dieu1] = roots;
    expect(dieu1.children).toHaveLength(2);
    expect(dieu1.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '10',
    });
    expect(dieu1.children[0].textContent).toBe(
      'Bổ sung Điều 17c:\n"Điều 17c. Tài chính của cơ quan báo chí\nCơ quan báo chí được Nhà nước cấp kinh phí."',
    );
    expect(dieu1.children[1]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '11',
    });
  });

  it('§16 fix: normalizes Unicode-NFD scraped text to NFC before matching, so a decomposed "Điều 6." heading still opens its own node instead of being absorbed into the previous Điều, confirmed against real vbpl.vn output (368/2025/NĐ-CP)', () => {
    const fullTextNfc = [
      'Điều 5. Đồng tiền sử dụng trong giao dịch',
      '1. Các giao dịch thực hiện qua tài khoản Tiền di động phải được thực hiện bằng Đồng Việt Nam.',
      'Điều 6. Các hành vi bị cấm',
      '1. Cung ứng hoặc sử dụng tài khoản Tiền di động để thực hiện các nghiệp vụ khác.',
    ].join('\n');
    // Simulates the real bug: vbpl.vn served this document's DOM text with
    // combining diacritics decomposed (NFD) rather than precomposed (NFC).
    // .normalize('NFD') reproduces that byte shape from an ordinary NFC
    // source string, so this fixture doesn't need hand-typed decomposed
    // Unicode literals.
    const fullTextNfd = fullTextNfc.normalize('NFD');
    expect(fullTextNfd).not.toBe(fullTextNfc); // sanity: the fixture is actually NFD

    const roots = parseDocumentBody(fullTextNfd);

    expect(roots).toHaveLength(2);
    expect(roots[0]).toMatchObject({ nodeType: 'dieu', ordinal: '5' });
    expect(roots[1]).toMatchObject({
      nodeType: 'dieu',
      ordinal: '6',
      heading: 'Các hành vi bị cấm',
    });
    expect(roots[0].children).toHaveLength(1);
    expect(roots[1].children).toHaveLength(1);
  });

  it("corrects a source-data quirk — a quoted §12c block closed with '' (doubled apostrophe) instead of any recognized quote character — to a matching straight \", so quote-depth tracking closes correctly instead of swallowing the rest of the document, confirmed against real vbpl.vn output (02/2002/QH11)", () => {
    const fullText = [
      'Điều 1. Sửa đổi, bổ sung',
      '2. Điều 3 được sửa đổi, bổ sung như sau:',
      '"Điều 3. Tham gia góp ý kiến xây dựng văn bản',
      '1. Mặt trận Tổ quốc Việt Nam có quyền tham gia góp ý kiến.',
      "2. Ý kiến tham gia phải được nghiên cứu để tiếp thu.''",
      '3. Điều 9 được sửa đổi, bổ sung như sau:',
      'Nội dung khoản ba thật.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    // Only the 2 real Khoản (2, 3) — the quoted target Điều 3's own "1."/"2."
    // never opens as real siblings, and structural parsing resumes cleanly
    // for Khoản 3 right after the '' (now ") closes the quote.
    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[0]).toMatchObject({ nodeType: 'khoan', ordinal: '2' });
    expect(dieu.children[0].textContent).toContain(
      '"Điều 3. Tham gia góp ý kiến xây dựng văn bản',
    );
    expect(dieu.children[0].textContent).toContain(
      '2. Ý kiến tham gia phải được nghiên cứu để tiếp thu."',
    );
    expect(dieu.children[1]).toMatchObject({ nodeType: 'khoan', ordinal: '3' });
    expect(dieu.children[1].textContent).toContain('Nội dung khoản ba thật.');
  });

  it('§12c fix: a multi-target citing sentence ("...thành các điều X, Xa và Xb như sau:") quoting several target Điều back-to-back stays suppressed across all of them, even though only the first quote-open follows a fresh citing colon, confirmed against real vbpl.vn output (02/2002/QH11 — Điều 45 revised into Điều 45/45a/45b)', () => {
    const fullText = [
      'Điều 1. Sửa đổi, bổ sung',
      '12. Điều 45 được sửa đổi, bổ sung thành các điều 45, 45a và 45b như sau:',
      '"Điều 45. Xem xét, thông qua dự án luật',
      "Quốc hội có thể xem xét, thông qua dự án luật tại một hoặc hai kỳ họp.''",
      '"Điều 45a. Trình tự xem xét tại một kỳ họp',
      '1. Đại diện cơ quan trình dự án thuyết trình về dự án;',
      "2. Đại diện cơ quan thẩm tra trình bày báo cáo thẩm tra.''",
      '"Điều 45b. Trình tự xem xét tại hai kỳ họp',
      "1. Tại kỳ họp thứ nhất.''",
      '13. Điều 46 được sửa đổi, bổ sung như sau:',
      'Nội dung điều 46 thật.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    // Only the 2 real Khoản (12, 13) — none of the quoted target Điều
    // 45/45a/45b, nor their own internal "1./2." lists, ever open as real
    // siblings despite each new quote reopening with no fresh citing colon.
    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '12',
    });
    expect(dieu.children[0].textContent).toContain('"Điều 45a.');
    expect(dieu.children[0].textContent).toContain('"Điều 45b.');
    expect(dieu.children[0].textContent).toContain(
      '2. Đại diện cơ quan thẩm tra trình bày báo cáo thẩm tra."',
    );
    expect(dieu.children[1]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '13',
    });
    expect(dieu.children[1].textContent).toContain('Nội dung điều 46 thật.');
  });

  it('§12c fix: does not suppress a citing sentence with no following quote (e.g. a bare "Bãi bỏ Điều N." with no replacement text)', () => {
    const fullText = [
      'Điều 5. Sửa đổi, bãi bỏ',
      '1. Bãi bỏ Điều 12 và Điều 13.',
      '2. Nội dung khoản hai.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1',
      textContent: 'Bãi bỏ Điều 12 và Điều 13.',
    });
    expect(dieu.children[1]).toMatchObject({ nodeType: 'khoan', ordinal: '2' });
  });

  it('root-restart fix: folds a promulgating decree\'s attached "QUY ĐỊNH" (whose own Điều numbering restarts at 1) into a generic annex instead of colliding with the decree\'s own Điều, confirmed against real vbpl.vn output (12-CP)', () => {
    const fullText = [
      'Điều 1. Ban hành kèm theo Nghị định này bản Quy định về sắp xếp lại tổ chức.',
      'Điều 2. Các bộ trưởng chịu trách nhiệm thi hành Nghị định này.',
      'Điều 3. Nghị định này thi hành kể từ ngày ký.',
      'QUY ĐỊNH',
      'VỀ SẮP XẾP LẠI TỔ CHỨC',
      '(Ban hành kèm theo Nghị định số 12-CP ngày 2-3-1993 của Chính phủ).',
      'Điều 1. Doanh nghiệp nông nghiệp Nhà nước bao gồm các đơn vị quốc doanh.',
      'Điều 2. Sắp xếp lại các doanh nghiệp theo hướng như sau:',
    ].join('\n');

    const roots = parseDocumentBody(fullText);

    // 3 real Điều from the decree itself, plus 1 generic-annex node holding
    // everything from the second "Điều 1" onward — not a 4th/5th colliding
    // "Điều 1"/"Điều 2".
    expect(roots).toHaveLength(4);
    expect(roots[0]).toMatchObject({ nodeType: 'dieu', ordinal: '1' });
    expect(roots[1]).toMatchObject({ nodeType: 'dieu', ordinal: '2' });
    expect(roots[2]).toMatchObject({ nodeType: 'dieu', ordinal: '3' });
    expect(roots[3].nodeType).toBe('phu_luc');
    expect(roots[3].textContent).toContain(
      'Điều 1. Doanh nghiệp nông nghiệp Nhà nước bao gồm các đơn vị quốc doanh.',
    );
    expect(roots[3].textContent).toContain(
      'Điều 2. Sắp xếp lại các doanh nghiệp theo hướng như sau:',
    );
  });

  it('root-restart fix: folds a verbatim-duplicated document (whole text repeated in place of a signature block) into a generic annex instead of re-opening a colliding Chương I, confirmed against real vbpl.vn output (364/2025/NĐ-CP)', () => {
    const fullText = [
      'Chương I',
      'QUY ĐỊNH CHUNG',
      'Điều 1. Phạm vi điều chỉnh và đối tượng áp dụng',
      'Nghị định này quy định mức thu phí sử dụng đường bộ.',
      'Điều 11. Tổ chức thực hiện',
      '1. Bộ Xây dựng có trách nhiệm hướng dẫn thực hiện.',
      'Chương I',
      'QUY ĐỊNH CHUNG',
      'Điều 1. Phạm vi điều chỉnh và đối tượng áp dụng',
      'Nghị định này quy định mức thu phí sử dụng đường bộ.',
    ].join('\n');

    const roots = parseDocumentBody(fullText);

    expect(roots).toHaveLength(2);
    expect(roots[0]).toMatchObject({ nodeType: 'chuong', ordinal: '1' });
    expect(roots[0].children.map((c) => c.ordinal)).toEqual(['1', '11']);
    expect(roots[1].nodeType).toBe('phu_luc');
    expect(roots[1].textContent).toContain('QUY ĐỊNH CHUNG');
    expect(roots[1].textContent).toContain(
      'Điều 1. Phạm vi điều chỉnh và đối tượng áp dụng',
    );
  });

  it('root-restart fix: a genuinely different Điều ordinal under a new Chương is not mistaken for a restart', () => {
    const fullText = [
      'Chương I',
      'Điều 1. Nội dung điều 1.',
      'Điều 2. Nội dung điều 2.',
      'Chương II',
      'Điều 3. Nội dung điều 3.',
    ].join('\n');

    const roots = parseDocumentBody(fullText);
    expect(roots).toHaveLength(2);
    expect(roots[0]).toMatchObject({ nodeType: 'chuong', ordinal: '1' });
    expect(roots[1]).toMatchObject({ nodeType: 'chuong', ordinal: '2' });
    expect(roots[1].children).toHaveLength(1);
    expect(roots[1].children[0]).toMatchObject({ ordinal: '3' });
  });

  it('root-restart fix: catches a restart nested inside an otherwise-legitimate Chương, not just at document root, confirmed against real vbpl.vn output (02/2026/NĐ-CP — "Điều 13" duplicated within the same real Chương II)', () => {
    const fullText = [
      'Chương I',
      'Điều 1. Nội dung điều 1.',
      'Chương II',
      'Điều 2. Nội dung điều 2.',
      'Điều 3. Nội dung điều 3.',
      'Điều 2. Nội dung điều 2 lặp lại, không liên quan đến điều 2 thật.',
    ].join('\n');

    const roots = parseDocumentBody(fullText);

    // Chương I and the real Chương II (with its real Điều 2/3) stay intact;
    // the duplicated inner "Điều 2" folds into a root-level annex instead of
    // colliding as a 3rd child of Chương II.
    expect(roots).toHaveLength(3);
    expect(roots[0]).toMatchObject({ nodeType: 'chuong', ordinal: '1' });
    expect(roots[1]).toMatchObject({ nodeType: 'chuong', ordinal: '2' });
    expect(roots[1].children.map((c) => c.ordinal)).toEqual(['2', '3']);
    expect(roots[2].nodeType).toBe('phu_luc');
    expect(roots[2].textContent).toContain(
      'Điều 2. Nội dung điều 2 lặp lại, không liên quan đến điều 2 thật.',
    );
  });

  it("§17 outer-grouping fix: preserves the first uppercase-letter category's own Khoản list as real structure, but suppresses subsequent categories' restarting lists instead of colliding, confirmed against real vbpl.vn output (174-CP)", () => {
    const fullText = [
      'Điều 1.- Nay quy định cơ cấu thành viên Uỷ ban nhân dân như sau:',
      'A. Uỷ ban nhân dân thành phố Hà Nội gồm có 1 Chủ tịch, 4 Phó Chủ tịch như sau:',
      '1. Chủ tịch phụ trách chung.',
      '2. Một Phó Chủ tịch phụ trách kinh tế.',
      'B. Uỷ ban nhân dân các tỉnh gồm có 1 Chủ tịch, 3 Phó Chủ tịch như sau:',
      '1. Chủ tịch phụ trách chung, nội chính.',
      '2. Một Phó Chủ tịch phụ trách kinh tế, tài chính.',
      'C. Uỷ ban nhân dân huyện gồm có 1 Chủ tịch, 2 Phó Chủ tịch như sau:',
      '1. Chủ tịch phụ trách chung, an ninh.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    // Category A's own list stays real structure (2 real Khoản).
    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1',
      textContent: 'Chủ tịch phụ trách chung.',
    });
    expect(dieu.children[1]).toMatchObject({ nodeType: 'khoan', ordinal: '2' });
    expect(dieu.children[1].textContent).toMatch(
      /^Một Phó Chủ tịch phụ trách kinh tế\./,
    );
    // Categories B and C (their own restarting "1./2." lists) are folded
    // into the last real node's text instead of colliding as fake Khoản 1/2
    // siblings.
    expect(dieu.children[1].textContent).toContain(
      'B. Uỷ ban nhân dân các tỉnh gồm có 1 Chủ tịch, 3 Phó Chủ tịch như sau:',
    );
    expect(dieu.children[1].textContent).toContain(
      '1. Chủ tịch phụ trách chung, nội chính.',
    );
    expect(dieu.children[1].textContent).toContain(
      'C. Uỷ ban nhân dân huyện gồm có 1 Chủ tịch, 2 Phó Chủ tịch như sau:',
    );
  });

  it('§17 outer-grouping fix: also recognizes a roman-numeral (not just single-letter) category marker, confirmed against real vbpl.vn output (55-CP, 487-NQ/QHK4 — tax-rate schedules organized by industry)', () => {
    const fullText = [
      'Điều 1. Biểu thuế suất',
      'I. Ngành công nghiệp',
      '1. Sản xuất hàng dệt.',
      '2. Sản xuất hàng cơ khí.',
      'II. Ngành xây dựng',
      '1. Có bao thầu nguyên vật liệu.',
      'III. Ngành vận tải',
      '1. Vận tải hàng hoá.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    // Category I's own list stays real structure (2 real Khoản).
    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1',
      textContent: 'Sản xuất hàng dệt.',
    });
    expect(dieu.children[1]).toMatchObject({ nodeType: 'khoan', ordinal: '2' });
    expect(dieu.children[1].textContent).toContain('II. Ngành xây dựng');
    expect(dieu.children[1].textContent).toContain('III. Ngành vận tải');
    expect(dieu.children[1].textContent).toContain(
      '1. Có bao thầu nguyên vật liệu.',
    );
  });

  it('§17 outer-grouping fix: also recognizes a hyphen-separated (not just period) roman-numeral category marker, confirmed against real vbpl.vn output (487-NQ/QHK4 — "I- Đồ ăn uống, thuốc hút")', () => {
    const fullText = [
      'Điều 19',
      'BIỂU THUẾ',
      'I- Đồ ăn uống, thuốc hút',
      '1. Dầu ăn 10',
      '2. Miến 10',
      'II- Vải sợi, hàng dệt',
      '1. Vải bông 8',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1',
      textContent: 'Dầu ăn 10',
    });
    expect(dieu.children[1]).toMatchObject({ nodeType: 'khoan', ordinal: '2' });
    expect(dieu.children[1].textContent).toContain('II- Vải sợi, hàng dệt');
    expect(dieu.children[1].textContent).toContain('1. Vải bông 8');
  });

  it("suppresses an amendment-annotated Khoản only when it would actually collide with an existing sibling, confirmed against real vbpl.vn output (47/2024/QH15, Điều 35 — Khoản 2/3 belonging to a different, earlier Điều linearized right after Điều 35's own real Khoản 1-4)", () => {
    const fullText = [
      'Điều 35. Quy hoạch chuyên ngành hạ tầng kỹ thuật',
      '1. Nội dung khoản một thật.',
      '2. Nội dung khoản hai thật.',
      '3. Nội dung khoản ba thật.',
      '4. Thời hạn của quy hoạch chuyên ngành hạ tầng kỹ thuật.',
      'Điều khoản được sửa đổi, bổ sung',
      '2. Các bản vẽ thể hiện nội dung của quy hoạch không gian ngầm.',
      'Điều khoản được sửa đổi, bổ sung',
      '3. Các bản vẽ thể hiện nội dung của quy hoạch chuyên ngành hạ tầng kỹ thuật.',
      'Mục 6',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    // Only the 4 real Khoản — the two annotated ones collide with Khoản
    // 2/3 that already exist, so they fold into Khoản 4's text instead.
    expect(dieu.children).toHaveLength(4);
    expect(dieu.children.map((c) => c.ordinal)).toEqual(['1', '2', '3', '4']);
    expect(dieu.children[3].textContent).toContain(
      'Điều khoản được sửa đổi, bổ sung',
    );
    expect(dieu.children[3].textContent).toContain(
      '2. Các bản vẽ thể hiện nội dung của quy hoạch không gian ngầm.',
    );
    expect(dieu.children[3].textContent).toContain(
      '3. Các bản vẽ thể hiện nội dung của quy hoạch chuyên ngành hạ tầng kỹ thuật.',
    );
  });

  it('does not suppress a correctly-placed annotated Khoản that does not collide with anything', () => {
    const fullText = [
      'Điều 5. Sửa đổi',
      '1. Nội dung khoản một.',
      'Điều khoản được sửa đổi, bổ sung',
      '2. Nội dung khoản hai, đặt đúng chỗ, không trùng lặp.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[1]).toMatchObject({ nodeType: 'khoan', ordinal: '2' });
  });

  it('suppresses an amendment-annotated Điểm that would collide, the same way as Khoản, confirmed against real vbpl.vn output (117/2020/NĐ-CP — a "b)" belonging to misplaced amendment content colliding with the real Điểm b)', () => {
    const fullText = [
      'Điều 8. Hình thức xử phạt',
      '1. Các hình thức xử phạt:',
      'a) Cảnh cáo;',
      'b) Phạt tiền.',
      'Điều khoản được sửa đổi, bổ sung',
      'b) Tịch thu tang vật, phương tiện vi phạm hành chính có giá trị không vượt quá mức phạt tiền.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    const khoan1 = dieu.children[0];
    expect(khoan1.children).toHaveLength(2);
    expect(khoan1.children[1]).toMatchObject({
      nodeType: 'diem',
      ordinal: 'b',
    });
    expect(khoan1.children[1].textContent).toMatch(/^Phạt tiền\./);
    expect(khoan1.children[1].textContent).toContain(
      'Tịch thu tang vật, phương tiện vi phạm hành chính',
    );
  });

  it('§12b fix: suppresses a table row with no recoverable header — a bare thousands-separated number fragment on its own line, confirmed against real vbpl.vn output (17/2006/NQ-CP)', () => {
    const fullText = [
      'Điều 1. Phê duyệt điều chỉnh quy hoạch',
      '1. Diện tích các loại đất:',
      '1.2.2',
      'Đất có rừng phòng hộ',
      '3.401',
      '3.451',
      '3.491',
      'Điều 2. Tổ chức thực hiện',
      'Nội dung điều 2.',
    ].join('\n');

    const roots = parseDocumentBody(fullText);

    expect(roots).toHaveLength(2);
    const [dieu1, dieu2] = roots;
    expect(dieu1.children).toHaveLength(1);
    expect(dieu1.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1',
    });
    expect(dieu1.children[0].textContent).toContain('1.2.2');
    expect(dieu1.children[0].textContent).toContain('3.451');
    expect(dieu2).toMatchObject({
      nodeType: 'dieu',
      ordinal: '2',
      textContent: 'Nội dung điều 2.',
    });
  });

  it('§12b fix: suppresses a flattened multi-column table row (tab-separated) even though it starts with real text, confirmed against real vbpl.vn output (20/2006/NQ-CP)', () => {
    const fullText = [
      'Điều 1. Phê duyệt điều chỉnh quy hoạch',
      '1. Diện tích các loại đất:',
      '1.1.1\tĐất trồng cây hàng năm\t58.745,60\t62,71\t56.699,83',
      '2\tĐất lâm nghiệp\t165.106,51\t62,21\t179.883,78',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);

    expect(dieu.children).toHaveLength(1);
    expect(dieu.children[0]).toMatchObject({ nodeType: 'khoan', ordinal: '1' });
    expect(dieu.children[0].textContent).toContain('Đất trồng cây hàng năm');
    expect(dieu.children[0].textContent).toContain('Đất lâm nghiệp');
  });

  it('§12b fix: a genuine short Khoản is not mistaken for a table fragment', () => {
    const fullText = ['Điều 1. Nội dung', '1. Có hiệu lực.', '2. Bãi bỏ.'].join(
      '\n',
    );

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu.children).toHaveLength(2);
    expect(dieu.children[0]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '1',
      textContent: 'Có hiệu lực.',
    });
    expect(dieu.children[1]).toMatchObject({
      nodeType: 'khoan',
      ordinal: '2',
      textContent: 'Bãi bỏ.',
    });
  });

  it('§18 fix: relabels a second "d)" as "đ)" when đ never appears elsewhere in the list, confirmed against real vbpl.vn output (113/2025/NĐ-CP: "d) Riêng biệt với DC." / "d) Kết nối kỹ thuật để đồng bộ dữ liệu với DC." / "e) Đủ năng lực...")', () => {
    const fullText = [
      'Điều 1. Nội dung',
      '1. Trung tâm dữ liệu dự phòng',
      'c) Cho phép thiết lập cơ chế nhân bản dữ liệu.',
      'd) Riêng biệt với DC.',
      'd) Kết nối kỹ thuật để đồng bộ dữ liệu với DC.',
      'e) Đủ năng lực công nghệ và năng lực lưu trữ.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    const diem = dieu.children[0].children;
    expect(diem.map((d) => d.ordinal)).toEqual(['c', 'd', 'đ', 'e']);
    expect(diem[2]).toMatchObject({
      label: 'Điểm đ',
      textContent: 'Kết nối kỹ thuật để đồng bộ dữ liệu với DC.',
    });
  });

  it('§18 fix: relabels a doubled "đ)" as "d)" + "đ)" when d never appears elsewhere in the list — the mirror shape, confirmed against real vbpl.vn output (103/2016/NĐ-CP: "c) Riêng biệt..." / "đ) Phòng xét nghiệm phải kín..." / "đ) Cửa sổ và cửa ra vào..." / "e) Hệ thống...")', () => {
    const fullText = [
      'Điều 1. Nội dung',
      '1. Điều kiện về cơ sở vật chất',
      'c) Riêng biệt với các phòng xét nghiệm khác.',
      'đ) Phòng xét nghiệm phải kín để bảo đảm tiệt trùng.',
      'đ) Cửa sổ và cửa ra vào phải sử dụng vật liệu chống cháy.',
      'e) Hệ thống cửa ra vào bảo đảm điều kiện bình thường.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    const diem = dieu.children[0].children;
    expect(diem.map((d) => d.ordinal)).toEqual(['c', 'd', 'đ', 'e']);
    expect(diem[1]).toMatchObject({
      label: 'Điểm d',
      textContent: 'Phòng xét nghiệm phải kín để bảo đảm tiệt trùng.',
    });
    expect(diem[2]).toMatchObject({
      label: 'Điểm đ',
      textContent: 'Cửa sổ và cửa ra vào phải sử dụng vật liệu chống cháy.',
    });
  });

  it('§18 fix: does not relabel a "d)" collision when đ is already used elsewhere in the same list — a different, unrelated duplicate', () => {
    const fullText = [
      'Điều 1. Nội dung',
      '1. Điều kiện',
      'c) Điều kiện c.',
      'd) Điều kiện d thật.',
      'đ) Điều kiện đ thật.',
      'd) Một điều kiện khác trùng lặp không rõ nguyên nhân.',
      'e) Điều kiện e.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    const diem = dieu.children[0].children;
    expect(diem.map((d) => d.ordinal)).toEqual(['c', 'd', 'đ', 'd_2', 'e']);
  });

  it('§19 fix: recognizes a hyphen-separated Khoản header ("N- ..."), confirmed against real vbpl.vn output (73-CP, a pre-1990s document: "2- Những người nước ngoài..." / "3- Những đối tượng...")', () => {
    const fullText = [
      'Điều 13. -',
      '1. Bộ Ngoại giao làm thủ tục cấp phép đăng ký cư trú.',
      'a) Viên chức, nhân viên của các cơ quan Đại diện ngoại giao.',
      '2- Những người nước ngoài sau đây được miễn thủ tục đăng ký lưu trú.',
      'a) Thành viên của các Đoàn đại biểu cấp cao nước ngoài.',
      '3- Những đối tượng nói tại khoản 2 Điều này nếu cần kéo dài thời gian.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu.children.map((c) => c.ordinal)).toEqual(['1', '2', '3']);
    expect(dieu.children[1].textContent).toBe(
      'Những người nước ngoài sau đây được miễn thủ tục đăng ký lưu trú.',
    );
    // Each Khoản's own "a)" Điểm is real structure, not a collision.
    expect(dieu.children[0].children.map((d) => d.ordinal)).toEqual(['a']);
    expect(dieu.children[1].children.map((d) => d.ordinal)).toEqual(['a']);
  });

  it('§19 fix: does not misread an inline number range ("3-4 người") as a Khoản header', () => {
    const fullText = [
      'Điều 1. Nội dung',
      '1. Nhu cầu nhân sự.',
      '3-4 người tham gia mỗi ca trực theo quy định.',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    expect(dieu.children).toHaveLength(1);
    expect(dieu.children[0].textContent).toContain(
      '3-4 người tham gia mỗi ca trực theo quy định.',
    );
  });

  it('suppresses an amendment-annotated Điểm after a "Điều khoản được bãi bỏ" (repealed) annotation, the same way as "được sửa đổi, bổ sung", confirmed against real vbpl.vn output (133/2016/NĐ-CP — a repealed "a) Trường cao đẳng" linearized after Điều 7\'s real Khoản 3 collides with its real Điểm a)', () => {
    const fullText = [
      'Điều 7. Cơ sở giáo dục đại học',
      '3. Cơ sở giáo dục đại học có vốn đầu tư nước ngoài gồm:',
      'a) Cơ sở giáo dục đại học có 100% vốn của nhà đầu tư nước ngoài;',
      'b) Cơ sở giáo dục đại học liên doanh giữa nhà đầu tư nước ngoài và nhà đầu tư trong nước.',
      'Điều khoản được bãi bỏ',
      'a) Trường cao đẳng;',
    ].join('\n');

    const [dieu] = parseDocumentBody(fullText);
    const khoan3 = dieu.children[0];
    expect(khoan3.children).toHaveLength(2);
    expect(khoan3.children[1].textContent).toMatch(
      /^Cơ sở giáo dục đại học liên doanh/,
    );
    expect(khoan3.children[1].textContent).toContain('Trường cao đẳng');
  });
});
