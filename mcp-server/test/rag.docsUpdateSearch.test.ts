import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as docsIndex from '../src/tools/docsIndex';
import { docsIndexRoot } from '../src/cachePaths';

type FakeClient = Parameters<typeof docsIndex.searchDocs>[0];
const fakeClient = null as unknown as FakeClient;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function fakeGithub(files: Record<string, Buffer>) {
  return jest.fn(async (input: string) => {
    const url = new URL(input);
    if (/\/git\/trees\//.test(url.pathname)) {
      const tree = Object.entries(files).map(([entryPath, buffer]) => ({
        path: entryPath,
        type: 'blob',
        sha: `sha-${entryPath}-${buffer.length}-${buffer.subarray(0, 8).toString('hex')}`,
      }));
      return jsonResponse({ tree, truncated: false });
    }
    const match = url.pathname.match(/\/contents\/(.+)$/);
    if (match) {
      const filePath = decodeURIComponent(match[1]);
      const buffer = files[filePath];
      if (!buffer) return jsonResponse({ message: 'Not Found' }, 404);
      return jsonResponse({ content: buffer.toString('base64'), encoding: 'base64' });
    }
    return jsonResponse({ message: 'unhandled in test' }, 404);
  });
}

const lawMd = Buffer.from(
  ['# Example Act', '', '## Section 1 — Duty holders', '', 'The principal contractor is responsible for site safety.'].join('\n'),
  'utf-8',
);

describe('search_docs (env-pinned scope, no owner/repo/ref/path/indexId args — index built out-of-band by docs:build)', () => {
  let cache: string;
  let originalFetch: typeof fetch;
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    cache = mkdtempSync(path.join(tmpdir(), 'dalux-docs-cache-'));
    for (const key of ['DALUX_MCP_CACHE_DIR', 'DALUX_MCP_DOCS_DIR', 'OPENAI_API_KEY', 'DOCS_GITHUB_OWNER', 'DOCS_GITHUB_REPO', 'DOCS_GITHUB_REF', 'DOCS_GITHUB_PATH']) {
      originalEnv[key] = process.env[key];
    }
    process.env.DALUX_MCP_CACHE_DIR = cache;
    delete process.env.OPENAI_API_KEY;
    process.env.DOCS_GITHUB_OWNER = 'bruadam';
    process.env.DOCS_GITHUB_REPO = 'search-docs-repo';
    process.env.DOCS_GITHUB_REF = 'main';
    process.env.DOCS_GITHUB_PATH = 'docs';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(cache, { recursive: true, force: true });
  });

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('search_docs errors clearly before the corpus has ever been indexed, pointing at docs:build', async () => {
    await expect(docsIndex.searchDocs(fakeClient, { query: 'site safety' })).rejects.toThrow(/docs:build/);
  });

  it('finds documents indexed by the out-of-band build (buildDocsIndex, same as docs:build calls), with no scope args on the search call', async () => {
    global.fetch = fakeGithub({ 'docs/laws/example-law.md': lawMd }) as unknown as typeof fetch;

    // docs:build resolves scope from these same env vars via docsIndex.buildDocsIndex({}) — no CLI args needed.
    const report = await docsIndex.buildDocsIndex(fakeClient, {});
    expect(report.complete).toBe(true);
    expect(report.docsIndexedThisPass).toBe(1);

    const result = await docsIndex.searchDocs(fakeClient, { query: 'principal contractor site safety' });
    expect(result.docsSearched).toBe(1);
    expect(result.matches[0].path).toBe('docs/laws/example-law.md');
    expect(result.indexedDocs).toBe(1);
  });

  it('throws a clear setup error when DOCS_GITHUB_OWNER/REPO are unset (docs:build, not search_docs, needs them)', async () => {
    const owner = process.env.DOCS_GITHUB_OWNER;
    const repo = process.env.DOCS_GITHUB_REPO;
    delete process.env.DOCS_GITHUB_OWNER;
    delete process.env.DOCS_GITHUB_REPO;
    try {
      await expect(docsIndex.buildDocsIndex(fakeClient, {})).rejects.toThrow(/DOCS_GITHUB_OWNER/);
    } finally {
      process.env.DOCS_GITHUB_OWNER = owner;
      process.env.DOCS_GITHUB_REPO = repo;
    }
  });
});

describe('docsIndexRoot persistence', () => {
  const originalCacheDir = process.env.DALUX_MCP_CACHE_DIR;
  const originalDocsDir = process.env.DALUX_MCP_DOCS_DIR;
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalCacheDir === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
    else process.env.DALUX_MCP_CACHE_DIR = originalCacheDir;
    if (originalDocsDir === undefined) delete process.env.DALUX_MCP_DOCS_DIR;
    else process.env.DALUX_MCP_DOCS_DIR = originalDocsDir;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it('defaults to a directory under the home dir, not the OS temp dir', () => {
    delete process.env.DALUX_MCP_CACHE_DIR;
    delete process.env.DALUX_MCP_DOCS_DIR;
    const root = docsIndexRoot();
    expect(root).not.toContain(tmpdir());
    expect(root.endsWith(path.join('.dalux-mcp', 'docs-index'))).toBe(true);
  });

  it('DALUX_MCP_DOCS_DIR overrides the default independently of DALUX_MCP_CACHE_DIR', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dalux-docs-dir-'));
    process.env.DALUX_MCP_DOCS_DIR = dir;
    delete process.env.DALUX_MCP_CACHE_DIR;
    try {
      expect(docsIndexRoot()).toBe(path.join(path.resolve(dir), 'docs-index'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
