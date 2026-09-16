import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let cacheDir: string;
jest.mock('../src/cachePaths', () => ({
  cacheDirFor: jest.fn((fileId: string) => path.join(cacheDir, fileId)),
}));

import { handleModelRequest, MODEL_ROUTE_PREFIX } from '../src/http';
import { createModelLinkStore } from '../src/modelLinks';
import { IFCLITE_EMBED_ORIGIN } from '../src/ui/ifcViewer';

const TICKET = {
  daluxBaseUrl: 'https://acme.dalux.com/api',
  daluxApiKey: 'test-api-key',
  projectId: 'p1',
  fileAreaId: 'fa1',
  fileId: 'f1',
};

const FIXTURE_CONTENT = 'ISO-10303-21;\nHEADER;\nIFC FIXTURE CONTENT\n';

function issueTicketFor(fileId: string): { token: string; store: ReturnType<typeof createModelLinkStore> } {
  const store = createModelLinkStore();
  const token = store.issue({ ...TICKET, fileId });
  return { token, store };
}

function writeFixture(fileId: string, content: string): void {
  const dir = path.join(cacheDir, fileId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'model.ifc'), content);
}

describe('handleModelRequest', () => {
  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-mcp-http-test-'));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('passes through (returns undefined) for paths outside /models/', async () => {
    const { store } = issueTicketFor('f1');
    const response = await handleModelRequest(new Request('https://mcp.example.com/mcp'), store);
    expect(response).toBeUndefined();
  });

  it('answers a CORS preflight for the ifclite embed origin', async () => {
    const { store } = issueTicketFor('f1');
    const response = await handleModelRequest(
      new Request('https://mcp.example.com/models/whatever', { method: 'OPTIONS' }),
      store,
    );
    expect(response?.status).toBe(204);
    expect(response?.headers.get('access-control-allow-origin')).toBe(IFCLITE_EMBED_ORIGIN);
    expect(response?.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('rejects methods other than GET/HEAD/OPTIONS', async () => {
    const { store } = issueTicketFor('f1');
    const response = await handleModelRequest(
      new Request('https://mcp.example.com/models/whatever', { method: 'POST' }),
      store,
    );
    expect(response?.status).toBe(405);
    expect(response?.headers.get('access-control-allow-origin')).toBe(IFCLITE_EMBED_ORIGIN);
  });

  it('404s for an unknown or expired token, with CORS headers still present', async () => {
    const store = createModelLinkStore();
    const response = await handleModelRequest(new Request(`https://mcp.example.com${MODEL_ROUTE_PREFIX}nope`), store);
    expect(response?.status).toBe(404);
    expect(response?.headers.get('access-control-allow-origin')).toBe(IFCLITE_EMBED_ORIGIN);
  });

  it('streams the full file on a plain GET', async () => {
    writeFixture('f1', FIXTURE_CONTENT);
    const { token, store } = issueTicketFor('f1');

    const response = await handleModelRequest(new Request(`https://mcp.example.com${MODEL_ROUTE_PREFIX}${token}`), store);

    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('application/octet-stream');
    expect(response?.headers.get('content-length')).toBe(String(Buffer.byteLength(FIXTURE_CONTENT)));
    expect(response?.headers.get('accept-ranges')).toBe('bytes');
    expect(response?.headers.get('access-control-allow-origin')).toBe(IFCLITE_EMBED_ORIGIN);
    await expect(response?.text()).resolves.toBe(FIXTURE_CONTENT);
  });

  it('serves a partial response for a Range request', async () => {
    writeFixture('f1', FIXTURE_CONTENT);
    const { token, store } = issueTicketFor('f1');

    const response = await handleModelRequest(
      new Request(`https://mcp.example.com${MODEL_ROUTE_PREFIX}${token}`, { headers: { Range: 'bytes=0-4' } }),
      store,
    );

    expect(response?.status).toBe(206);
    expect(response?.headers.get('content-range')).toBe(`bytes 0-4/${Buffer.byteLength(FIXTURE_CONTENT)}`);
    expect(response?.headers.get('content-length')).toBe('5');
    await expect(response?.text()).resolves.toBe(FIXTURE_CONTENT.slice(0, 5));
  });

  it('answers HEAD with headers only, no body', async () => {
    writeFixture('f1', FIXTURE_CONTENT);
    const { token, store } = issueTicketFor('f1');

    const response = await handleModelRequest(
      new Request(`https://mcp.example.com${MODEL_ROUTE_PREFIX}${token}`, { method: 'HEAD' }),
      store,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-length')).toBe(String(Buffer.byteLength(FIXTURE_CONTENT)));
    await expect(response?.text()).resolves.toBe('');
  });

  it('does not delete the ticket after use, so a second Range request against the same token still works', async () => {
    writeFixture('f1', FIXTURE_CONTENT);
    const { token, store } = issueTicketFor('f1');

    const first = await handleModelRequest(new Request(`https://mcp.example.com${MODEL_ROUTE_PREFIX}${token}`), store);
    expect(first?.status).toBe(200);
    const second = await handleModelRequest(new Request(`https://mcp.example.com${MODEL_ROUTE_PREFIX}${token}`), store);
    expect(second?.status).toBe(200);
  });
});
