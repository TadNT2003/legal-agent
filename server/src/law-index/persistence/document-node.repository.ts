import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import {
  parseDocumentBody,
  type ParsedDocumentNode,
} from '../../crawl/document-node.parser';
import type { ParsedVbplDocument } from '../../crawl/vbpl-document.interface';
import { DRIZZLE, type DrizzleDb } from './db.module';
import { document, documentNode } from './schema';

interface DocumentMeta {
  status: (typeof document.$inferSelect)['status'];
  validFrom: string;
}

function computeNodeContentHash(node: ParsedDocumentNode): string {
  const hash = createHash('sha256');
  hash.update(node.label);
  hash.update(node.heading ?? '');
  hash.update(node.textContent ?? '');
  return hash.digest('hex');
}

/**
 * ltree labels are restricted to [A-Za-z0-9_]+. The comment this replaces
 * assumed ordinal was already ASCII-only "by construction" — wrong:
 * DIEU_KHOAN_PATTERN/DIEM_PATTERN in document-node.parser.ts both accept
 * `đ` as a valid Vietnamese-alphabet ordinal suffix (`[a-zđ]`), and it's a
 * real, common one — "đ)" is the 5th point in any a/b/c/d/đ/e... Điểm list,
 * confirmed live across 1,434 documents — plus the rarer inserted-provision
 * case per Điều 69.4, Nghị định 78/2025/NĐ-CP (e.g. "Điều 146đ").
 *
 * Blind-stripping `đ` (the previous behavior) is wrong two ways, not one:
 *   - For "146đ": stripping collides the path with the *different*,
 *     already-existing "Điều 146" — confirmed live on 17/2017/QH14 and 6
 *     other documents (10 nodes total). Content wasn't lost (the row, its
 *     `ordinal`/`label`/`text_content` are all correct) but the `path`
 *     column silently duplicated onto an unrelated sibling.
 *   - For bare "đ" (the Điểm case): stripping to '' produces a path segment
 *     of just "diem" — not colliding with a sibling in practice (a Vietnamese
 *     list has at most one đ point), but silently indistinguishable from "no
 *     ordinal at all" in the path itself.
 * Transliterating to a distinct ASCII sequence fixes both: it must NOT
 * collapse onto the unrelated "d" ordinal either, since "d)" and "đ)" are
 * both real, commonly-adjacent point labels in the same list (a/b/c/d/đ/e).
 * "dd" satisfies both constraints — distinct from "d", and from the
 * digit-only sanitized form of the base ordinal it's suffixing.
 *
 * Extend VIETNAMESE_ORDINAL_TRANSLITERATION if the parser's accepted
 * suffix charset ever grows past `đ` (see that pattern's own comment on the
 * full Vietnamese alphabet being a follow-up) — anything not in this map
 * still falls through to the strip-everything-else behavior as a safety net
 * for genuinely unanticipated input, same as before.
 */
const VIETNAMESE_ORDINAL_TRANSLITERATION: Record<string, string> = {
  đ: 'dd',
};

export function sanitizeOrdinalForLtree(ordinal: string): string {
  const transliterated = ordinal.replace(
    /đ/gi,
    (ch) => VIETNAMESE_ORDINAL_TRANSLITERATION[ch.toLowerCase()],
  );
  return transliterated.replace(/[^A-Za-z0-9_]/g, '');
}

