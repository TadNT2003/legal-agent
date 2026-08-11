// Turns a document's flat scraped `fullText` (vbpl.vn's Nội dung tab —
// plain innerText, no HTML structure retained, see vbpl-client.service.ts)
// into the Phần/Chương/Mục/Tiểu mục/Điều/Khoản/Điểm(/Phụ lục) tree that
// document-node.repository.ts persists as document_node rows. Pure
// functions, no DI/IO — mirrors vbpl.parser.ts's style.
//
// This is a best-effort v1 calibrated against the formatting rules in
// docs/vn-legal-document-structure.md (Điều 63/69, Nghị định 78/2025/NĐ-CP)
// and the one confirmed real fragment in this repo ("Điều 1. Phạm vi điều
// chỉnh...", vbpl.parser.spec.ts). There is no captured real vbpl.vn
// full-text sample anywhere in this repo to validate against beyond that —
// like mapValidityStatus/estimateAuthorityRank in document.repository.ts,
// expect this to need calibration once run against live scraped text.

export type DocumentNodeType =
  | 'phan'
  | 'chuong'
  | 'muc'
  | 'tieu_muc'
  | 'dieu'
  | 'khoan'
  | 'diem'
  | 'phu_luc';

export type ContentClass = 'normative' | 'template';

export interface ParsedDocumentNode {
  nodeType: DocumentNodeType;
  ordinal: string;
  label: string;
  heading: string | null;
  textContent: string | null;
  contentClass: ContentClass | null;
  children: ParsedDocumentNode[];
}

/** Sibling-order depth for the non-phụ-lục stack — a new heading at level L closes every currently-open node with level >= L. */
const LEVEL: Record<Exclude<DocumentNodeType, 'phu_luc'>, number> = {
  phan: 0,
  chuong: 1,
  muc: 2,
  tieu_muc: 3,
  dieu: 4,
  khoan: 5,
  diem: 6,
};

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

/** Standard subtractive-notation roman numeral -> arabic conversion. Returns the input unchanged if it isn't a valid roman numeral (already-arabic ordinals pass through untouched). */
export function romanToArabic(raw: string): string {
  const token = raw.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(token)) return raw;

  let total = 0;
  for (let i = 0; i < token.length; i++) {
    const current = ROMAN_VALUES[token[i]];
    const next = ROMAN_VALUES[token[i + 1]];
    if (next && current < next) {
      total -= current;
    } else {
      total += current;
    }
  }
  return String(total);
}

// Vietnamese alphabetic ordinal suffixes (Điều 69.4b, Nghị định
// 78/2025/NĐ-CP: inserted-provision letters follow "bảng chữ cái tiếng
// Việt"). Scoped to a-z/đ for this pass — real insertions overwhelmingly
// land in the first few letters (a, b, c); the full 24-letter Vietnamese
// alphabet (ă, â, ê, ô, ơ, ư, ...) is a follow-up if real data ever needs it.
//
// The separator after the ordinal is optional ([.:]?), not required —
// confirmed against real vbpl.vn output that a period isn't universal:
// older "Luật sửa đổi, bổ sung" amendment laws (spot-checked citations
// spanning 1997-2014) write a bare "Điều 1" (heading on the next line via
// resolveHeading), "Điều 1: <heading>" (colon), or "Điều 1 <heading>" (no
// punctuation at all, just whitespace) — a period-only pattern produced
// zero document_node rows for 17 real documents that do have real
// structure. Trade-off worth flagging: this makes a false match on a line
// that happens to *start* with an inline "Điều N" cross-reference
// ("Điều 5 của Luật này quy định...") marginally more likely than before,
// since punctuation immediately after the number is no longer required to
// disambiguate it from a real heading. Accepted for now — same best-effort/
// recalibrate-against-real-data posture as the rest of this parser.
const DIEU_KHOAN_PATTERN = /^Điều\s+(\d+)([a-zđ]?)\s*[.:]?\s*(.*)$/iu;
// §19 (docs/monitoring/law-index-flagged-documents.md): a period is the
// default Khoản separator, but some older documents (pre-1990s citation
// style, confirmed on 73-CP: "2- Những người nước ngoài...", "3- Những đối
// tượng...") use a hyphen instead — unrecognized, the whole Khoản heading
// silently fails to match and its content (including its own "a)"/"b)"
// Điểm list) gets absorbed into the still-open previous Khoản, colliding
// with that Khoản's real Điểm ordinals. The hyphen alternative requires at
// least one trailing space (unlike the period, which allows zero) to avoid
// misreading an inline number range like "3-4 người" — never seen with a
// following space in real prose — as a fake Khoản header.
const KHOAN_PATTERN = /^(\d+)([a-zđ]?)\s*(?:\.\s*|-\s+)(.*)$/u;
const DIEM_PATTERN = /^([a-zđ])\)\s*(.*)$/iu;

// §12b, generalized beyond header-vocabulary detection (TABLE_HEADER_PATTERN
// above still catches tables that DO have a recognizable header line; this
// catches the ones that don't). A KHOAN_PATTERN "match" whose own captured
// remainder is nothing but digits/periods/commas is never real Khoản
// prose — it's the tail of a Vietnamese thousands-separated number
// ("3.451" → ordinal "3", remainder "451") or a decimal classification code
// ("1.2.2" → ordinal "1", remainder "2.2"), confirmed on 17/2006/NQ-CP (each
// table cell scraped onto its own line). Separately, a candidate line
// containing a raw tab character is a flattened multi-column table row —
// real Vietnamese legal prose from this scrape is never tab-separated —
// confirmed on 20/2006/NQ-CP ("1.1.1\tĐất trồng cây hàng năm\t58.745,60\t...",
// a full row crammed onto one line). Either signature means this is a table
// fragment, not a Khoản, regardless of what (if any) header line precedes
// it — same "suppress, don't reconstruct" trade-off as everywhere else in
// this file: the whole line becomes inert body text on whatever node is
// currently open instead of opening (and colliding as) a fake Khoản.
function looksLikeTableFragment(line: string, khoanRemainder: string): boolean {
  return line.includes('\t') || /^[\d.,]+$/.test(khoanRemainder.trim());
}
const PHAN_CHUONG_PATTERN =
  /^(Phần|Chương)\s+([IVXLCDM]+|\d+)\b[.:]?\s*(.*)$/iu;
