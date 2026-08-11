import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { LawApiClient } from './client.js';

interface MockFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

type FetchMock = jest.Mock<(url: string) => Promise<MockFetchResponse>>;

function buildClient(baseUrl = 'http://localhost:3000'): LawApiClient {
  return new LawApiClient(baseUrl);
}

function mockFetchOnce(body: unknown, ok = true, status = 200): FetchMock {
  const fetchMock: FetchMock = jest.fn<
    (url: string) => Promise<MockFetchResponse>
  >();
  fetchMock.mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  (global as unknown as { fetch: FetchMock }).fetch = fetchMock;
  return fetchMock;
}

describe('LawApiClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('search() encodes array filters as repeated query keys, not bracket notation', async () => {
    const fetchMock = mockFetchOnce({
      total: 0,
      page: 1,
      pageSize: 10,
      items: [],
    });
    const client = buildClient();

    await client.search({ documentTypes: ['Luật', 'Nghị định'] });

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('documentTypes=');
    expect(calledUrl).not.toContain('documentTypes%5B%5D');
    expect(calledUrl).not.toContain('documentTypes[]');
  });

  it('search() NFC-normalizes Vietnamese filter values to match stored data', async () => {
    const fetchMock = mockFetchOnce({
      total: 0,
      page: 1,
      pageSize: 10,
      items: [],
    });
    const client = buildClient();

    // NFD form: "N" "g" "h" "i" + combining dot below (U+0323) + ...
    const nfd = 'Nghị định'.normalize('NFD');
    await client.search({ documentTypes: [nfd] });

    const calledUrl = fetchMock.mock.calls[0][0];
    const parsed = new URL(calledUrl);
    const value = parsed.searchParams.get('documentTypes');
    expect(value).toBe(nfd.normalize('NFC'));
  });

  it('getById() hits /laws/index/retrieve/:id', async () => {
    const fetchMock = mockFetchOnce({ id: 'doc-1' });
    const client = buildClient();

    await client.getById('doc-1');

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe('http://localhost:3000/laws/index/retrieve/doc-1');
  });

  it('getReferences() hits /laws/index/retrieve/references with documentId and optional filters', async () => {
    const fetchMock = mockFetchOnce({
      citationId: '59/2020/QH14',
      title: 'Luật Doanh nghiệp',
      total: 0,
      references: [],
    });
    const client = buildClient();

    await client.getReferences({
      documentId: 'doc-1',
      direction: 'incoming',
      referenceType: 'amends',
    });

    const calledUrl = fetchMock.mock.calls[0][0];
    const parsed = new URL(calledUrl);
    expect(parsed.pathname).toBe('/laws/index/retrieve/references');
    expect(parsed.searchParams.get('documentId')).toBe('doc-1');
    expect(parsed.searchParams.get('direction')).toBe('incoming');
    expect(parsed.searchParams.get('referenceType')).toBe('amends');
  });

  it('throws with status and body on a non-OK response', async () => {
    mockFetchOnce({ message: 'not found' }, false, 404);
    const client = buildClient();

    await expect(client.getById('missing')).rejects.toThrow('404');
  });
});
