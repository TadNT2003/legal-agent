import { Injectable } from '@nestjs/common';
import type { VbplSearchResult } from '../crawl/vbpl-document.interface';
import type {
  RetrieveIssuingBodiesDto,
  RetrieveIssuingBodiesResponseDto,
} from '../dto/retrieve-issuing-bodies.dto';
import { RetrieveNodeDto } from '../dto/retrieve-node.dto';
import { RetrieveReferencesDto } from '../dto/retrieve-references.dto';
import type { RetrieveReferencesResponseDto } from '../dto/retrieve-references-response.dto';
import { RetrieveSearchDto } from '../dto/retrieve-search.dto';
import type {
  RetrieveNodeItemDto,
  RetrieveNodeResponseDto,
} from '../dto/retrieve-node-response.dto';
import { DocumentRepository } from '../persistence/document.repository';
import {
  DocumentNodeRepository,
  type FlatNodeRow,
} from '../persistence/document-node.repository';

@Injectable()
export class RetrieveService {
  constructor(
    private readonly repo: DocumentRepository,
    private readonly nodeRepo: DocumentNodeRepository,
  ) {}

  async search(filters: RetrieveSearchDto): Promise<VbplSearchResult> {
    return this.repo.searchLocalDocuments(filters);
  }

  async findReferences(
    dto: RetrieveReferencesDto,
  ): Promise<RetrieveReferencesResponseDto> {
    const { documentId, direction, referenceType } = dto;
    const result = await this.repo.findReferences(
      documentId,
      direction ?? 'outgoing',
      referenceType,
    );
    return {
      citationId: result.citationId,
      title: result.title,
      total: result.references.length,
      references: result.references,
    };
  }

  async findIssuingBodies(
    dto: RetrieveIssuingBodiesDto,
  ): Promise<RetrieveIssuingBodiesResponseDto> {
    return this.repo.findIssuingBodies(dto);
  }

  /**
   * Retrieves document nodes (clauses) from the Postgres database. Supports
   * filtering by node type, label, or specific node ID. Returns the full
   * vbpl.vn-style text for each node including all descendant content.
   */
  async retrieveNode(dto: RetrieveNodeDto): Promise<RetrieveNodeResponseDto> {
    const { documentId, nodeType, number, nodeId } = dto;

    if (nodeId) {
      return this.retrieveNodeById(documentId, nodeId);
    }

    return this.retrieveNodesByFilter(documentId, nodeType, number);
  }

  private async retrieveNodeById(
    documentId: string,
    nodeId: string,
  ): Promise<RetrieveNodeResponseDto> {
    const { docInfo, nodes } = await this.nodeRepo.findNodeSubtree(
      documentId,
      nodeId,
    );

    const tree = this.buildTreeFromFlatNodes(nodes);
    const targetNode = this.findNodeById(tree, nodeId);
    if (!targetNode) {
      return {
        citationId: docInfo.citationId,
        title: docInfo.title,
        nodes: [],
      };
    }

    return {
      citationId: docInfo.citationId,
      title: docInfo.title,
      nodes: [targetNode],
    };
  }

  private async retrieveNodesByFilter(
    documentId: string,
    nodeType?: string,
    number?: string,
  ): Promise<RetrieveNodeResponseDto> {
    const docInfo = await this.nodeRepo.fetchDocumentInfo(documentId);

    if (nodeType || number) {
      const flatNodes = await this.nodeRepo.findAllNodes(
        documentId,
        nodeType,
        number,
      );

      if (flatNodes.length === 0) {
        return {
          citationId: docInfo.citationId,
          title: docInfo.title,
          nodes: [],
        };
      }

      const matchIds = new Set(flatNodes.map((n) => n.id));
      const allNodes = await this.nodeRepo.findAllNodes(documentId);
      const tree = this.buildTreeFromFlatNodes(allNodes);
      const matched = this.extractMatchedNodes(tree, matchIds);

      return {
        citationId: docInfo.citationId,
        title: docInfo.title,
        nodes: matched,
      };
    }

    const allNodes = await this.nodeRepo.findAllNodes(documentId);
    const tree = this.buildTreeFromFlatNodes(allNodes);
    const enriched = tree.map((n) => this.enrichNodeWithFullText(n));

    return {
      citationId: docInfo.citationId,
      title: docInfo.title,
      nodes: enriched,
    };
  }

  /** Builds a nested tree from flat nodes ordered by ltree path. */
  private buildTreeFromFlatNodes(
    flatNodes: FlatNodeRow[],
  ): RetrieveNodeItemDto[] {
    const nodeMap = new Map<string, RetrieveNodeItemDto>();
    const roots: RetrieveNodeItemDto[] = [];

    for (const row of flatNodes) {
      const node: RetrieveNodeItemDto = {
        id: row.id,
        nodeType: row.nodeType,
        label: row.label,
        ordinal: row.ordinal,
        heading: row.heading,
        fullText: null,
        textContent: row.textContent,
        contentClass: row.contentClass,
        path: row.path,
        children: [],
      };
      nodeMap.set(row.id, node);

      if (row.parentId === null) {
        roots.push(node);
      }
    }

    for (const row of flatNodes) {
      if (row.parentId && nodeMap.has(row.parentId)) {
        const parent = nodeMap.get(row.parentId)!;
        const child = nodeMap.get(row.id)!;
        parent.children.push(child);
      }
    }

    return roots;
  }

  /** Recursively computes fullText for a node (label + heading + own text + all children's full text). */
  private enrichNodeWithFullText(
    node: RetrieveNodeItemDto,
  ): RetrieveNodeItemDto {
    const enrichedChildren = node.children.map((child) =>
      this.enrichNodeWithFullText(child),
    );

    const parts: string[] = [];

    const headerLine = node.heading
      ? `${node.label} ${node.heading}`
      : node.label;
    parts.push(headerLine);

    if (node.textContent) {
      parts.push(node.textContent);
    }

    for (const child of enrichedChildren) {
      parts.push(child.fullText!);
    }

    return {
      ...node,
      children: enrichedChildren,
      fullText: parts.join('\n'),
    };
  }

  /** Recursively extracts nodes whose IDs are in matchIds, pruning unmatched branches. */
  private extractMatchedNodes(
    nodes: RetrieveNodeItemDto[],
    matchIds: Set<string>,
  ): RetrieveNodeItemDto[] {
    const results: RetrieveNodeItemDto[] = [];
    for (const node of nodes) {
      if (matchIds.has(node.id)) {
        const enriched = this.enrichNodeWithFullText(node);
        results.push(enriched);
      } else {
        const childMatches = this.extractMatchedNodes(node.children, matchIds);
        if (childMatches.length > 0) {
          results.push(...childMatches);
        }
      }
    }
    return results;
  }

  private findNodeById(
    nodes: RetrieveNodeItemDto[],
    id: string,
  ): RetrieveNodeItemDto | null {
    for (const node of nodes) {
      if (node.id === id) {
        return this.enrichNodeWithFullText(node);
      }
      const found = this.findNodeById(node.children, id);
      if (found) return found;
    }
    return null;
  }
}