@Injectable()
export class DocumentNodeRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Rebuilds a document's document_node tree from its scraped full text.
   * No per-node amendment diffing exists yet (needs the CDC pipeline), so a
   * full delete-and-reinsert is the correct v1 behavior — gated the same
   * way document.content_version already gates document-level writes:
   * skipped entirely when the document's content didn't change AND it
   * already has nodes (this also backfills documents synced before this
   * feature existed, on their next re-sync, without a one-off migration
   * script).
   */
  async syncNodes(
    documentId: string,
    parsed: ParsedVbplDocument,
    contentChanged: boolean,
  ): Promise<void> {
    if (!contentChanged && (await this.hasNodes(documentId))) return;

    const meta = await this.fetchDocumentMeta(documentId);
    // Null fullText means vbpl.vn has no "Nội dung" tab for this document at
    // all (see ParsedVbplDocument.fullText) — there is no body text to parse,
    // not a parsing failure, so the tree is legitimately empty.
    const tree =
      parsed.fullText === null ? [] : parseDocumentBody(parsed.fullText);

    await this.db
      .delete(documentNode)
      .where(eq(documentNode.documentId, documentId));
    for (const root of tree) {
      await this.insertNode(documentId, null, null, root, meta);
    }
  }

  private async hasNodes(documentId: string): Promise<boolean> {
    const existing = await this.db.query.documentNode.findFirst({
      where: eq(documentNode.documentId, documentId),
      columns: { id: true },
    });
    return existing !== undefined;
  }

  private async fetchDocumentMeta(documentId: string): Promise<DocumentMeta> {
    const row = await this.db.query.document.findFirst({
      where: eq(document.id, documentId),
      columns: { status: true, enactedDate: true, effectiveDate: true },
    });
    if (!row) {
      throw new Error(
        `document ${documentId} not found while building its document_node tree`,
      );
    }
    return {
      status: row.status,
      validFrom: row.effectiveDate ?? row.enactedDate,
    };
  }

  private async insertNode(
    documentId: string,
    parentId: string | null,
    parentPath: string | null,
    node: ParsedDocumentNode,
    meta: DocumentMeta,
  ): Promise<void> {
    const segment = `${node.nodeType}${sanitizeOrdinalForLtree(node.ordinal)}`;
    const path = parentPath ? `${parentPath}.${segment}` : segment;

    const [inserted] = await this.db
      .insert(documentNode)
      .values({
        documentId,
        parentId,
        nodeType: node.nodeType,
        contentClass: node.contentClass,
        path,
        ordinal: node.ordinal,
        label: node.label,
        heading: node.heading,
        textContent: node.textContent,
        contentHash: computeNodeContentHash(node),
        status: meta.status,
        validFrom: meta.validFrom,
      })
      .returning({ id: documentNode.id });

    for (const child of node.children) {
      await this.insertNode(documentId, inserted.id, path, child, meta);
    }
  }

  /**
   * Fetches document metadata for a given document ID.
   */
  async fetchDocumentInfo(
    documentId: string,
  ): Promise<{ citationId: string; title: string }> {
    const row = await this.db.query.document.findFirst({
      where: eq(document.id, documentId),
      columns: { citationId: true, title: true },
    });
    if (!row) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }
    return row;
  }

  /**
   * Fetches a flat list of all nodes for a document, ordered by their
   * ltree path (preserves document order). Optionally filters by nodeType
   * and/or ordinal number.
   */
  async findAllNodes(
    documentId: string,
    nodeType?: string,
    number?: string,
  ): Promise<FlatNodeRow[]> {
    const conditions = [eq(documentNode.documentId, documentId)];
    if (nodeType)
      conditions.push(
        eq(
          documentNode.nodeType,
          nodeType as (typeof documentNode.$inferInsert)['nodeType'],
        ),
      );
    if (number) conditions.push(eq(documentNode.ordinal, number));

    const where = conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.db
      .select()
      .from(documentNode)
      .where(where)
      .orderBy(documentNode.path);
  }

  /**
   * Fetches all nodes for a document (needed to build parent->child tree),
   * then filters the root results.
   */
  async findNodeSubtree(
    documentId: string,
    nodeId: string,
  ): Promise<{
    docInfo: { citationId: string; title: string };
    nodes: FlatNodeRow[];
  }> {
    const docInfo = await this.fetchDocumentInfo(documentId);
    const nodes = await this.db
      .select()
      .from(documentNode)
      .where(eq(documentNode.documentId, documentId))
      .orderBy(documentNode.path);

    if (!nodes.some((n) => n.id === nodeId)) {
      throw new NotFoundException(
        `Node ${nodeId} not found in document ${documentId}`,
      );
    }

    return { docInfo, nodes };
  }
}

export interface FlatNodeRow {
  id: string;
  documentId: string;
  parentId: string | null;
  nodeType: string;
  contentClass: string | null;
  path: string;
  ordinal: string;
  label: string;
  heading: string | null;
  textContent: string | null;
  contentHash: string;
  status: string | null;
  validFrom: string;
  validTo: string | null;
  supersededByNodeId: string | null;
}