const MUC_PATTERN = /^(Mục)\s+(\d+)\b[.:]?\s*(.*)$/iu;
const TIEU_MUC_PATTERN = /^(Tiểu\s+mục)\s+(\d+)\b[.:]?\s*(.*)$/iu;
const PHU_LUC_PATTERN = /^(Phụ\s+lục)\s*([IVXLCDM]*)\b[.:]?\s*(.*)$/iu;

// Confirmed against real scraped vbpl.vn text: a văn bản "ban hành kèm
// theo" (a QCVN technical standard, a "Biểu số"/"Mẫu số" report-form
// annex) doesn't always call itself "Phụ lục" — PHU_LUC_PATTERN alone
// missed both real cases found in the first 50-document reindex (a QCVN
// annex restating its own Quốc hiệu "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"
// header per Điều 71, Nghị định 78/2025/NĐ-CP, and a "Biểu số 01.A" report
// form), both of which the footer-drop logic below silently swallowed
// whole. This only fires once already inFooter (see the main loop) — it's
// a re-open trigger for content genuinely attached after the signing
// block, not a general-purpose line matcher that could misfire on normal
// Điều body text.
// Anchored to match the WHOLE line (a standalone title/code, not a
// sentence that merely starts with one) — e.g. "QCVN 01:2026/BXD" alone
// matches, but "QCVN 01:2026/BXD do Viện Quy hoạch..." (a self-citation
// inside the annex's own running prose, confirmed appearing repeatedly in
// real QCVN body text) does not.
const ANNEX_RESTART_PATTERN =
  /^(?:CỘNG\s+HÒA\s+XÃ\s+HỘI\s+CHỦ\s+NGHĨA\s+VIỆT\s+NAM|(?:Biểu\s+(?:số|mẫu)|Mẫu\s+số|QCVN|TCVN)\s*[\dA-ZĐ][\dA-ZĐ.:/-]*)\s*$/iu;

// Điều 71 khoản 2 h-k, Nghị định 78/2025/NĐ-CP (chữ ký/dấu/nơi nhận) —
// database-design.md §1a: this administrative/signature block has no
// retrieval value and is explicitly designed to stay in raw_source only,
// never as document_node content. Confirmed on real scraped vbpl.vn text
// (both a "Nơi nhận:" distribution list and a bare "TM./KT. <title>"
// attribution line reliably mark the start of it, immediately after the
// last Điều's substantive content and before any Phụ lục). Once seen, every
// line is dropped until a Phụ lục heading (handled separately) or the end
// of the text.
const FOOTER_START_PATTERN = /^(Nơi\s+nhận\s*:?|(TM|KT|Q)\.\s|THAY\s+MẶT\b)/iu;

// §12b (docs/monitoring/law-index-flagged-documents.md): embedded data
// tables (land-use-planning statistics, tax-bracket schedules, tariff
// schedules, station registries, ...) get flattened to plain text by the
// scrape, and their header row / numeric cells match KHOAN_PATTERN's
// "<digits>." shape (Vietnamese uses "." as a thousands separator), each
// producing a fake Khoản node. Detected by a standalone header-row line
// rather than by row shape — a row's own text (a bare number, a short
// place/category name) is indistinguishable from a genuine short Khoản,
// but a real Khoản is never just "Thứ tự" or "Đơn vị tính: ha" on its own
// line. Vocabulary harvested from real affected documents (see §12's
// 2026-08-07/08 updates), not exhaustive — a table using none of these
// words falls back to the dedupeOrdinal backstop below (uniqueness-safe,
// not actually suppressed).
const TABLE_HEADER_PATTERN =
  /^(?:Đơn\s+vị\s+tính|Thứ\s+tự|Số\s+thứ\s+tự|Loại\s+đất|Bậc)\s*[:.]?\s*.{0,30}$/iu;
// STT/TT checked case-sensitively (uppercase only) — as a bare 2-3 letter
// lowercase match these would be far too promiscuous against ordinary text.
const TABLE_HEADER_ABBREV_PATTERN = /^(?:STT|TT)\s*[:.]?\s*.{0,10}$/u;

function isTableHeader(line: string): boolean {
  return (
    TABLE_HEADER_PATTERN.test(line) || TABLE_HEADER_ABBREV_PATTERN.test(line)
  );
}

// §17's "un-modeled outer list grouping" cause: some older administrative
// and tax decrees group Khoản-numbered content under a category heading —
// either a single uppercase letter ("A. Uỷ ban nhân dân thành phố... như
// sau:", "B. Uỷ ban nhân dân các tỉnh... như sau:", confirmed on 174-CP,
// categories A through G by administrative-unit tier, skipping F per
// Vietnamese ordinal-lettering convention) or a roman-numeral industry/topic
// heading ("I. NGUYÊN TẮC CHUNG", "II. LOẠI HÀNG CHỊU THUẾ...", confirmed on
// two real tax schedules — 487-NQ/QHK4 (1974) and 55-CP (1993, still
// `con_hieu_luc` — this is not just an old-document artifact) — both using
// the identical I./II./III./IV. shape for different industry categories,
// each with its own restarting "1./2./3." rate list). The separator after
// the marker isn't always a period either — 487-NQ/QHK4's own attached tax
// schedule (a *second*, separate table within the same document from the
// one that motivated the roman-numeral case above) uses a hyphen instead
// ("I- Đồ ăn uống, thuốc hút", "1. Dầu ăn 10", "2. Miến 10", ...), so both
// are accepted. Either shape is distinct from Điểm's own "a)" convention
// (DIEM_PATTERN), so the parser has no representation for this level at
// all; every category's own numbered list restarts and collides with the
// previous category's.
const GROUP_MARKER_PATTERN = /^(?:[A-ZĐ]|[IVXLCDM]{2,6})[.-]\s+\S/u;

