import {
  normalizeDate,
  parseDocumentDetailPage,
  parseSearchPage,
} from './vanban-chinh-phu.parser';

const SEARCH_PAGE_HTML = `
<html><body>
<form id="form1">
  <input type="hidden" name="__VIEWSTATE" value="abc123" />
  <input type="hidden" name="__EVENTTARGET" value="" />
  <input type="hidden" name="__EVENTARGUMENT" value="" />
  <select name="ctrl_1$drdDocCategory" id="ctrl_1_drdDocCategory"><option value="0">-- Tất cả --</option></select>
  <select name="ctrl_1$drdDocOrg" id="ctrl_1_drdDocOrg"><option value="0">-- Tất cả --</option></select>
  <select name="ctrl_1$drdDocYear" id="ctrl_1_drdDocYear"><option value="0">-- Tất cả --</option></select>
  <select name="ctrl_1$drdRecordPerPage" id="ctrl_1_drdRecordPerPage"><option value="50">50</option></select>
  <input name="ctrl_1$txtSearchKeyword" id="ctrl_1_txtSearchKeyword" type="text" />
  <input type="submit" name="ctrl_1$btnSearch" id="ctrl_1_btnSearch" value="Tìm kiếm" />
  <table id="ctrl_1_grvDocument">
    <tr><th>Số ký hiệu</th><th>Ngày ban hành</th><th>Trích yếu</th></tr>
    <tr>
      <td><a href='/?pageid=27160&docid=1'><span class="code">45/2019/QH14</span></a></td>
      <td><span class="issued-date">20/11/2019</span></td>
      <td>
        <a href='/?pageid=27160&docid=1'><span class="substract">Bộ luật Lao động</span></a>
        <div class="bl-doc-files">
          <div class="bl-doc-file"><a href="https://datafiles.chinhphu.vn/cpp/files/45qh14.pdf">Tài liệu đính kèm</a></div>
        </div>
      </td>
    </tr>
  </table>
  <div id="document_page_info">1 - 1 | 1</div>
</form>
</body></html>`;

const DETAIL_PAGE_HTML = `
<html><body>
<div class="Content">
  <table>
    <tr><td class="col1">Số ký hiệu</td><td>45/2019/QH14</td></tr>
    <tr><td class="col1">Ngày ban hành</td><td>20-11-2019</td></tr>
    <tr><td class="col1">Loại văn bản</td><td>Bộ luật</td></tr>
    <tr><td class="col1">Cơ quan ban hành</td><td>Quốc hội</td></tr>
    <tr><td class="col1">Trích yếu</td><td>Bộ luật Lao động</td></tr>
    <tr class="doc-list">
      <td class="col1">Tài liệu đính kèm</td>
      <td><a href="https://datafiles.chinhphu.vn/cpp/files/45qh14.pdf" class="view-file" download>45qh14.pdf</a></td>
    </tr>
  </table>
</div>
</body></html>`;

describe('normalizeDate', () => {
  it('converts dash-separated dates to slash-separated', () => {
    expect(normalizeDate('20-11-2019')).toBe('20/11/2019');
  });

  it('leaves already-slashed dates as-is', () => {
    expect(normalizeDate('20/11/2019')).toBe('20/11/2019');
  });

  it('returns null for empty input', () => {
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate(null)).toBeNull();
  });
});

describe('parseSearchPage', () => {
  it('extracts hidden fields, form control names, and result rows', () => {
    const result = parseSearchPage(SEARCH_PAGE_HTML);

    expect(result.hiddenFields.__VIEWSTATE).toBe('abc123');
    expect(result.controls).toEqual({
      category: 'ctrl_1$drdDocCategory',
      org: 'ctrl_1$drdDocOrg',
      year: 'ctrl_1$drdDocYear',
      recordsPerPage: 'ctrl_1$drdRecordPerPage',
      keyword: 'ctrl_1$txtSearchKeyword',
      searchButton: 'ctrl_1$btnSearch',
      gridView: 'ctrl_1$grvDocument',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      citation: '45/2019/QH14',
      title: 'Bộ luật Lao động',
      date: '20/11/2019',
      docUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=1',
      fileUrls: ['https://datafiles.chinhphu.vn/cpp/files/45qh14.pdf'],
    });

    expect(result.shownCount).toBe(1);
    expect(result.totalCount).toBe(1);
  });
});

describe('parseDocumentDetailPage', () => {
  it('extracts metadata and file links scoped to the detail content block', () => {
    const parsed = parseDocumentDetailPage(
      DETAIL_PAGE_HTML,
      'https://vanban.chinhphu.vn/?pageid=27160&docid=1',
    );

    expect(parsed).toEqual({
      citation: '45/2019/QH14',
      title: 'Bộ luật Lao động',
      date: '20/11/2019',
      docType: 'Bộ luật',
      issuingBody: 'Quốc hội',
      sourceUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=1',
      fileUrls: ['https://datafiles.chinhphu.vn/cpp/files/45qh14.pdf'],
    });
  });

  it('returns null when there is no citation to anchor on', () => {
    expect(
      parseDocumentDetailPage(
        '<html><body>nothing here</body></html>',
        'https://vanban.chinhphu.vn/x',
      ),
    ).toBeNull();
  });
});
