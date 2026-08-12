import type { FlatNodeRow } from '../../persistence/document-node.repository';

/**
 * Metadata pulled from the `document ⋈ issuing_body` join (see
 * DocumentRepository.getDb(), the documented escape hatch for this one
 * query — this module stays DI-free, so it never runs the query itself).
 */
export interface DocumentProjectionMeta {
  documentId: string;
  citationId: string;
  documentType: string;
  issuingBodyId: string;
  authorityRank: number;
  enactedDate: string;
  effectiveDate: string | null;
  contentVersion: string;
}

export interface KhoanEntry {
  khoan_id: string;
  label: string;
  text: string;
  status?: string;
  valid_from: string;
  valid_to?: string;
}

/** Mirrors legal-provisions.mapping.ts's field names exactly — this is the `_source` body a bulk index request sends. */
export interface LegalProvisionDocument {
  document_id: string;
  citation_id: string;
  document_type: string;
  issuing_body_id: string;
  authority_rank: number;
  node_type: 'dieu' | 'phu_luc';
  path: string;
  label: string;
  heading?: string;
  body: string;
  khoan: KhoanEntry[];
  status?: string;
  valid_from: string;
  valid_to?: string;
  enacted_date: string;
  effective_date?: string;
  content_hash: string;
  content_version: string;
}

export interface ProjectedProvision {
  /** document_node.id — becomes the bulk request's `_id`, not a body field. */
  id: string;
  source: LegalProvisionDocument;
}

export interface ProjectionStats {
  provisionsProjected: number;
  templatePhuLucSkipped: number;
  khoanFolded: number;
}

export interface ProjectionResult {
  provisions: ProjectedProvision[];
  stats: ProjectionStats;
}

/** Điểm text folded into its parent Khoản — a), b), c)... points aren't independently retrievable in search (§3a). */
function foldKhoanText(
  khoan: FlatNodeRow,
  diemChildren: FlatNodeRow[],
): string {
  const parts: string[] = [];
  if (khoan.textContent) parts.push(khoan.textContent);
  for (const diem of diemChildren) {
    if (!diem.textContent) continue;
    parts.push(`${diem.label} ${diem.textContent}`);
  }
  return parts.join('\n');
}

function buildKhoanEntries(
  khoanNodes: FlatNodeRow[],
  childrenByParent: Map<string, FlatNodeRow[]>,
): KhoanEntry[] {
  return khoanNodes.map((khoan) => {
    const diemChildren = (childrenByParent.get(khoan.id) ?? []).filter(
      (n) => n.nodeType === 'diem',
    );
    const entry: KhoanEntry = {
      khoan_id: khoan.id,
      label: khoan.label,
      text: foldKhoanText(khoan, diemChildren),
      valid_from: khoan.validFrom,
    };
    if (khoan.status) entry.status = khoan.status;
    if (khoan.validTo) entry.valid_to = khoan.validTo;
    return entry;
  });
}

/**
 * `body` deliberately excludes `heading` (§3a) — heading is separately
 * boosted (`heading^2, body^2`) in the query shape, so folding it in here
 * would double-count it in BM25.
 */
function buildBody(node: FlatNodeRow, khoanEntries: KhoanEntry[]): string {
  const parts: string[] = [];
  if (node.textContent) parts.push(node.textContent);
  for (const k of khoanEntries) {
    if (k.text) parts.push(k.text);
  }
  return parts.join('\n\n');
}

/**
 * Projects one document's flat `document_node` rows into OpenSearch-ready
 * provisions, per the plan's §3a rules: Điều always top-level with Khoản/Điểm
 * folded in; normative Phụ lục top-level with an empty `khoan[]`; template
 * Phụ lục and every container node (Phần/Chương/Mục/Tiểu mục) never emitted.
 *
 * `flatNodes` must already be ordered by ltree `path`
 * (DocumentNodeRepository.findAllNodes's own ordering) — that order is what
 * keeps `khoan[]` and folded Điểm text in document order, since grouping by
 * parentId here preserves insertion order rather than re-sorting.
 *
 * The hierarchy is provably two levels (Khoản→Điều, Điểm→Khoản), so a single
 * parentId->children map suffices — no recursion, no tree-building.
 */
export function projectDocument(
  meta: DocumentProjectionMeta,
  flatNodes: FlatNodeRow[],
): ProjectionResult {
  const childrenByParent = new Map<string, FlatNodeRow[]>();
  for (const node of flatNodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  const provisions: ProjectedProvision[] = [];
  let templatePhuLucSkipped = 0;
  let khoanFolded = 0;

  for (const node of flatNodes) {
    // phan/chuong/muc/tieu_muc are never emitted, as top-level docs or otherwise.
    if (node.nodeType !== 'dieu' && node.nodeType !== 'phu_luc') continue;

    if (node.nodeType === 'phu_luc' && node.contentClass !== 'normative') {
      if (node.contentClass === 'template') templatePhuLucSkipped += 1;
      continue;
    }

    const khoanEntries =
      node.nodeType === 'dieu'
        ? buildKhoanEntries(
            (childrenByParent.get(node.id) ?? []).filter(
              (n) => n.nodeType === 'khoan',
            ),
            childrenByParent,
          )
        : []; // phụ lục has no internal Mục/Bảng sub-hierarchy — whole text is one `body` block.
    khoanFolded += khoanEntries.length;

    const source: LegalProvisionDocument = {
      document_id: meta.documentId,
      citation_id: meta.citationId,
      document_type: meta.documentType,
      issuing_body_id: meta.issuingBodyId,
      authority_rank: meta.authorityRank,
      node_type: node.nodeType,
      path: node.path,
      label: node.label,
      ...(node.heading ? { heading: node.heading } : {}),
      body: buildBody(node, khoanEntries),
      khoan: khoanEntries,
      ...(node.status ? { status: node.status } : {}),
      valid_from: node.validFrom,
      ...(node.validTo ? { valid_to: node.validTo } : {}),
      enacted_date: meta.enactedDate,
      ...(meta.effectiveDate ? { effective_date: meta.effectiveDate } : {}),
      content_hash: node.contentHash,
      content_version: meta.contentVersion,
    };

    provisions.push({ id: node.id, source });
  }

  return {
    provisions,
    stats: {
      provisionsProjected: provisions.length,
      templatePhuLucSkipped,
      khoanFolded,
    },
  };
}
