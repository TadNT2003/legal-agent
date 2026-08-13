import { RetrieveService } from './retrieve.service';
import type { DocumentRepository } from '../persistence/document.repository';
import type {
  DocumentNodeRepository,
  FlatNodeRow,
} from '../persistence/document-node.repository';
import type { RetrieveNodeItemDto } from './dto/retrieve-node-response.dto';

const docId = 'doc-1';
const citationId = '51/2024/QH15';
const title = 'Luật Đất đai';

function mkRow(overrides: Partial<FlatNodeRow> & { id: string }): FlatNodeRow {
  return {
    id: overrides.id,
    documentId: docId,
    parentId: null,
    nodeType: 'dieu',
    contentClass: null,
    path: 'dieu1',
    ordinal: '1',
    label: 'Điều 1',
    heading: null,
    textContent: null,
    contentHash: 'hash',
    status: 'con_hieu_luc',
    validFrom: '2024-01-01',
    validTo: null,
    supersededByNodeId: null,
    ...overrides,
  };
}

function buildMockRepo(
  findAllNodesResult: FlatNodeRow[],
  findNodeSubtreeNodes: FlatNodeRow[] | null = null,
): { repo: DocumentRepository; nodeRepo: DocumentNodeRepository } {
  const nodeRepo = {
    fetchDocumentInfo: jest.fn().mockResolvedValue({ citationId, title }),
    findAllNodes: jest
      .fn()
      .mockResolvedValueOnce(findAllNodesResult)
      .mockResolvedValue(findAllNodesResult),
    findNodeSubtree: jest.fn().mockResolvedValue({
      docInfo: { citationId, title },
      nodes: findNodeSubtreeNodes ?? findAllNodesResult,
    }),
  } as unknown as DocumentNodeRepository;

  const repo = {
    searchLocalDocuments: jest.fn().mockResolvedValue({
      total: 0,
      page: 1,
      pageSize: 10,
      items: [],
    }),
  } as unknown as DocumentRepository;

  return { repo, nodeRepo };
}

