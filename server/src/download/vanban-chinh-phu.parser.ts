import * as cheerio from 'cheerio';
import { VANBANCHINHPHU_BASE_URL } from './constants';
import type {
  ParsedLawDocument,
  SearchResultRow,
} from './parsed-law-document.interface';

export interface SearchFormControls {
  category: string;
  org: string;
  year: string;
  recordsPerPage: string;
  keyword: string;
  searchButton: string;
  gridView: string;
}

/** One <option value="...">label</option> from a search-form <select>. */
export interface SearchFormOption {
  value: string;
  label: string;
}

export interface ParsedSearchPage {
  hiddenFields: Record<string, string>;
  controls: SearchFormControls | null;
  rows: SearchResultRow[];
  shownCount: number | null;
  totalCount: number | null;
  /**
   * The "Cơ quan ban hành" (drdDocOrg) dropdown's own option list — unlike
   * "Năm ban hành" (drdDocYear, confirmed live: value equals the visible
   * year, e.g. `<option value="2025">2025</option>`, so no lookup is needed
   * there), drdDocOrg's option value is an opaque internal id unrelated to
   * the label text (confirmed live, e.g. `<option value="1">Quốc hội
   * </option>`) — a caller wanting to filter by org name has to resolve it
   * against this list first. Not guaranteed unique by label: the live list
   * has at least one body appearing under more than one id (an
   * administrative rename/reorg over time, e.g. "Ban Chỉ đạo cải cách hành
   * chính của Chính phủ" at both 14578 and 15459) — same kind of
   * upstream-data-quality issue documented for vbpl.vn's own agency list
   * (docs/monitoring/law-index-flagged-documents.md).
   */
  orgOptions: SearchFormOption[];
}

/** Normalizes both "DD-MM-YYYY" (detail page) and "DD/MM/YYYY" (listing) to DD/MM/YYYY. */
export function normalizeDate(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return trimmed;
  const [, day, month, year] = match;
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
}

function parseHiddenFields($: cheerio.CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $('input[type=hidden]').each((_, el) => {
    const $el = $(el);
    const name = $el.attr('name');
    if (name) fields[name] = $el.attr('value') ?? '';
  });
  return fields;
}

function findControlName(
  $: cheerio.CheerioAPI,
  idSuffix: string,
): string | null {
  return $(`[id$="${idSuffix}"]`).first().attr('name') ?? null;
}

/** Every <option value="...">label</option> under the <select> whose id ends in idSuffix — used for drdDocOrg (see ParsedSearchPage.orgOptions). The "-- Tất cả --" placeholder option (value="0") is excluded — it isn't a real org to match against. */
function parseSelectOptions(
  $: cheerio.CheerioAPI,
  idSuffix: string,
): SearchFormOption[] {
  const options: SearchFormOption[] = [];
  $(`select[id$="${idSuffix}"] option`).each((_, el) => {
    const $el = $(el);
    const value = $el.attr('value');
    const label = $el.text().trim();
    if (value && value !== '0' && label) options.push({ value, label });
  });
  return options;
}

export function parseSearchPage(html: string): ParsedSearchPage {
  const $ = cheerio.load(html);
  const hiddenFields = parseHiddenFields($);

  const category = findControlName($, '_drdDocCategory');
  const org = findControlName($, '_drdDocOrg');
  const year = findControlName($, '_drdDocYear');
  const recordsPerPage = findControlName($, '_drdRecordPerPage');
  const keyword = findControlName($, '_txtSearchKeyword');
  const searchButton = findControlName($, '_btnSearch');
  const gridView = $('table[id$="_grvDocument"]').attr('id') ?? null;
  const controls =
    category &&
    org &&
    year &&
    recordsPerPage &&
    keyword &&
    searchButton &&
    gridView
      ? {
          category,
          org,
          year,
          recordsPerPage,
          keyword,
          searchButton,
          gridView: gridView.replace(/_grvDocument$/, '$grvDocument'),
        }
      : null;

  const rows: SearchResultRow[] = [];
  $('table[id$="_grvDocument"] tr').each((i, tr) => {
    if (i === 0) return; // header row
    const $tr = $(tr);
    const tds = $tr.find('td');
    if (tds.length < 3) return;
    const citation = $(tds[0]).find('span.code').text().trim();
    if (!citation) return;
    const docHref = $(tds[0]).find('a').attr('href') ?? null;
    const date =
      $(tds[1]).find('span.issued-date').first().text().trim() || null;
    const title = $(tds[2]).find('span.substract').text().trim();
    const fileUrls: string[] = [];
    $(tds[2])
      .find('div.bl-doc-file a')
      .each((_, a) => {
        const href = $(a).attr('href');
        if (href) fileUrls.push(href);
      });
    rows.push({
      citation,
      title,
      date: normalizeDate(date),
      docUrl: docHref
        ? new URL(docHref, VANBANCHINHPHU_BASE_URL).toString()
        : null,
      fileUrls,
    });
  });

  const pageInfoText = $('#document_page_info').text().trim();
  const pageInfoMatch = pageInfoText.match(/(\d+)\s*-\s*(\d+)\s*\|\s*(\d+)/);
  const shownCount = pageInfoMatch ? parseInt(pageInfoMatch[2], 10) : null;
  const totalCount = pageInfoMatch ? parseInt(pageInfoMatch[3], 10) : null;

  const orgOptions = parseSelectOptions($, '_drdDocOrg');

  return {
    hiddenFields,
    controls,
    rows,
    shownCount,
    totalCount,
    orgOptions,
  };
}

export function parseDocumentDetailPage(
  html: string,
  sourceUrl: string,
): ParsedLawDocument | null {
  const $ = cheerio.load(html);
  const meta: Record<string, string> = {};
  $('div.Content td.col1').each((_, td) => {
    const label = $(td).text().trim();
    const value = $(td).next('td').text().trim();
    if (label) meta[label] = value;
  });

  const citation = meta['Số ký hiệu'];
  if (!citation) return null;

  const fileUrls: string[] = [];
  $('div.Content a.view-file').each((_, a) => {
    const href = $(a).attr('href');
    if (href) fileUrls.push(href);
  });

  return {
    citation,
    title: meta['Trích yếu'] ?? '',
    date: normalizeDate(meta['Ngày ban hành']),
    docType: meta['Loại văn bản'] ?? null,
    issuingBody: meta['Cơ quan ban hành'] ?? null,
    signerName: meta['Người ký'] ?? null,
    signerTitle: meta['Chức danh'] ?? null,
    sourceUrl,
    fileUrls,
  };
}