// §12c (extends §7): a citing sentence — "<verb> ... như sau:" or, confirmed
// broadened, without "như sau" at all ("Bổ sung Điều 17c:") — followed by a
// quoted block carries the TARGET document's own numbering, independent of
// and colliding with the citing document's structure. Confirmed on real
// documents using either straight (") or curly (" ") quote marks, opening on
// the line immediately after the citing colon (never same-line) — both
// tracked. The citing-verb requirement is a cheap extra safety margin, not
// the real gate: the actual trigger for suppression is a quote character
// genuinely appearing on the very next line (see isCitingColon's caller) —
// a colon-ended line whose next line ISN'T a quote just falls through to
// normal parsing, so a false match here costs nothing.
const CITING_VERB_PATTERN = /(sửa\s+đổi|bổ\s+sung|bãi\s+bỏ|thay\s+thế)/iu;

function isCitingColon(line: string): boolean {
  return line.endsWith(':') && CITING_VERB_PATTERN.test(line);
}

function startsWithOpenQuote(line: string): boolean {
  return line.length > 0 && (line[0] === '"' || line[0] === '“');
}

// §15's own annotation ("this clause has been amended") sometimes precedes
// amendment content whose target Khoản belongs to an EARLIER Điều but got
// linearized into the scraped text right after a LATER Điều's real content
// (a document-ordering artifact, not the shadow-DOM duplication §15 already
// fixed at extraction — confirmed live on 47/2024/QH15: real Điều 35 runs
// Khoản 1-4, then the annotation precedes a "2." and a "3." belonging to
// Điều 34's underground-space-planning topic, colliding with Điều 35's own
// real Khoản 2/3). Deliberately narrow: only suppresses a Khoản that would
// actually collide with an existing sibling, and only when immediately
// preceded by this exact annotation line — a correctly-placed annotated
// Khoản (the overwhelming majority in any heavily-amended document) is
// completely unaffected. Also recognizes vbpl.vn's sibling annotation for a
// REPEALED clause ("Điều khoản được bãi bỏ") — confirmed live on
// 133/2016/NĐ-CP: a repealed Điểm a ("Trường cao đẳng") gets linearized
// after a later Khoản's own real Điểm list, colliding with that Khoản's
// real Điểm a the same way a misplaced amendment does.
const AMENDMENT_ANNOTATION_LINES = new Set([
  'Điều khoản được sửa đổi, bổ sung',
  'Điều khoản được bãi bỏ',
]);

/** Updates quote-nesting depth from a line's quote characters. Curly open/close (“ ”, U+201C/U+201D) are unambiguous and support real nesting; a straight " (U+0022) toggles, since the same glyph serves both roles for this content. */
function updateQuoteDepth(depth: number, line: string): number {
  let next = depth;
  for (const ch of line) {
    if (ch === '“') next += 1;
    else if (ch === '”') next = Math.max(0, next - 1);
    else if (ch === '"') next = next > 0 ? next - 1 : next + 1;
  }
  return next;
}

/** Per database-design.md §1a: a heading heuristic, not a hard rule — defaults to normative rather than throwing on an unrecognized heading, since this is an explicitly soft/ingest-time judgment call, not a validation error. */
function classifyPhuLuc(heading: string | null): ContentClass {
  if (heading && /mẫu\s+số/i.test(heading)) return 'template';
  return 'normative';
}

/**
 * Backstop against duplicate (document_id, path) rows — confirmed live
 * across 636/3,338 documents (docs/monitoring/law-index-flagged-documents.md,
 * Phase 0 entry). Two known root causes produce a sibling whose ordinal
 * collides with one already opened at the same level: tabular/statistical
 * data misread as "N." Khoản numbering (decimal land-classification codes,
 * table row counters), and "sửa đổi, bổ sung ... như sau: <quoted text>"
 * amendments whose quoted replacement carries the TARGET document's own
 * numbering, restarting at 1 independently of this document's real
 * structure. Neither is reliably distinguishable from a genuine new sibling
 * by a line-based parser without real samples to calibrate a heuristic
 * against (same posture as the rest of this file) — so this does not try to
 * detect or fix the underlying misread. It only guarantees the resulting
 * ltree path is unique: `label` is left exactly as parsed from the source
 * text (still reads "Khoản 1" if that's what the line said), only the
 * internal `ordinal` driving the path gets a counter suffix.
 */
function dedupeOrdinal(
  existingSiblings: ParsedDocumentNode[],
  nodeType: DocumentNodeType,
  ordinal: string,
): string {
  const taken = new Set(
    existingSiblings
      .filter((s) => s.nodeType === nodeType)
      .map((s) => s.ordinal),
  );
  if (!taken.has(ordinal)) return ordinal;
  let suffix = 2;
  while (taken.has(`${ordinal}_${suffix}`)) suffix++;
  return `${ordinal}_${suffix}`;
}

