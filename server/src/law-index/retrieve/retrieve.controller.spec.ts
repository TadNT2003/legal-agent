import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { RetrieveController } from './retrieve.controller';
import { RetrieveService } from './retrieve.service';

describe('RetrieveController', () => {
  let app: INestApplication;
  let mockService: jest.Mocked<Partial<RetrieveService>>;

  const mockSearchResult = {
    total: 10,
    page: 1,
    pageSize: 10,
    items: [
      {
        id: 'doc-1',
        citationId: '01/2025/QH15',
        title: 'Luật Test',
        documentType: 'Luật',
        enactedDate: '2025-01-01',
      },
    ],
  };

  const mockNodeResult = {
    documentId: 'doc-1',
    nodes: [
      {
        id: 'node-1',
        nodeType: 'dieu',
        ordinal: '1',
        label: 'Điều 1',
        heading: 'Phạm vi điều chỉnh',
        textContent: 'Content here',
        fullText: 'Điều 1. Phạm vi điều chỉnh\nContent here',
        children: [],
      },
    ],
  };

  const mockReferencesResult = {
    documentId: 'doc-1',
    references: [
      {
        id: 'ref-1',
        referenceType: 'cites',
        rawCitationText: 'Điều 5 of Law 123',
        targetDocument: {
          id: 'doc-2',
          citationId: '123/2020/QH14',
          title: 'Luật Target',
        },
      },
    ],
  };

  const mockIssuingBodiesResult = {
    items: [
      {
        id: 'body-1',
        name: 'Quốc hội',
        nameEn: 'National Assembly',
        authorityRank: 1,
        scope: 'national' as const,
        parentBodyId: null,
        documentCount: 50,
      },
    ],
    total: 1,
  };

  beforeEach(async () => {
    mockService = {
      search: jest.fn().mockResolvedValue(mockSearchResult),
      retrieveNode: jest.fn().mockResolvedValue(mockNodeResult),
      findReferences: jest.fn().mockResolvedValue(mockReferencesResult),
      findIssuingBodies: jest.fn().mockResolvedValue(mockIssuingBodiesResult),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RetrieveController],
      providers: [
        { provide: RetrieveService, useValue: mockService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /laws/index/retrieve', () => {
    it('returns 200 with keyword and scope filters', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/index/retrieve')
        .query({ keyword: 'luat lao dong', searchScope: 'tieu-de' })
        .expect(200);

      expect(res.body).toHaveProperty('total', mockSearchResult.total);
      expect(mockService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          keyword: 'luat lao dong',
          searchScope: 'tieu-de',
        }),
      );
    });

    it('returns 200 with date range filters', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/index/retrieve')
        .query({
          issuedFrom: '01/01/2020',
          issuedTo: '31/12/2025',
          effectiveFrom: '01/06/2020',
          effectiveTo: '31/12/2025',
        })
        .expect(200);

      expect(mockService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          issuedFrom: '01/01/2020',
          issuedTo: '31/12/2025',
          effectiveFrom: '01/06/2020',
          effectiveTo: '31/12/2025',
        }),
      );
    });

    it('returns 200 with no filters', async () => {
      await request(app.getHttpServer())
        .get('/laws/index/retrieve')
        .expect(200);

      expect(mockService.search).toHaveBeenCalled();
    });

    it('returns 200 with documentTypes and issuingBodies filters', async () => {
      await request(app.getHttpServer())
        .get('/laws/index/retrieve')
        .query({
          documentTypes: ['Luật', 'Nghị định'],
          issuingBodies: 'Quốc hội',
          validityStatus: 'con_hieu_luc',
        })
        .expect(200);

      expect(mockService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          documentTypes: ['Luật', 'Nghị định'],
          issuingBodies: ['Quốc hội'],
          validityStatus: 'con_hieu_luc',
        }),
      );
    });
  });

  describe('GET /laws/index/retrieve/nodes', () => {
    it('returns 200 with documentId', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/index/retrieve/nodes')
        .query({ documentId: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445' })
        .expect(200);

      expect(res.body).toHaveProperty('nodes');
      expect(mockService.retrieveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
        }),
      );
    });

    it('returns 200 with nodeType and number filters', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/index/retrieve/nodes')
        .query({
          documentId: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
          nodeType: 'dieu',
          number: '31',
        })
        .expect(200);

      expect(res.body).toHaveProperty('nodes');
      expect(mockService.retrieveNode).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeType: 'dieu',
          number: '31',
        }),
      );
    });

    it('returns 200 with nodeId filter', async () => {
      const nodeId = 'a1b2c3d4-5678-40ab-8def-1234567890ab';
      const res = await request(app.getHttpServer())
        .get('/laws/index/retrieve/nodes')
        .query({
          documentId: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
          nodeId,
        })
        .expect(200);

      expect(res.body).toHaveProperty('nodes');
      expect(mockService.retrieveNode).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId }),
      );
    });

    it('returns 400 when documentId is missing', async () => {
      await request(app.getHttpServer())
        .get('/laws/index/retrieve/nodes')
        .expect(400);
    });
  });

  describe('GET /laws/index/retrieve/references', () => {
    it('returns 200 with outgoing direction', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/index/retrieve/references')
        .query({
          documentId: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
          direction: 'outgoing',
        })
        .expect(200);

      expect(res.body).toHaveProperty('references');
      expect(mockService.findReferences).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'outgoing' }),
      );
    });

    it('returns 200 with incoming direction', async () => {
      await request(app.getHttpServer())
        .get('/laws/index/retrieve/references')
        .query({
          documentId: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
          direction: 'incoming',
        })
        .expect(200);

      expect(mockService.findReferences).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'incoming' }),
      );
    });

    it('returns 200 with all direction', async () => {
      await request(app.getHttpServer())
        .get('/laws/index/retrieve/references')
        .query({
          documentId: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
          direction: 'all',
        })
        .expect(200);

      expect(mockService.findReferences).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'all' }),
      );
    });

    it('returns 200 with referenceType filter', async () => {
      await request(app.getHttpServer())
        .get('/laws/index/retrieve/references')
        .query({
          documentId: 'bd76b9be-5fb6-45c4-9e32-5d16b7866445',
          referenceType: 'amends',
        })
        .expect(200);

      expect(mockService.findReferences).toHaveBeenCalledWith(
        expect.objectContaining({ referenceType: 'amends' }),
      );
    });
  });

  describe('GET /laws/index/retrieve/issuing-bodies', () => {
    it('returns 200 with no filters', async () => {
      const res = await request(app.getHttpServer())
        .get('/laws/index/retrieve/issuing-bodies')
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      expect(mockService.findIssuingBodies).toHaveBeenCalled();
    });

    it('returns 200 with keyword filter', async () => {
      await request(app.getHttpServer())
        .get('/laws/index/retrieve/issuing-bodies')
        .query({ keyword: 'Quốc hội' })
        .expect(200);

      expect(mockService.findIssuingBodies).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'Quốc hội' }),
      );
    });

    it('returns 200 with scope filter', async () => {
      await request(app.getHttpServer())
        .get('/laws/index/retrieve/issuing-bodies')
        .query({ scope: 'national' })
        .expect(200);

      expect(mockService.findIssuingBodies).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'national' }),
      );
    });
  });
});