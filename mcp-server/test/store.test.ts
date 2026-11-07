import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

import { buildIndex } from '../src/rag/build';
import { resolveScope } from '../src/rag/scope';
import { searchIndex } from '../src/rag/search';
import { indexStores, setIndexStores } from '../src/store';
import type { IndexManifest, IndexStore, IndexSummary, IndexedDocument } from '../src/store/types';
import { paragraph, writeDocx } from './fixtures/office';

function fakeClient(source: string): DaluxClient {
  return {
    files: {
      listFiles: async () => ({
        items: [
          { fileId: 'f1', fileName: 'spec.docx', folderId: 'leaf', contentHash: 'v1', downloadLink: 'link:f1', fileSize: 1024 },
        ],
        metadata: { totalRemainingItems: 0 },
      }),
      downloadFileFromLink: async (_link: string, name: string, dir: string) => {
        const target = path.join(dir, name);
        copyFileSync(source, target);
        return target;
      },
    },
    folders: {
      listFolders: async () => ({
        items: [
          { folderId: 'root', parentFolderId: null },
          { folderId: 'mid', parentFolderId: 'root' },
          { folderId: 'leaf', parentFolderId: 'mid' },
        ],
        metadata: { totalRemainingItems: 0 },
      }),
    },
  } as unknown as DaluxClient;
}

function memoryStore(): IndexStore<IndexManifest, IndexedDocument, IndexSummary> & { documents: Map<string, IndexedDocument> } {
  const manifests = new Map<string, IndexManifest>();
  const documents = new Map<string, IndexedDocument>();
  return {
    documents,
    readManifest: async (indexId) => manifests.get(indexId) ?? null,
    writeManifest: async (manifest) => void manifests.set(manifest.indexId, structuredClone(manifest)),
    readDocument: async (indexId, fileId) => documents.get(`${indexId}/${fileId}`) ?? null,
    writeDocument: async (indexId, document) => void documents.set(`${indexId}/${document.fileId}`, document),
    readVectors: async () => null,
    deleteDocument: async (indexId, fileId) => void documents.delete(`${indexId}/${fileId}`),
    dropIndex: async (indexId) => manifests.delete(indexId),
    listIndexes: async () => [],
  };
}

describe('index store', () => {
  let fixtures: string;
  let cache: string;
  let spec: string;
  let originalCacheDir: string | undefined;
  let originalKey: string | undefined;

  beforeAll(() => {
    fixtures = mkdtempSync(path.join(tmpdir(), 'dalux-fixtures-'));
    cache = mkdtempSync(path.join(tmpdir(), 'dalux-cache-'));
    originalCacheDir = process.env.DALUX_MCP_CACHE_DIR;
    process.env.DALUX_MCP_CACHE_DIR = cache;
    originalKey = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    spec = writeDocx(fixtures, 'spec.docx', paragraph('Doors in escape routes shall achieve fire rating EI60.'));
  });

  afterAll(() => {
    if (originalCacheDir === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
    else process.env.DALUX_MCP_CACHE_DIR = originalCacheDir;
    if (originalKey !== undefined) process.env.MISTRAL_API_KEY = originalKey;
    rmSync(fixtures, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });

  it('stores where each document lives, with folder ancestry when the build listed folders', async () => {
    const client = fakeClient(spec);
    const scope = await resolveScope(client, { projectId: 'p1', fileAreaId: 'fa1', folderId: 'root' });
    const report = await buildIndex(client, scope);

    const document = await indexStores().fileAreas.readDocument(report.indexId, 'f1');
    expect(document?.access).toEqual({
      projectId: 'p1',
      fileAreaId: 'fa1',
      folderId: 'leaf',
      folderAncestorIds: ['root', 'mid'],
    });
  });

  it('leaves folder ancestry unknown when the build did not list folders', async () => {
    const client = fakeClient(spec);
    const scope = await resolveScope(client, { projectId: 'p1', fileAreaId: 'fa1' });
    const report = await buildIndex(client, scope);

    const document = await indexStores().fileAreas.readDocument(report.indexId, 'f1');
    expect(document?.access).toEqual({ projectId: 'p1', fileAreaId: 'fa1', folderId: 'leaf' });
  });

  it('builds and searches through whichever store is installed', async () => {
    const original = indexStores();
    const fileAreas = memoryStore();
    setIndexStores({ ...original, fileAreas });
    try {
      const client = fakeClient(spec);
      const scope = await resolveScope(client, { projectId: 'p2', fileAreaId: 'fa1' });
      const report = await buildIndex(client, scope);
      expect(fileAreas.documents.size).toBe(1);

      const result = await searchIndex(report.indexId, 'fire rating');
      expect(result.matches[0]?.fileId).toBe('f1');
    } finally {
      setIndexStores(original);
    }
  });
});