/**
 * §18 (docs/monitoring/law-index-flagged-documents.md): vbpl.vn's own
 * digitized text sometimes garbles the "d)"/"đ)" ordinal pair specifically —
 * confirmed live across 23+ documents (113/2025/NĐ-CP alone has 5 separate
 * occurrences), always one of two mirror-image shapes: a second "d)" where
 * "đ)" belongs (đ never appears anywhere in that Điểm list — confirmed on
 * 113/2025/NĐ-CP: "...d) Riêng biệt với DC. / d) Kết nối kỹ thuật để đồng bộ
 * dữ liệu với DC. / e) Đủ năng lực..."), or a second "đ)" where "d)" belongs
 * (d never appears — confirmed on 103/2016/NĐ-CP: "...c) Riêng biệt... / đ)
 * Phòng xét nghiệm phải kín... / đ) Cửa sổ và cửa ra vào... / e) Hệ
 * thống..."). Vietnamese Điểm lists are alphabetically ordered with đ
 * immediately following d (a, b, c, d, đ, e, ..., per
 * docs/vn-legal-document-structure.md), so a collision on one member of the
 * pair with the OTHER member absent from the entire list is deterministic,
 * not a guess: the content is genuinely present, just mislabeled by the
 * source, unlike a heading truly missing from the digitized text (a
 * different, unfixable shape — see the "Điều 14" gap noted in
 * law-index-flagged-documents.md §12). Needs the complete sibling list to
 * confirm the other letter never appears, so this runs once over the fully
 * built tree rather than inline during parsing (dedupeOrdinal's suffix has
 * already been assigned by the time this walks the tree).
 */
function reclaimDDiacriticCollisions(siblings: ParsedDocumentNode[]): void {
  const diem = siblings.filter((s) => s.nodeType === 'diem');
  const dIndex = diem.findIndex((s) => s.ordinal === 'd');
  const dDupIndex = diem.findIndex((s) => s.ordinal === 'd_2');
  const ddIndex = diem.findIndex((s) => s.ordinal === 'đ');
  const ddDupIndex = diem.findIndex((s) => s.ordinal === 'đ_2');

  if (dIndex !== -1 && dDupIndex === dIndex + 1 && ddIndex === -1) {
    diem[dDupIndex].ordinal = 'đ';
    diem[dDupIndex].label = 'Điểm đ';
  } else if (ddIndex !== -1 && ddDupIndex === ddIndex + 1 && dIndex === -1) {
    diem[ddIndex].ordinal = 'd';
    diem[ddIndex].label = 'Điểm d';
    diem[ddDupIndex].ordinal = 'đ';
    diem[ddDupIndex].label = 'Điểm đ';
  }

  for (const node of siblings) reclaimDDiacriticCollisions(node.children);
}

function newNode(
  nodeType: DocumentNodeType,
  ordinal: string,
  label: string,
  heading: string | null,
): ParsedDocumentNode {
  return {
    nodeType,
    ordinal,
    label,
    heading,
    textContent: null,
    contentClass: null,
    children: [],
  };
}

function appendText(node: ParsedDocumentNode, line: string): void {
  node.textContent = node.textContent ? `${node.textContent}\n${line}` : line;
}

/** If `remainder` (the container line's same-line text) is empty, consumes the next line as the heading when that line isn't itself a structural marker — containers are frequently written with the heading on its own line (often upper-case), not inline. Returns [heading, linesConsumed]. */
function resolveHeading(
  remainder: string,
  lines: string[],
  index: number,
): [string | null, number] {
  const trimmed = remainder.trim();
  if (trimmed) return [trimmed, 0];

  const next = lines[index + 1];
  if (next === undefined) return [null, 0];
  if (
    DIEU_KHOAN_PATTERN.test(next) ||
    PHAN_CHUONG_PATTERN.test(next) ||
    MUC_PATTERN.test(next) ||
    TIEU_MUC_PATTERN.test(next) ||
    PHU_LUC_PATTERN.test(next) ||
    // Confirmed against real scraped vbpl.vn text: an unnumbered Phụ lục's
    // next line is often a parenthetical cross-reference ("(Kèm theo Thông
    // tư số ...)"), not a real heading — reject it rather than adopting it.
    next.startsWith('(')
  ) {
    return [null, 0];
  }
  return [next.trim(), 1];
}

