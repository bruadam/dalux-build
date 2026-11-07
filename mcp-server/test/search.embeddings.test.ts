/**
 * The embeddings path with a stubbed Mistral SDK.
 *
 * This is the default ranking in any deployment that sets MISTRAL_API_KEY, and
 * the parts most likely to break quietly — request batching, restoring the
 * order Mistral returns, and the Float32 round-trip through the .vec files —
 * are invisible to the lexical tests, which is why they are covered here.
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

import { readManifest, writeManifest } from '../src/store/file/fileAreaStore';
import { embedTexts } from '../src/search/rank';
import { searchChunks } from '../src/search/documentSearch';
import * as fileAreaIndex from '../src/tools/fileAreaIndex';
import { paragraph, writeDocx } from './fixtures/office';

/**
 * A toy "embedding": one dimension per keyword. Cosine similarity then tracks
 * keyword overlap, so the tests can assert on ranking without a real model.
 */
const KEYWORDS = ['fire', 'concrete', 'drainage', 'retention'];

function toyEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  const vector = KEYWORDS.map((keyword) => (lower.includes(keyword) ? 1 : 0));
  // Pad so the stored dimension count is realistic-ish and exercises subarray slicing.
  return [...vector, ...Array(8).fill(0)];
}

interface FetchCall {
  inputs: string[];
  model: string;
}

const mockCreate = jest.fn();
jest.mock('@mistralai/mistralai', () => ({
  Mistral: jest.fn().mockImplementation(({ apiKey }: { apiKey: string }) => {
    expect(apiKey).toBe('test-key');
    return { embeddings: { create: mockCreate } };
  }),
}));

function stubMistral(): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  mockCreate.mockImplementation(async (request: FetchCall) => {
    expect(request.model).toBe('mistral-embed');
    calls.push(request);
    return {
      data: request.inputs.map((text, index) => ({ embedding: toyEmbedding(text), index })).reverse(),
    };
  });
  return { calls, restore: () => mockCreate.mockReset() };
}

