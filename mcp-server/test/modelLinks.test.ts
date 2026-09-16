import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const getFile = jest.fn();
jest.mock('dalux-build-api', () => ({
  createClient: jest.fn(() => ({ files: { getFile } })),
}));

let cacheDir: string;
jest.mock('../src/cachePaths', () => ({
  cacheDirFor: jest.fn((fileId: string) => path.join(cacheDir, fileId)),
}));

import { createModelLinkStore, resolveModelFile } from '../src/modelLinks';
import { createClient } from 'dalux-build-api';

const TICKET = {
  daluxBaseUrl: 'https://acme.dalux.com/api',
  daluxApiKey: 'test-api-key',
  projectId: 'p1',
  fileAreaId: 'fa1',
  fileId: 'f1',
};

describe('createModelLinkStore', () => {
  it('issues a token that resolves back to the record', () => {
    const store = createModelLinkStore();
    const token = store.issue(TICKET);
    const resolved = store.consume(token);
    expect(resolved).toMatchObject(TICKET);
    expect(resolved?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('issues distinct tokens for distinct calls', () => {
    const store = createModelLinkStore();
    const a = store.issue(TICKET);
    const b = store.issue(TICKET);
    expect(a).not.toEqual(b);
  });

  it('is not single-use — a second consume of the same token still resolves', () => {
    const store = createModelLinkStore();
    const token = store.issue(TICKET);
    expect(store.consume(token)).toMatchObject(TICKET);
    expect(store.consume(token)).toMatchObject(TICKET);
  });

  it('returns undefined for an unknown token', () => {
    const store = createModelLinkStore();
    expect(store.consume('does-not-exist')).toBeUndefined();
  });

  it('expires tickets after their TTL', () => {
    jest.useFakeTimers();
    try {
      const store = createModelLinkStore();
      const token = store.issue(TICKET);
      jest.advanceTimersByTime(16 * 60_000);
      expect(store.consume(token)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('resolveModelFile', () => {
  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-mcp-test-'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('downloads via the Dalux client when nothing is cached', async () => {
    getFile.mockResolvedValue({ downloadedFilePath: '/tmp/whatever/model.ifc', data: { fileName: 'model.ifc' } });

    const filePath = await resolveModelFile({ ...TICKET, expiresAt: Date.now() + 1000 });

    expect(createClient).toHaveBeenCalledWith({ baseUrl: TICKET.daluxBaseUrl, apiKey: TICKET.daluxApiKey });
    expect(getFile).toHaveBeenCalledWith(TICKET.projectId, TICKET.fileAreaId, TICKET.fileId, {
      download: true,
      savePath: path.join(cacheDir, TICKET.fileId),
    });
    expect(filePath).toBe('/tmp/whatever/model.ifc');
  });

  it('reuses an already-cached file without calling the Dalux client again', async () => {
    const dir = path.join(cacheDir, TICKET.fileId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'model.ifc'), 'IFC content');

    const filePath = await resolveModelFile({ ...TICKET, expiresAt: Date.now() + 1000 });

    expect(getFile).not.toHaveBeenCalled();
    expect(filePath).toBe(path.join(dir, 'model.ifc'));
  });

  it('returns undefined when the download fails (client returns a not-found string)', async () => {
    getFile.mockResolvedValue('File not found');

    const filePath = await resolveModelFile({ ...TICKET, expiresAt: Date.now() + 1000 });

    expect(filePath).toBeUndefined();
  });
});