export function parseDocumentBody(fullText: string): ParsedDocumentNode[] {
  // §16 (docs/monitoring/law-index-flagged-documents.md): some documents'
  // scraped fullText is Unicode NFD (combining marks decomposed, e.g. "ề" =
  // U+0065 U+0302 U+0300) rather than NFC (precomposed, single codepoint).
  // Every Vietnamese-diacritic literal in this file's patterns — "Điều",
  // "Chương", "Nơi nhận", etc. — is NFC, so an NFD line silently fails every
  // match despite being visually and semantically identical text: a whole
  // Điều/Chương heading goes unrecognized and its content is absorbed into
  // whatever node was previously open. Confirmed live on 368/2025/NĐ-CP
  // ("Điều 6." heading, byte-inspected as NFD, never matched
  // DIEU_KHOAN_PATTERN). Normalizing once here — rather than in
  // vbpl-client.service.ts at scrape time — fixes both already-stored
  // documents (re-parseable from document.raw_source.fullText with no
  // re-scrape, same posture as §13's fix) and any future scrape, since this
  // function is the sole entry point from raw text to the node tree either
  // way.
  // A source-data quirk, not a parser one: some documents close a §12c
  // quoted block with a doubled straight apostrophe ('') instead of any
  // recognized quote character — confirmed on 02/2002/QH11 (opens with a
  // normal straight " at "được sửa đổi, bổ sung như sau:", but the closing
  // mark at the end of the quoted passage is '' throughout, 27 times, 0
  // curly quotes anywhere in the document). `updateQuoteDepth` below only
  // tracks "/"/" — teaching it a 4th, source-typo-specific closing glyph
  // would make quote-tracking's own logic responsible for a fact about this
  // one site's data entry rather than about quoting conventions in general.
  // Correcting it in the text once here (matching the opening style already
  // used in the same document — straight " open, straight " close) fixes it
  // the same cheap way as NFC normalization above, no re-scrape needed.
  const withCorrectedQuotes = fullText.replace(/''/g, '"');
  const normalized = withCorrectedQuotes.normalize('NFC');
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const roots: ParsedDocumentNode[] = [];
  const stack: { node: ParsedDocumentNode; level: number }[] = [];
  let phuLucNode: ParsedDocumentNode | null = null;
  // The ordinal as computed from the match that opened phuLucNode, BEFORE
  // dedupeOrdinal may have suffixed it. Repeated-header detection below must
  // compare against this, not phuLucNode.ordinal — otherwise a phụ lục that
  // already collided once (and so carries a "_2"-suffixed ordinal) would
  // stop recognizing its own repeated running header on every subsequent line.
  let phuLucRawOrdinal: string | null = null;
  let inFooter = false;
  let annexCounter = 0;
  // §12b/§12c suppression state — see TABLE_HEADER_PATTERN/isCitingColon
  // above. All three are reset wherever a container-level heading
  // (Điều/Chương/Mục/Tiểu mục/Phụ lục) is opened, mirroring how a new
  // container already resets `stack` via openNode: whatever table/quote was
  // in progress can't span past a real structural boundary.
  let inTable = false;
  let quoteDepth = 0;
  let pendingQuoteCitation = false;
  // §12c, multi-target citing sentences: "Điều X được sửa đổi, bổ sung
  // thành các điều X, Xa và Xb như sau:" quotes THREE separate target Điều
  // back-to-back — each new quote reopens immediately where the previous
  // one closed, with no fresh citing colon in between to re-arm
  // `pendingQuoteCitation`. Confirmed live on 02/2002/QH11 (Điều 45 revised
  // into Điều 45/45a/45b, three consecutive `"..."`/`''` quoted blocks).
  // `citingQuoteActive` stays true across the whole sequence (set once the
  // first quote opens, not cleared when that quote closes) so a line
  // starting with a fresh quote character is still recognized as another
  // target's quote — bounded by resetting on the next REAL (non-suppressed)
  // Khoản/Điểm/container, so it can't leak into unrelated later content
  // that happens to open with an unrelated quote for some other reason.
  let citingQuoteActive = false;
  // §17 outer-grouping suppression — see GROUP_MARKER_PATTERN above. The
  // FIRST marker seen (per container scope) is left alone so its own
  // "1./2./3." list stays real structure; only the SECOND and later markers
  // — which is where the restart/collision actually happens — trigger
  // suppression. Reset at the same container boundaries as inTable/
  // quoteDepth.
  let seenGroupMarker = false;
  let inGroupSuppress = false;
  // See AMENDMENT_ANNOTATION_LINES above — one-shot lookahead, same
  // consume-then-set pattern as pendingQuoteCitation: read at the top of an
  // iteration (reflecting the previous line), set at the bottom (for the
  // next line).
  let justSawAmendmentAnnotation = false;

  const openNode = (
    nodeType: Exclude<DocumentNodeType, 'phu_luc'>,
    node: ParsedDocumentNode,
  ) => {
    const level = LEVEL[nodeType];
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.node ?? null;
    const siblings = parent ? parent.children : roots;
    node.ordinal = dedupeOrdinal(siblings, nodeType, node.ordinal);
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push({ node, level });
  };

  /**
   * §17 (docs/monitoring/law-index-flagged-documents.md): a container-level
   * node about to be opened whose ordinal duplicates one already used for
   * that same type signals a duplicated/re-attached block, not a genuine
   * second occurrence — confirmed live on two distinct real shapes: a short
   * "ban hành" decree whose attached "QUY ĐỊNH"/"QUY CHẾ" restarts its own
   * Điều numbering at 1 (12-CP: decree's own Điều 1-3, then a fully
   * independent attached regulation's own Điều 1-6), and a document whose
   * scraped text contains the entire document twice, verbatim, with no
   * signature block in between (364/2025/NĐ-CP: a second "Chương I / QUY
   * ĐỊNH CHUNG / Điều 1..." with identical body text follows the real Điều
   * 11). Same "suppress, don't reconstruct" trade-off as 12b/12c: rather
   * than building a second nested tree for content whose relationship to
   * the first occurrence isn't reliably inferable from a line-based parser,
   * this and everything after it folds into one flat generic-annex node
   * (reusing the existing QCVN/Biểu số mechanism).
   *
   * Điều/Chương/Phần are tracked document-wide (any nesting depth), not
   * just at root — per docs/vn-legal-document-structure.md (Điều 63 khoản
   * 1, Nghị định 78/2025/NĐ-CP: "việc đánh số các điều... bắt đầu từ Điều
   * 1", i.e. Điều numbering is one continuous sequence for the whole
   * document, never restarting at a Chương boundary) and confirmed live: a
   * document can duplicate just one inner Điều (nested inside an otherwise-
   * legitimate, non-duplicated Chương) rather than repeating from document
   * root — 02/2026/NĐ-CP's "Điều 13" appears twice within the same real
   * Chương II, which a root-only check misses entirely. Mục/Tiểu mục
   * deliberately use a narrower ROOT-ONLY check instead — Vietnamese
   * drafting convention for whether their numbering restarts per Chương
   * isn't confirmed either way in this repo's own reference doc, and
   * getting that wrong would wrongly swallow real content; same reasoning
   * extends the document-wide check to Chương itself with a small
   * acknowledged gap — a document legitimately using Phần-scoped Chương
   * numbering (Chương restarting at 1 per Phần) isn't confirmed absent
   * either, not observed in any real sample so far.
   */
  const seenDieu = new Set<string>();
  const seenChuong = new Set<string>();
  const seenPhan = new Set<string>();
  const documentWideSeen: Record<'dieu' | 'chuong' | 'phan', Set<string>> = {
    dieu: seenDieu,
    chuong: seenChuong,
    phan: seenPhan,
  };
  const wouldRestartDocumentWide = (
    nodeType: 'dieu' | 'chuong' | 'phan',
    ordinal: string,
  ): boolean => documentWideSeen[nodeType].has(ordinal);

  const wouldRestartAtRoot = (
    nodeType: 'muc' | 'tieu_muc',
    ordinal: string,
  ): boolean => {
    const wouldBeRoot = !stack.some((s) => s.level < LEVEL[nodeType]);
    return (
      wouldBeRoot &&
      roots.some((r) => r.nodeType === nodeType && r.ordinal === ordinal)
    );
  };

  /**
   * True when a khoan/diem about to be opened would collide with an
   * existing sibling under whatever parent it would actually land under
   * (mirrors the pop-then-parent logic openNode itself uses, without
   * mutating `stack`). Used by the AMENDMENT_ANNOTATION_LINES check for both
   * levels — confirmed live that the misplaced-amendment-content shape
   * happens at Điểm level too (117/2020/NĐ-CP, 115/2018/NĐ-CP,
   * 168/2024/NĐ-CP: a "b)"/"đ)"/"c)" collides the same way a Khoản does),
   * not just Khoản (47/2024/QH15).
   */
  const wouldCollideWithSibling = (
    nodeType: 'khoan' | 'diem',
    ordinal: string,
  ): boolean => {
    const level = LEVEL[nodeType];
    let depth = stack.length;
    while (depth > 0 && stack[depth - 1].level >= level) depth--;
    const parent = depth > 0 ? stack[depth - 1].node : null;
    const siblings = parent ? parent.children : roots;
    return siblings.some(
      (s) => s.nodeType === nodeType && s.ordinal === ordinal,
    );
  };

  /** Opens a Phụ lục node from an explicit PHU_LUC_PATTERN match. Returns the number of extra lines resolveHeading consumed, for the caller to advance `i` by. */
  const openPhuLucFromMatch = (
    match: RegExpMatchArray,
    lineIndex: number,
  ): number => {
    annexCounter += 1;
    const ordinal = match[2] ? romanToArabic(match[2]) : String(annexCounter);
    const label = match[2] ? `${match[1]} ${match[2]}` : match[1];
    const [heading, skip] = resolveHeading(match[3], lines, lineIndex);
    const node = newNode(
      'phu_luc',
      dedupeOrdinal(roots, 'phu_luc', ordinal),
      label,
      heading,
    );
    node.contentClass = classifyPhuLuc(heading);
    phuLucNode = node;
    phuLucRawOrdinal = ordinal;
    roots.push(node);
    return skip;
  };

  /**
   * Generic fallback for an attached văn bản that never calls itself
   * "Phụ lục" at all (see ANNEX_RESTART_PATTERN) — a QCVN technical
   * standard restating its own Quốc hiệu header, or a "Biểu số"/"Mẫu số"
   * report form. The triggering line is the annex's own title/header, real
   * content rather than filler, so it's kept as the node's first line of
   * text instead of being discarded the way a FOOTER_START_PATTERN line is.
   */
  const openGenericAnnex = (firstLine: string): void => {
    annexCounter += 1;
    const ordinal = String(annexCounter);
    const node = newNode(
      'phu_luc',
      dedupeOrdinal(roots, 'phu_luc', ordinal),
      `Phụ lục ${annexCounter}`,
      null,
    );
    node.contentClass = 'normative';
    phuLucNode = node;
    phuLucRawOrdinal = ordinal;
    roots.push(node);
    appendText(node, firstLine);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (phuLucNode) {
      // Only the explicit "Phụ lục" pattern opens a new sibling annex from
      // here — ANNEX_RESTART_PATTERN is a one-time footer-escape trigger,
      // not re-tested once already inside an annex. Real QCVN/TCVN body
      // text repeats its own self-citation ("QCVN 01:2026/BXD do Viện...")
      // throughout, and a multi-line title block (Quốc hiệu header, then
      // "QCVN ...", then the standard's own name) would otherwise fragment
      // into several sibling nodes instead of staying one annex.
      const phuLucMatch = line.match(PHU_LUC_PATTERN);
      if (phuLucMatch) {
        // A "Phụ lục N" line repeating the SAME numeral as the currently
        // open annex is a running section/page header, not a new annex —
        // confirmed live (e.g. 22/2026/NQ-CP: one phụ lục, 21 subsections,
        // each preceded by its own "Phụ lục I" header restating the same
        // numeral). Without this, one logical phụ lục fragments into dozens
        // of document_node rows all colliding on the same ltree path. A
        // DIFFERENT numeral is a genuinely new annex and still opens one.
        const candidateOrdinal = phuLucMatch[2]
          ? romanToArabic(phuLucMatch[2])
          : null;
        if (
          candidateOrdinal !== null &&
          candidateOrdinal === phuLucRawOrdinal
        ) {
          appendText(phuLucNode, line);
          continue;
        }
        i += openPhuLucFromMatch(phuLucMatch, i);
        continue;
      }
      appendText(phuLucNode, line);
      continue;
    }

    const phuLucMatch = line.match(PHU_LUC_PATTERN);
    if (phuLucMatch) {
      inFooter = false;
      inTable = false;
      quoteDepth = 0;
      pendingQuoteCitation = false;
      seenGroupMarker = false;
      inGroupSuppress = false;
      justSawAmendmentAnnotation = false;
      citingQuoteActive = false;
      stack.length = 0; // Phụ lục always sits at document root, sibling to top-level Chương/Điều.
      i += openPhuLucFromMatch(phuLucMatch, i);
      continue;
    }

    if (inFooter) {
      if (ANNEX_RESTART_PATTERN.test(line)) {
        stack.length = 0;
        openGenericAnnex(line);
        continue;
      }
      continue; // dropped — signature/routing block, see FOOTER_START_PATTERN
    }

    if (FOOTER_START_PATTERN.test(line)) {
      inFooter = true;
      inTable = false;
      quoteDepth = 0;
      pendingQuoteCitation = false;
      seenGroupMarker = false;
      inGroupSuppress = false;
      justSawAmendmentAnnotation = false;
      citingQuoteActive = false;
      continue;
    }

    // §12c suppression — checked before any structural pattern (including
    // Điều/Chương), since real quoted target text routinely itself contains
    // "Điều N. <heading>"-shaped lines (that's the whole failure mode this
    // fixes: the target document's own Điều/Khoản structure must stay
    // suppressed, not open real sibling nodes). Deliberate trade-off, same
    // posture as this file's other best-effort rules: an in-source quote
    // that never actually closes (malformed/truncated text) would suppress
    // everything for the rest of the document rather than recovering at the
    // next real heading — not observed in any confirmed sample, and no
    // safety-net line cap is applied for it; revisit if a real corpus
    // example surfaces it.
    if (quoteDepth > 0) {
      quoteDepth = updateQuoteDepth(quoteDepth, line);
      const current = stack[stack.length - 1]?.node;
      if (current) appendText(current, line);
      continue;
    }
    if (pendingQuoteCitation) {
      pendingQuoteCitation = false;
      if (startsWithOpenQuote(line)) {
        quoteDepth = updateQuoteDepth(0, line);
        citingQuoteActive = true;
        const current = stack[stack.length - 1]?.node;
        if (current) appendText(current, line);
        continue;
      }
      // Expected quote didn't materialize on the very next line — not a
      // quoted-citation shape after all, fall through to normal parsing.
    }
    // See citingQuoteActive above — a fresh quote character reopening
    // immediately where a prior quote (from the SAME multi-target citing
    // sentence) just closed, with no new citing colon in between.
    if (citingQuoteActive && startsWithOpenQuote(line)) {
      quoteDepth = updateQuoteDepth(0, line);
      const current = stack[stack.length - 1]?.node;
      if (current) appendText(current, line);
      continue;
    }

    // See AMENDMENT_ANNOTATION_LINES above — captured now (reflecting
    // whether the line just processed last iteration was the annotation),
    // consumed inside the Khoản-match block below; the new value for the
    // NEXT line is set alongside pendingQuoteCitation further down.
    const wasAfterAmendmentAnnotation = justSawAmendmentAnnotation;

    const dieuMatch = line.match(DIEU_KHOAN_PATTERN);
    if (dieuMatch) {
      inTable = false;
      quoteDepth = 0;
      pendingQuoteCitation = false;
      seenGroupMarker = false;
      inGroupSuppress = false;
      justSawAmendmentAnnotation = false;
      citingQuoteActive = false;
      const ordinal = `${dieuMatch[1]}${dieuMatch[2]}`;
      if (wouldRestartDocumentWide('dieu', ordinal)) {
        stack.length = 0;
        openGenericAnnex(line);
        continue;
      }
      seenDieu.add(ordinal);
      const label = `Điều ${ordinal}`;
      const [heading, skip] = resolveHeading(dieuMatch[3], lines, i);
      i += skip;
      openNode('dieu', newNode('dieu', ordinal, label, heading));
      continue;
    }

    const phanChuongMatch = line.match(PHAN_CHUONG_PATTERN);
    if (phanChuongMatch) {
      inTable = false;
      quoteDepth = 0;
      pendingQuoteCitation = false;
      seenGroupMarker = false;
      inGroupSuppress = false;
      justSawAmendmentAnnotation = false;
      citingQuoteActive = false;
      const keyword = phanChuongMatch[1];
      const nodeType: 'phan' | 'chuong' = /^phần$/i.test(keyword)
        ? 'phan'
        : 'chuong';
      const ordinal = romanToArabic(phanChuongMatch[2]);
      if (wouldRestartDocumentWide(nodeType, ordinal)) {
        stack.length = 0;
        openGenericAnnex(line);
        continue;
      }
      documentWideSeen[nodeType].add(ordinal);
      const label = `${keyword} ${phanChuongMatch[2]}`;
      const [heading, skip] = resolveHeading(phanChuongMatch[3], lines, i);
      i += skip;
      openNode(nodeType, newNode(nodeType, ordinal, label, heading));
      continue;
    }

    const tieuMucMatch = line.match(TIEU_MUC_PATTERN);
    if (tieuMucMatch) {
      inTable = false;
      quoteDepth = 0;
      pendingQuoteCitation = false;
      seenGroupMarker = false;
      inGroupSuppress = false;
      justSawAmendmentAnnotation = false;
      citingQuoteActive = false;
      const ordinal = tieuMucMatch[2];
      if (wouldRestartAtRoot('tieu_muc', ordinal)) {
        stack.length = 0;
        openGenericAnnex(line);
        continue;
      }
      const label = `${tieuMucMatch[1]} ${ordinal}`;
      const [heading, skip] = resolveHeading(tieuMucMatch[3], lines, i);
      i += skip;
      openNode('tieu_muc', newNode('tieu_muc', ordinal, label, heading));
      continue;
    }

    const mucMatch = line.match(MUC_PATTERN);
    if (mucMatch) {
      inTable = false;
      quoteDepth = 0;
      pendingQuoteCitation = false;
      seenGroupMarker = false;
      inGroupSuppress = false;
      justSawAmendmentAnnotation = false;
      citingQuoteActive = false;
      const ordinal = mucMatch[2];
      if (wouldRestartAtRoot('muc', ordinal)) {
        stack.length = 0;
        openGenericAnnex(line);
        continue;
      }
      const label = `${mucMatch[1]} ${ordinal}`;
      const [heading, skip] = resolveHeading(mucMatch[3], lines, i);
      i += skip;
      openNode('muc', newNode('muc', ordinal, label, heading));
      continue;
    }

    // §12b suppression — a table-header line is never real Khoản/Điểm
    // content; once seen, every subsequent line is inert body text until a
    // container-level heading resets `inTable` above.
    if (inTable) {
      const current = stack[stack.length - 1]?.node;
      if (current) appendText(current, line);
      continue;
    }
    if (isTableHeader(line)) {
      inTable = true;
      const current = stack[stack.length - 1]?.node;
      if (current) appendText(current, line);
      continue;
    }

    // §17 outer-grouping suppression — see GROUP_MARKER_PATTERN above. The
    // first marker's own numbered list is left as real structure; only the
    // second (and later) marker means we've entered the collision zone.
    if (inGroupSuppress) {
      const current = stack[stack.length - 1]?.node;
      if (current) appendText(current, line);
      continue;
    }
    if (GROUP_MARKER_PATTERN.test(line)) {
      if (seenGroupMarker) {
        inGroupSuppress = true;
      } else {
        seenGroupMarker = true;
      }
      const current = stack[stack.length - 1]?.node;
      if (current) appendText(current, line);
      continue;
    }

    // A citing sentence ("<verb> ... như sau:") only actually starts
    // suppression once the very next line proves out as a quote (handled at
    // the top of the next iteration) — recording the possibility here costs
    // nothing if it doesn't pan out.
    pendingQuoteCitation = isCitingColon(line);
    justSawAmendmentAnnotation = AMENDMENT_ANNOTATION_LINES.has(line);

    const stackTopLevel = stack[stack.length - 1]?.level;

    if (
      stackTopLevel === LEVEL.dieu ||
      stackTopLevel === LEVEL.khoan ||
      // Also valid straight out of an open Điểm — a new "N." line closes
      // the current Điểm *and* its parent Khoản, opening a sibling Khoản.
      // Confirmed against real vbpl.vn output (Nghị quyết 66.10/2025/NQ-CP,
      // Điều 3): without this, a Khoản encountered after its predecessor's
      // Điểm list silently failed to match and got swallowed as trailing
      // text onto the last Điểm instead of opening as its own sibling node.
      stackTopLevel === LEVEL.diem
    ) {
      const khoanMatch = line.match(KHOAN_PATTERN);
      if (khoanMatch && looksLikeTableFragment(line, khoanMatch[3])) {
        const current = stack[stack.length - 1]?.node;
        if (current) appendText(current, line);
        continue;
      }
      if (khoanMatch) {
        const ordinal = `${khoanMatch[1]}${khoanMatch[2]}`;
        // See AMENDMENT_ANNOTATION_LINES above — only suppress when this
        // exact Khoản would actually collide with an existing sibling; a
        // correctly-placed annotated Khoản (the common case) opens
        // normally, same as if no annotation had preceded it.
        if (
          wasAfterAmendmentAnnotation &&
          wouldCollideWithSibling('khoan', ordinal)
        ) {
          const current = stack[stack.length - 1]?.node;
          if (current) appendText(current, line);
          continue;
        }
        // A real (non-suppressed) Khoản successfully opening means we've
        // moved past any citing sentence's replacement zone into genuinely
        // new content — bounds citingQuoteActive's stickiness so it can't
        // leak into later, unrelated content that happens to open with an
        // unrelated quote character.
        citingQuoteActive = false;
        const label = `Khoản ${ordinal}`;
        const node = newNode('khoan', ordinal, label, null);
        openNode('khoan', node);
        if (khoanMatch[3].trim()) appendText(node, khoanMatch[3].trim());
        continue;
      }
    }

    if (stackTopLevel === LEVEL.khoan || stackTopLevel === LEVEL.diem) {
      const diemMatch = line.match(DIEM_PATTERN);
      if (diemMatch) {
        const ordinal = diemMatch[1];
        // See AMENDMENT_ANNOTATION_LINES above and the same check on Khoản —
        // confirmed live this same misplaced-amendment-content shape also
        // happens at Điểm level (117/2020/NĐ-CP, 115/2018/NĐ-CP,
        // 168/2024/NĐ-CP), not just Khoản (47/2024/QH15).
        if (
          wasAfterAmendmentAnnotation &&
          wouldCollideWithSibling('diem', ordinal)
        ) {
          const current = stack[stack.length - 1]?.node;
          if (current) appendText(current, line);
          continue;
        }
        const label = `Điểm ${ordinal}`;
        const node = newNode('diem', ordinal, label, null);
        openNode('diem', node);
        if (diemMatch[2].trim()) appendText(node, diemMatch[2].trim());
        continue;
      }
    }

    const current = stack[stack.length - 1]?.node;
    if (current) appendText(current, line);
    // Lines before any structural marker is opened (rare — vbpl.vn's Nội
    // dung tab normally starts directly with a Chương/Điều) have nowhere
    // to attach and are dropped.
  }

  reclaimDDiacriticCollisions(roots);
  return roots;
}