describe('embeddings ranking', () => {
  let stub: ReturnType<typeof stubMistral>;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_API_KEY = 'test-key';
    stub = stubMistral();
  });

  afterEach(() => {
    stub.restore();
    if (originalKey === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = originalKey;
    jest.clearAllMocks();
  });

  describe('embedTexts', () => {
    it('batches large inputs and keeps the vectors aligned with the texts', async () => {
      const texts = Array.from({ length: 200 }, (_, i) => (i === 137 ? 'fire rating' : `clause ${i}`));

      const vectors = await embedTexts(texts);

      expect(vectors).toHaveLength(200);
      // 200 inputs at a batch size of 96 is three requests, not one oversized one.
      expect(stub.calls).toHaveLength(3);
      expect(stub.calls.map((call) => call.inputs.length)).toEqual([96, 96, 8]);
      // Order survives both the batching and Mistral returning results shuffled.
      expect(vectors[137]).toEqual(toyEmbedding('fire rating'));
      expect(vectors[0]).toEqual(toyEmbedding('clause 0'));
    });

    it('splits batches by size so a request stays under the token limit', async () => {
      // 1000-character chunks, the indexers' default: 96 of them would be ~30k tokens in one request.
      const texts = Array.from({ length: 100 }, (_, i) => `${i}`.padEnd(1000, 'x'));

      const vectors = await embedTexts(texts);

      expect(stub.calls.map((call) => call.inputs.length)).toEqual([32, 32, 32, 4]);
      expect(vectors[99]).toEqual(toyEmbedding(texts[99]));
    });

    it('retries rate limits and transient failures with backoff', async () => {
      const { Mistral } = jest.requireMock('@mistralai/mistralai') as { Mistral: jest.Mock };

      await embedTexts(['anything']);

      expect(Mistral.mock.calls[0][0].retryConfig).toMatchObject({ strategy: 'backoff' });
    });

    it('surfaces an API failure with its status instead of returning empty results', async () => {
      mockCreate.mockRejectedValue(new Error('Mistral API error: HTTP 401'));

      await expect(embedTexts(['anything'])).rejects.toThrow(/401/);
    });

    it('makes no request at all for an empty input', async () => {
      expect(await embedTexts([])).toEqual([]);
      expect(stub.calls).toHaveLength(0);
    });
  });

  describe('single-document search', () => {
    it('ranks by meaning rather than by the words in the query', async () => {
      const chunks = [
        { page: 1, location: 'p. 1', text: 'Slab thickness and concrete cover.' },
        { page: 2, location: 'p. 2', text: 'Escape route doors and their fire rating.' },
      ];

      const { mode, matches } = await searchChunks(chunks, 'fire', 1);

      expect(mode).toBe('embeddings');
      expect(matches[0].location).toBe('p. 2');
      expect(matches[0].score).toBeCloseTo(1);
    });

    it('prefilters with BM25 before embedding a very large document', async () => {
      const chunks = Array.from({ length: 500 }, (_, i) => ({
        page: i,
        location: `p. ${i}`,
        text: i === 400 ? 'fire rating of the concrete slab' : `unrelated clause ${i}`,
      }));

      const { matches } = await searchChunks(chunks, 'fire concrete', 1);

      // 200 candidates + the query, batched — far fewer than embedding all 500.
      const embedded = stub.calls.reduce((total, call) => total + call.inputs.length, 0);
      expect(embedded).toBeLessThanOrEqual(201);
      expect(matches[0].location).toBe('p. 400');
    });
  });

  describe('file-area index', () => {
    let fixtures: string;
    let cache: string;
    let originalCacheDir: string | undefined;

    beforeEach(() => {
      fixtures = mkdtempSync(path.join(tmpdir(), 'dalux-embed-fx-'));
      cache = mkdtempSync(path.join(tmpdir(), 'dalux-embed-cache-'));
      originalCacheDir = process.env.DALUX_MCP_CACHE_DIR;
      process.env.DALUX_MCP_CACHE_DIR = cache;
    });

    afterEach(() => {
      if (originalCacheDir === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
      else process.env.DALUX_MCP_CACHE_DIR = originalCacheDir;
      rmSync(fixtures, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    });

    function clientFor(sources: Record<string, string>): DaluxClient {
      return {
        files: {
          listFiles: async () => ({
            items: Object.entries(sources).map(([fileId, source]) => ({
              fileId,
              fileName: path.basename(source),
              folderId: 'root',
              fileType: 'document',
              contentHash: 'v1',
              downloadLink: `link:${fileId}`,
              fileSize: 2048,
            })),
            metadata: { totalRemainingItems: 0 },
          }),
          downloadFileFromLink: async (link: string, name: string, dir: string) => {
            const target = path.join(dir, name);
            copyFileSync(sources[link.replace('link:', '')], target);
            return target;
          },
        },
        folders: {},
      } as unknown as DaluxClient;
    }

    it('stores vectors on disk and ranks across documents when reading them back', async () => {
      const client = clientFor({
        f1: writeDocx(fixtures, 'drainage.docx', paragraph('Surface water drainage falls to the gully.')),
        f2: writeDocx(fixtures, 'fire.docx', paragraph('Escape route doors shall hold their fire rating.')),
      });
      const scope = { projectId: 'p1', fileAreaId: 'fa-embed' };

      const built = await fileAreaIndex.buildFileAreaIndex(client, scope);
      expect(built.mode).toBe('embeddings');
      expect(built.filesIndexedThisPass).toBe(2);

      // Nothing is embedded again at query time except the query itself.
      const callsAfterBuild = stub.calls.length;
      const result = await fileAreaIndex.searchFileArea(client, { ...scope, query: 'fire' });

      expect(stub.calls).toHaveLength(callsAfterBuild + 1);
      expect(result.mode).toBe('embeddings');
      expect(result.matches[0].fileName).toBe('fire.docx');
      // Round-tripped through Float32 on disk, so exact equality would be luck.
      expect(result.matches[0].score).toBeCloseTo(1, 5);
      expect(result.warnings).toEqual([]);
    });

    it('falls back to lexical ranking, with a warning, when the key disappears', async () => {
      const client = clientFor({
        f1: writeDocx(fixtures, 'fire.docx', paragraph('Escape route doors shall hold their fire rating.')),
      });
      const scope = { projectId: 'p1', fileAreaId: 'fa-embed-gone' };
      await fileAreaIndex.buildFileAreaIndex(client, scope);

      delete process.env.MISTRAL_API_KEY;
      const result = await fileAreaIndex.searchFileArea(client, { ...scope, query: 'fire rating' });

      expect(result.mode).toBe('lexical');
      expect(result.matches[0].fileName).toBe('fire.docx');
      expect(result.warnings.join(' ')).toMatch(/MISTRAL_API_KEY is not set/);
    });

    it('refuses old model vectors and rebuilds unchanged documents with the new model', async () => {
      const client = clientFor({
        f1: writeDocx(fixtures, 'fire.docx', paragraph('Fire rating for escape route doors.')),
      });
      const scope = { projectId: 'p1', fileAreaId: 'fa-migration' };
      const built = await fileAreaIndex.buildFileAreaIndex(client, scope);
      const manifest = readManifest(built.indexId)!;
      manifest.embedding!.model = 'retired-embedding-model';
      writeManifest(manifest);
      const before = await fileAreaIndex.searchFileArea(client, { ...scope, query: 'fire' });
      expect(before.mode).toBe('lexical');
      expect(before.warnings.join(' ')).toMatch(/model changed/i);
      const rebuilt = await fileAreaIndex.buildFileAreaIndex(client, scope);
      expect(rebuilt.filesIndexedThisPass).toBe(1);
      expect(readManifest(built.indexId)!.embedding!.model).toBe('mistral-embed');
      expect((await fileAreaIndex.searchFileArea(client, { ...scope, query: 'fire' })).mode).toBe('embeddings');
    });

    it('re-embeds an index that was built without a key once one is available', async () => {
      const client = clientFor({
        f1: writeDocx(fixtures, 'fire.docx', paragraph('Escape route doors shall hold their fire rating.')),
      });
      const scope = { projectId: 'p1', fileAreaId: 'fa-embed-later' };

      delete process.env.MISTRAL_API_KEY;
      const lexical = await fileAreaIndex.buildFileAreaIndex(client, scope);
      expect(lexical.mode).toBe('lexical');

      process.env.MISTRAL_API_KEY = 'test-key';
      const upgraded = await fileAreaIndex.buildFileAreaIndex(client, scope);

      expect(upgraded.mode).toBe('embeddings');
      expect(upgraded.filesIndexedThisPass).toBe(1);
      expect(upgraded.warnings.join(' ')).toMatch(/re-embedding/i);
      expect((await fileAreaIndex.searchFileArea(client, { ...scope, query: 'fire' })).mode).toBe('embeddings');
    });
  });
});