describe('RetrieveService', () => {
  let service: RetrieveService;
  let repo: DocumentRepository;
  let nodeRepo: DocumentNodeRepository;

  beforeEach(() => {
    ({ repo, nodeRepo } = buildMockRepo([]));
    service = new RetrieveService(repo, nodeRepo);
  });

  describe('search()', () => {
    it('delegates to repo.searchLocalDocuments', async () => {
      const filters = { keyword: 'test' };
      const result = await service.search(filters);
      expect(repo.searchLocalDocuments).toHaveBeenCalledWith(filters);
      expect(result).toBeDefined();
    });
  });

  describe('retrieveNode() with nodeId', () => {
    it('returns the target node with enriched fullText', async () => {
      const flat: FlatNodeRow[] = [
        mkRow({
          id: 'n1',
          parentId: null,
          nodeType: 'chuong',
          label: 'Chương I',
          ordinal: '1',
          heading: ' chung',
          path: 'chuong1',
          textContent: null,
        }),
        mkRow({
          id: 'n2',
          parentId: 'n1',
          nodeType: 'dieu',
          label: 'Điều 1',
          ordinal: '1',
          heading: 'Phạm vi điều chỉnh',
          path: 'chuong1.dieu1',
          textContent: 'Nội dung điều 1',
        }),
      ];

      ({ repo, nodeRepo } = buildMockRepo(flat));
      service = new RetrieveService(repo, nodeRepo);

      const result = await service.retrieveNode({
        documentId: docId,
        nodeId: 'n2',
      });

      expect(result.citationId).toBe(citationId);
      expect(result.title).toBe(title);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('n2');
      expect(result.nodes[0].fullText).toContain('Điều 1');
      expect(result.nodes[0].fullText).toContain('Phạm vi điều chỉnh');
      expect(result.nodes[0].fullText).toContain('Nội dung điều 1');
    });

    it('returns empty nodes when nodeId not found in subtree', async () => {
      const flat: FlatNodeRow[] = [
        mkRow({
          id: 'n1',
          parentId: null,
          nodeType: 'dieu',
          label: 'Điều 1',
          ordinal: '1',
          path: 'dieu1',
        }),
      ];

      ({ repo, nodeRepo } = buildMockRepo(flat));
      service = new RetrieveService(repo, nodeRepo);

      jest.spyOn(nodeRepo, 'findNodeSubtree').mockResolvedValueOnce({
        docInfo: { citationId, title },
        nodes: flat,
      });

      const result = await service.retrieveNode({
        documentId: docId,
        nodeId: 'nonexistent',
      });

      expect(result.nodes).toEqual([]);
    });
  });

  describe('retrieveNode() with nodeType+number', () => {
    it('returns matched nodes with enriched fullText', async () => {
      const allNodes: FlatNodeRow[] = [
        mkRow({
          id: 'n1',
          parentId: null,
          nodeType: 'chuong',
          label: 'Chương I',
          ordinal: '1',
          heading: ' chung',
          path: 'chuong1',
          textContent: null,
        }),
        mkRow({
          id: 'n2',
          parentId: 'n1',
          nodeType: 'dieu',
          label: 'Điều 1',
          ordinal: '1',
          heading: 'Phạm vi',
          path: 'chuong1.dieu1',
          textContent: 'Nội dung điều 1',
        }),
        mkRow({
          id: 'n3',
          parentId: 'n1',
          nodeType: 'dieu',
          label: 'Điều 2',
          ordinal: '2',
          heading: 'Đối tượng',
          path: 'chuong1.dieu2',
          textContent: 'Nội dung điều 2',
        }),
      ];

      const matched = [allNodes[1]];

      const nodeRepo = {
        fetchDocumentInfo: jest.fn().mockResolvedValue({ citationId, title }),
        findAllNodes: jest
          .fn()
          .mockResolvedValueOnce(matched)
          .mockResolvedValueOnce(allNodes),
        findNodeSubtree: jest.fn(),
      } as unknown as DocumentNodeRepository;

      service = new RetrieveService(repo, nodeRepo);

      const result = await service.retrieveNode({
        documentId: docId,
        nodeType: 'dieu',
        number: '1',
      });

      expect(nodeRepo.findAllNodes).toHaveBeenNthCalledWith(
        1,
        docId,
        'dieu',
        '1',
      );
      expect(nodeRepo.findAllNodes).toHaveBeenNthCalledWith(2, docId);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('n2');
      expect(result.nodes[0].fullText).toContain('Nội dung điều 1');
    });

    it('returns empty nodes when no filter matches', async () => {
      const nodeRepo = {
        fetchDocumentInfo: jest.fn().mockResolvedValue({ citationId, title }),
        findAllNodes: jest.fn().mockResolvedValueOnce([]),
        findNodeSubtree: jest.fn(),
      } as unknown as DocumentNodeRepository;

      service = new RetrieveService(repo, nodeRepo);

      const result = await service.retrieveNode({
        documentId: docId,
        nodeType: 'dieu',
        number: '999',
      });

      expect(result.nodes).toEqual([]);
    });
  });

  describe('retrieveNode() with no filters', () => {
    it('returns full tree with enriched fullText', async () => {
      const flat: FlatNodeRow[] = [
        mkRow({
          id: 'n1',
          parentId: null,
          nodeType: 'dieu',
          label: 'Điều 1',
          ordinal: '1',
          heading: 'Phạm vi',
          path: 'dieu1',
          textContent: 'Nội dung điều 1',
        }),
        mkRow({
          id: 'n2',
          parentId: 'n1',
          nodeType: 'khoan',
          label: 'Khoản 1',
          ordinal: '1',
          path: 'dieu1.khoan1',
          textContent: 'Nội dung khoản 1',
        }),
      ];

      ({ repo, nodeRepo } = buildMockRepo(flat));
      service = new RetrieveService(repo, nodeRepo);

      const result = await service.retrieveNode({ documentId: docId });

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('n1');
      expect(result.nodes[0].fullText).toContain('Điều 1 Phạm vi');
      expect(result.nodes[0].fullText).toContain('Nội dung điều 1');
      expect(result.nodes[0].fullText).toContain('Nội dung khoản 1');
      expect(result.nodes[0].children).toHaveLength(1);
      expect(result.nodes[0].children[0].fullText).toContain('Khoản 1');
      expect(result.nodes[0].children[0].fullText).toContain(
        'Nội dung khoản 1',
      );
    });
  });

  describe('buildTreeFromFlatNodes()', () => {
    it('builds correct nested tree from flat rows', () => {
      const flat: FlatNodeRow[] = [
        mkRow({
          id: 'n1',
          parentId: null,
          nodeType: 'chuong',
          label: 'Chương I',
          ordinal: '1',
          heading: ' chung',
          path: 'chuong1',
        }),
        mkRow({
          id: 'n2',
          parentId: 'n1',
          nodeType: 'dieu',
          label: 'Điều 1',
          ordinal: '1',
          heading: 'Phạm vi',
          path: 'chuong1.dieu1',
        }),
        mkRow({
          id: 'n3',
          parentId: 'n2',
          nodeType: 'khoan',
          label: 'Khoản 1',
          ordinal: '1',
          path: 'chuong1.dieu1.khoan1',
        }),
      ];

      const result = (service as any).buildTreeFromFlatNodes(flat);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('n1');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].id).toBe('n2');
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].id).toBe('n3');
    });

    it('handles orphans (parentId not in nodeMap)', () => {
      const flat: FlatNodeRow[] = [
        mkRow({
          id: 'n1',
          parentId: 'missing-parent',
          nodeType: 'dieu',
          label: 'Điều 1',
          ordinal: '1',
          path: 'dieu1',
        }),
      ];

      const result = (service as any).buildTreeFromFlatNodes(flat);
      expect(result).toHaveLength(0);
    });

    it('handles deep nesting 3+ levels', () => {
      const flat: FlatNodeRow[] = [
        mkRow({
          id: 'n1',
          parentId: null,
          nodeType: 'phan',
          label: 'Phần I',
          ordinal: '1',
          heading: ' chung',
          path: 'phan1',
        }),
        mkRow({
          id: 'n2',
          parentId: 'n1',
          nodeType: 'chuong',
          label: 'Chương 1',
          ordinal: '1',
          heading: ' chung',
          path: 'phan1.chuong1',
        }),
        mkRow({
          id: 'n3',
          parentId: 'n2',
          nodeType: 'muc',
          label: 'Mục 1',
          ordinal: '1',
          heading: ' chung',
          path: 'phan1.chuong1.muc1',
        }),
        mkRow({
          id: 'n4',
          parentId: 'n3',
          nodeType: 'dieu',
          label: 'Điều 1',
          ordinal: '1',
          heading: 'Phạm vi',
          path: 'phan1.chuong1.muc1.dieu1',
        }),
        mkRow({
          id: 'n5',
          parentId: 'n4',
          nodeType: 'khoan',
          label: 'Khoản 1',
          ordinal: '1',
          path: 'phan1.chuong1.muc1.dieu1.khoan1',
        }),
      ];

      const result = (service as any).buildTreeFromFlatNodes(flat);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('n1');
      expect(result[0].children[0].id).toBe('n2');
      expect(result[0].children[0].children[0].id).toBe('n3');
      expect(result[0].children[0].children[0].children[0].id).toBe('n4');
      expect(result[0].children[0].children[0].children[0].children[0].id).toBe(
        'n5',
      );
    });

    it('handles empty input', () => {
      const result = (service as any).buildTreeFromFlatNodes([]);
      expect(result).toEqual([]);
    });

    it('creates multiple root nodes', () => {
      const flat: FlatNodeRow[] = [
        mkRow({
          id: 'n1',
          parentId: null,
          nodeType: 'chuong',
          label: 'Chương I',
          ordinal: '1',
          heading: ' chung',
          path: 'chuong1',
        }),
        mkRow({
          id: 'n2',
          parentId: null,
          nodeType: 'chuong',
          label: 'Chương II',
          ordinal: '2',
          heading: ' cụ thể',
          path: 'chuong2',
        }),
      ];

      const result = (service as any).buildTreeFromFlatNodes(flat);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('n1');
      expect(result[1].id).toBe('n2');
    });
  });

  describe('enrichNodeWithFullText()', () => {
    function createNode(p: Partial<RetrieveNodeItemDto>): RetrieveNodeItemDto {
      return {
        id: p.id ?? 'id',
        nodeType: p.nodeType ?? 'dieu',
        label: p.label ?? 'Điều 1',
        ordinal: p.ordinal ?? '1',
        heading: p.heading ?? null,
        fullText: p.fullText ?? null,
        textContent: p.textContent ?? null,
        contentClass: p.contentClass ?? null,
        path: p.path ?? 'dieu1',
        children: p.children ?? [],
      };
    }

    it('computes fullText with label+heading+textContent+descendants', () => {
      const leaf: RetrieveNodeItemDto = createNode({
        id: 'leaf',
        nodeType: 'khoan',
        label: 'Khoản 1',
        ordinal: '1',
        textContent: 'Nội dung khoản',
        heading: null,
      });

      const parent: RetrieveNodeItemDto = createNode({
        id: 'parent',
        label: 'Điều 1',
        ordinal: '1',
        heading: 'Phạm vi',
        textContent: 'Nội dung điều',
        children: [leaf],
      });

      const result = (service as any).enrichNodeWithFullText(parent);

      expect(result.fullText).toBe(
        'Điều 1 Phạm vi\nNội dung điều\nKhoản 1\nNội dung khoản',
      );
      expect(result.children[0].fullText).toBe('Khoản 1\nNội dung khoản');
    });

    it('handles null textContent', () => {
      const node: RetrieveNodeItemDto = createNode({
        id: 'n1',
        label: 'Điều 1',
        ordinal: '1',
        heading: 'Phạm vi',
        textContent: null,
      });

      const result = (service as any).enrichNodeWithFullText(node);
      expect(result.fullText).toBe('Điều 1 Phạm vi');
    });

    it('handles null heading', () => {
      const node: RetrieveNodeItemDto = createNode({
        id: 'n1',
        label: 'Khoản 1',
        ordinal: '1',
        heading: null,
        textContent: 'Nội dung',
      });

      const result = (service as any).enrichNodeWithFullText(node);
      expect(result.fullText).toBe('Khoản 1\nNội dung');
    });

    it('handles leaf nodes with no heading and no textContent', () => {
      const node: RetrieveNodeItemDto = createNode({
        id: 'n1',
        label: 'Điều 1',
        ordinal: '1',
        heading: null,
        textContent: null,
      });

      const result = (service as any).enrichNodeWithFullText(node);
      expect(result.fullText).toBe('Điều 1');
    });

    it('recursively processes deeply nested children', () => {
      const greatGrandchild: RetrieveNodeItemDto = createNode({
        id: 'ggc',
        nodeType: 'diem',
        label: 'Điểm a',
        ordinal: 'a',
        textContent: 'Nội dung điểm',
      });

      const grandchild: RetrieveNodeItemDto = createNode({
        id: 'gc',
        nodeType: 'khoan',
        label: 'Khoản 1',
        ordinal: '1',
        textContent: 'Nội dung khoản',
        children: [greatGrandchild],
      });

      const parent: RetrieveNodeItemDto = createNode({
        id: 'p',
        label: 'Điều 1',
        ordinal: '1',
        heading: 'Phạm vi',
        textContent: 'Nội dung điều',
        children: [grandchild],
      });

      const result = (service as any).enrichNodeWithFullText(parent);

      expect(result.fullText).toContain('Nội dung điểm');
      expect(result.fullText).toContain('Nội dung khoản');
      expect(result.fullText).toContain('Nội dung điều');
      expect(result.children[0].fullText).toContain('Nội dung điểm');
      expect(result.children[0].fullText).toContain('Nội dung khoản');
      expect(result.children[0].children[0].fullText).toBe(
        'Điểm a\nNội dung điểm',
      );
    });
  });

  describe('extractMatchedNodes()', () => {
    function createNode(p: Partial<RetrieveNodeItemDto>): RetrieveNodeItemDto {
      return {
        id: p.id ?? 'id',
        nodeType: p.nodeType ?? 'dieu',
        label: p.label ?? 'Điều 1',
        ordinal: p.ordinal ?? '1',
        heading: p.heading ?? null,
        fullText: p.fullText ?? null,
        textContent: p.textContent ?? null,
        contentClass: p.contentClass ?? null,
        path: p.path ?? 'dieu1',
        children: p.children ?? [],
      };
    }

    it('prunes unmatched branches', () => {
      const tree: RetrieveNodeItemDto[] = [
        createNode({
          id: 'n1',
          nodeType: 'dieu',
          label: 'Điều 1',
          ordinal: '1',
          heading: 'Phạm vi',
          textContent: 'Nội dung 1',
        }),
        createNode({
          id: 'n2',
          nodeType: 'dieu',
          label: 'Điều 2',
          ordinal: '2',
          heading: 'Đối tượng',
          textContent: 'Nội dung 2',
        }),
      ];

      const matchIds = new Set(['n2']);
      const result = (service as any).extractMatchedNodes(tree, matchIds);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('n2');
      expect(result[0].fullText).not.toBeNull();
    });

    it('preserves matched children and prunes unmatched parent wrapper from results', () => {
      const tree: RetrieveNodeItemDto[] = [
        createNode({
          id: 'n1',
          nodeType: 'chuong',
          label: 'Chương I',
          ordinal: '1',
          heading: ' chung',
          textContent: null,
          children: [
            createNode({
              id: 'n2',
              nodeType: 'dieu',
              label: 'Điều 1',
              ordinal: '1',
              heading: 'Phạm vi',
              textContent: 'Nội dung 1',
            }),
          ],
        }),
      ];

      const matchIds = new Set(['n2']);
      const result = (service as any).extractMatchedNodes(tree, matchIds);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('n2');
      expect(result[0].fullText).toContain('Điều 1 Phạm vi');
      expect(result[0].fullText).toContain('Nội dung 1');
    });

    it('returns matched parent with full subtree, not also the matched descendant separately', () => {
      const tree: RetrieveNodeItemDto[] = [
        createNode({
          id: 'n1',
          nodeType: 'chuong',
          label: 'Chương I',
          ordinal: '1',
          heading: ' chung',
          textContent: null,
          children: [
            createNode({
              id: 'n2',
              nodeType: 'dieu',
              label: 'Điều 1',
              ordinal: '1',
              heading: 'Phạm vi',
              textContent: 'Nội dung điều',
              children: [
                createNode({
                  id: 'n3',
                  nodeType: 'khoan',
                  label: 'Khoản 1',
                  ordinal: '1',
                  textContent: 'Nội dung khoản',
                }),
              ],
            }),
          ],
        }),
      ];

      const matchIds = new Set(['n1', 'n3']);
      const result = (service as any).extractMatchedNodes(tree, matchIds);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('n1');
      expect(result[0].children[0].id).toBe('n2');
      expect(result[0].children[0].children[0].id).toBe('n3');
    });

    it('returns empty array when nothing matches', () => {
      const tree: RetrieveNodeItemDto[] = [
        createNode({ id: 'n1', textContent: 'text' }),
      ];
      const matchIds = new Set(['nonexistent']);
      const result = (service as any).extractMatchedNodes(tree, matchIds);
      expect(result).toEqual([]);
    });
  });

  describe('findNodeById()', () => {
    function createNode(p: Partial<RetrieveNodeItemDto>): RetrieveNodeItemDto {
      return {
        id: p.id ?? 'id',
        nodeType: p.nodeType ?? 'dieu',
        label: p.label ?? 'Điều 1',
        ordinal: p.ordinal ?? '1',
        heading: p.heading ?? null,
        fullText: p.fullText ?? null,
        textContent: p.textContent ?? null,
        contentClass: p.contentClass ?? null,
        path: p.path ?? 'dieu1',
        children: p.children ?? [],
      };
    }

    it('finds node at root level', () => {
      const tree: RetrieveNodeItemDto[] = [
        createNode({ id: 'n1', textContent: 'root' }),
        createNode({ id: 'n2', textContent: 'root2' }),
      ];

      const result = (service as any).findNodeById(tree, 'n2');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('n2');
      expect(result!.fullText).toBe('Điều 1\nroot2');
    });

    it('finds node at depth 2', () => {
      const tree: RetrieveNodeItemDto[] = [
        createNode({
          id: 'n1',
          nodeType: 'chuong',
          label: 'Chương I',
          ordinal: '1',
          heading: ' chung',
          textContent: null,
          children: [
            createNode({
              id: 'n2',
              nodeType: 'dieu',
              label: 'Điều 1',
              ordinal: '1',
              heading: 'Phạm vi',
              textContent: 'Nội dung',
              children: [
                createNode({
                  id: 'n3',
                  nodeType: 'khoan',
                  label: 'Khoản 1',
                  ordinal: '1',
                  textContent: 'Nội dung khoản',
                }),
              ],
            }),
          ],
        }),
      ];

      const result = (service as any).findNodeById(tree, 'n3');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('n3');
      expect(result!.fullText).toBe('Khoản 1\nNội dung khoản');
    });

    it('returns null for missing node', () => {
      const tree: RetrieveNodeItemDto[] = [
        createNode({ id: 'n1', textContent: 'text' }),
      ];

      const result = (service as any).findNodeById(tree, 'nonexistent');
      expect(result).toBeNull();
    });
  });
});
