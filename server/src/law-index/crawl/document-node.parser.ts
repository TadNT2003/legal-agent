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
const KHOAN_PATTERN = /^(\d+)([a-zđ]?)\s*\.\s*(.*)$/u;
const DIEM_PATTERN = /^([a-zđ])\)\s*(.*)$/iu;
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
  const lines = fullText
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
      continue;
    }

    const dieuMatch = line.match(DIEU_KHOAN_PATTERN);
    if (dieuMatch) {
      const ordinal = `${dieuMatch[1]}${dieuMatch[2]}`;
      const label = `Điều ${ordinal}`;
      const [heading, skip] = resolveHeading(dieuMatch[3], lines, i);
      i += skip;
      openNode('dieu', newNode('dieu', ordinal, label, heading));
      continue;
    }

    const phanChuongMatch = line.match(PHAN_CHUONG_PATTERN);
    if (phanChuongMatch) {
      const keyword = phanChuongMatch[1];
      const nodeType: 'phan' | 'chuong' = /^phần$/i.test(keyword)
        ? 'phan'
        : 'chuong';
      const ordinal = romanToArabic(phanChuongMatch[2]);
      const label = `${keyword} ${phanChuongMatch[2]}`;
      const [heading, skip] = resolveHeading(phanChuongMatch[3], lines, i);
      i += skip;
      openNode(nodeType, newNode(nodeType, ordinal, label, heading));
      continue;
    }

    const tieuMucMatch = line.match(TIEU_MUC_PATTERN);
    if (tieuMucMatch) {
      const ordinal = tieuMucMatch[2];
      const label = `${tieuMucMatch[1]} ${ordinal}`;
      const [heading, skip] = resolveHeading(tieuMucMatch[3], lines, i);
      i += skip;
      openNode('tieu_muc', newNode('tieu_muc', ordinal, label, heading));
      continue;
    }

    const mucMatch = line.match(MUC_PATTERN);
    if (mucMatch) {
      const ordinal = mucMatch[2];
      const label = `${mucMatch[1]} ${ordinal}`;
      const [heading, skip] = resolveHeading(mucMatch[3], lines, i);
      i += skip;
      openNode('muc', newNode('muc', ordinal, label, heading));
      continue;
    }

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
      if (khoanMatch) {
        const ordinal = `${khoanMatch[1]}${khoanMatch[2]}`;
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

  return roots;
}
