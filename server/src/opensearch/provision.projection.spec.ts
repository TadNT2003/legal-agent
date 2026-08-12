import type { FlatNodeRow } from '../persistence/document-node.repository';
import {
  projectDocument,
  type DocumentProjectionMeta,
} from './provision.projection';

const baseMeta: DocumentProjectionMeta = {
  documentId: 'doc-1',
  citationId: '45/2019/QH14',
  documentType: 'Luật',
  issuingBodyId: 'body-1',
  authorityRank: 2,
  enactedDate: '2019-11-20',
  effectiveDate: '2021-01-01',
  contentVersion: 'hash-doc-1',
};

let idCounter = 0;
function node(
  overrides: Partial<FlatNodeRow> & { nodeType: string },
): FlatNodeRow {
  idCounter += 1;
  return {
    id: `node-${idCounter}`,
    documentId: 'doc-1',
    parentId: null,
    contentClass: null,
    path: `path${idCounter}`,
    ordinal: String(idCounter),
    label: `Label ${idCounter}`,
    heading: null,
    textContent: null,
    contentHash: `hash-${idCounter}`,
    status: null,
    validFrom: '2019-11-20',
    validTo: null,
    supersededByNodeId: null,
    ...overrides,
  };
}

describe('projectDocument', () => {
  it('folds Khoản and Điểm into their parent Điều', () => {
    const dieu = node({
      nodeType: 'dieu',
      path: 'dieu2',
      label: 'Điều 2',
      heading: 'Giải thích từ ngữ',
      textContent: null,
    });
    const khoan1 = node({
      nodeType: 'khoan',
      parentId: dieu.id,
      path: 'dieu2.khoan1',
      label: 'Khoản 1',
      textContent: 'Khoản một nói về A.',
    });
    const khoan2 = node({
      nodeType: 'khoan',
      parentId: dieu.id,
      path: 'dieu2.khoan2',
      label: 'Khoản 2',
      textContent: 'Khoản hai nói về B.',
    });
    const diemA = node({
      nodeType: 'diem',
      parentId: khoan2.id,
      path: 'dieu2.khoan2.diema',
      label: 'a)',
      textContent: 'Điểm a của khoản hai.',
    });
    const diemB = node({
      nodeType: 'diem',
      parentId: khoan2.id,
      path: 'dieu2.khoan2.diemb',
      label: 'b)',
      textContent: 'Điểm b của khoản hai.',
    });

    const result = projectDocument(baseMeta, [
      dieu,
      khoan1,
      khoan2,
      diemA,
      diemB,
    ]);

    expect(result.provisions).toHaveLength(1);
    const [provision] = result.provisions;
    expect(provision.id).toBe(dieu.id);
    expect(provision.source.node_type).toBe('dieu');
    expect(provision.source.heading).toBe('Giải thích từ ngữ');
    expect(provision.source.khoan).toHaveLength(2);
    expect(provision.source.khoan[0]).toMatchObject({
      khoan_id: khoan1.id,
      label: 'Khoản 1',
      text: 'Khoản một nói về A.',
    });
    expect(provision.source.khoan[1].text).toBe(
      'Khoản hai nói về B.\na) Điểm a của khoản hai.\nb) Điểm b của khoản hai.',
    );
    expect(provision.source.body).toBe(
      [
        'Khoản một nói về A.',
        'Khoản hai nói về B.\na) Điểm a của khoản hai.\nb) Điểm b của khoản hai.',
      ].join('\n\n'),
    );
    expect(result.stats).toEqual({
      provisionsProjected: 1,
      templatePhuLucSkipped: 0,
      khoanFolded: 2,
    });
  });

  it('projects an Điều with no Khoản as a leaf provision', () => {
    const dieu = node({
      nodeType: 'dieu',
      label: 'Điều 1',
      heading: 'Phạm vi điều chỉnh',
      textContent: 'Thông tư này quy định về ...',
    });

    const result = projectDocument(baseMeta, [dieu]);

    expect(result.provisions).toHaveLength(1);
    expect(result.provisions[0].source.khoan).toEqual([]);
    expect(result.provisions[0].source.body).toBe(
      'Thông tư này quy định về ...',
    );
    expect(result.stats.khoanFolded).toBe(0);
  });

  it('indexes a normative Phụ lục as a top-level provision with an empty khoan[]', () => {
    const phuLuc = node({
      nodeType: 'phu_luc',
      contentClass: 'normative',
      label: 'Phụ lục I',
      heading: 'Danh mục thủ tục hành chính',
      textContent: 'Nội dung phụ lục...',
    });

    const result = projectDocument(baseMeta, [phuLuc]);

    expect(result.provisions).toHaveLength(1);
    expect(result.provisions[0].source.node_type).toBe('phu_luc');
    expect(result.provisions[0].source.khoan).toEqual([]);
    expect(result.provisions[0].source.body).toBe('Nội dung phụ lục...');
    expect(result.stats.templatePhuLucSkipped).toBe(0);
  });

  it('skips a template Phụ lục but counts it', () => {
    const phuLuc = node({
      nodeType: 'phu_luc',
      contentClass: 'template',
      label: 'Phụ lục II',
      textContent: 'Mẫu biểu trống...',
    });

    const result = projectDocument(baseMeta, [phuLuc]);

    expect(result.provisions).toHaveLength(0);
    expect(result.stats).toEqual({
      provisionsProjected: 0,
      templatePhuLucSkipped: 1,
      khoanFolded: 0,
    });
  });

  it('never emits container nodes (Phần/Chương/Mục/Tiểu mục), even when present', () => {
    const chuong = node({
      nodeType: 'chuong',
      path: 'chuong1',
      label: 'Chương I',
      heading: 'Quy định chung',
    });
    const dieu = node({
      nodeType: 'dieu',
      parentId: chuong.id,
      path: 'chuong1.dieu1',
      label: 'Điều 1',
      textContent: 'Nội dung điều 1.',
    });

    const result = projectDocument(baseMeta, [chuong, dieu]);

    expect(result.provisions).toHaveLength(1);
    expect(result.provisions[0].source.node_type).toBe('dieu');
    expect(result.provisions.some((p) => p.id === chuong.id)).toBe(false);
  });

  it('omits heading/status/valid_to/effective_date when null rather than sending null', () => {
    const dieu = node({
      nodeType: 'dieu',
      label: 'Điều 5',
      heading: null,
      status: null,
      validTo: null,
      textContent: 'Nội dung.',
    });

    const result = projectDocument({ ...baseMeta, effectiveDate: null }, [
      dieu,
    ]);

    const { source } = result.provisions[0];
    expect(source).not.toHaveProperty('heading');
    expect(source).not.toHaveProperty('status');
    expect(source).not.toHaveProperty('valid_to');
    expect(source).not.toHaveProperty('effective_date');
    expect(Object.keys(source)).not.toContain('heading');
  });

  it('includes heading/status/valid_to/effective_date when present', () => {
    const dieu = node({
      nodeType: 'dieu',
      label: 'Điều 6',
      heading: 'Some heading',
      status: 'con_hieu_luc',
      validTo: '2030-01-01',
      textContent: 'Nội dung.',
    });

    const result = projectDocument(baseMeta, [dieu]);

    const { source } = result.provisions[0];
    expect(source.heading).toBe('Some heading');
    expect(source.status).toBe('con_hieu_luc');
    expect(source.valid_to).toBe('2030-01-01');
    expect(source.effective_date).toBe('2021-01-01');
  });
});
