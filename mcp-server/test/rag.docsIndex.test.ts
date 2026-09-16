import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as docsIndex from '../src/tools/docsIndex';

type FakeClient = Parameters<typeof docsIndex.buildDocsIndex>[0];
const fakeClient = null as unknown as FakeClient;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** Fakes just enough of the GitHub REST API: the recursive tree listing and per-file Contents API. */
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

describe('docs index (GitHub-sourced)', () => {
  let cache: string;
  let originalCacheDir: string | undefined;
  let originalKey: string | undefined;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    cache = mkdtempSync(path.join(tmpdir(), 'dalux-docs-cache-'));
    originalCacheDir = process.env.DALUX_MCP_CACHE_DIR;
    process.env.DALUX_MCP_CACHE_DIR = cache;
    // Ranking must be deterministic: no key means BM25, no network.
    originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterAll(() => {
    if (originalCacheDir === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
    else process.env.DALUX_MCP_CACHE_DIR = originalCacheDir;
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    rmSync(cache, { recursive: true, force: true });
  });

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const scopeArgs = { owner: 'bruadam', repo: 'dalux-build-docs', ref: 'main', path: 'docs' };

  const lawMd = Buffer.from(
    ['# Example Act', '', '## Section 1 — Duty holders', '', 'The principal contractor is responsible for site safety.'].join('\n'),
    'utf-8',
  );
  const guidelineHtml = Buffer.from(
    '<html><body><h1>Example Guideline</h1><p>Hard hats are mandatory on site.</p></body></html>',
    'utf-8',
  );

  it('indexes markdown and HTML documents from the repo tree, ignoring paths outside scope.path', async () => {
    global.fetch = fakeGithub({
      'docs/laws/example-law.md': lawMd,
      'docs/guidelines/example-guideline.html': guidelineHtml,
      'README.md': Buffer.from('# not under docs/', 'utf-8'),
    }) as unknown as typeof fetch;

    const report = await docsIndex.buildDocsIndex(fakeClient, scopeArgs);

    expect(report.complete).toBe(true);
    expect(report.mode).toBe('lexical');
    // README.md at the repo root is outside the "docs" path prefix and excluded.
    expect(report.docsInScope).toBe(2);
    expect(report.docsIndexedThisPass).toBe(2);
    expect(report.totalChunks).toBeGreaterThan(0);
    expect(report.failed).toEqual([]);
  });

  it('searches across documents and cites the path and location of each passage', async () => {
    global.fetch = fakeGithub({
      'docs/laws/example-law.md': lawMd,
      'docs/guidelines/example-guideline.html': guidelineHtml,
    }) as unknown as typeof fetch;
    await docsIndex.buildDocsIndex(fakeClient, scopeArgs);

    const law = await docsIndex.searchDocsIndex(fakeClient, { ...scopeArgs, query: 'principal contractor site safety' });
    expect(law.mode).toBe('lexical');
    expect(law.docsSearched).toBe(2);
    expect(law.matches[0].path).toBe('docs/laws/example-law.md');

    const guideline = await docsIndex.searchDocsIndex(fakeClient, { ...scopeArgs, query: 'hard hats mandatory' });
    expect(guideline.matches[0].path).toBe('docs/guidelines/example-guideline.html');

    // pathContains scopes the search to one category without a separate index per category.
    const scoped = await docsIndex.searchDocsIndex(fakeClient, {
      ...scopeArgs,
      query: 'hard hats',
      pathContains: 'laws/',
    });
    expect(scoped.matches).toEqual([]);
  });

  it('records a document that fails to extract instead of failing the whole build', async () => {
    // A .pdf that is not really a PDF at all — exercises the failure/skip path
    // without depending on a real PDF parse succeeding inside this test runner.
    global.fetch = fakeGithub({
      'docs/laws/example-law.md': lawMd,
      'docs/standards/broken.pdf': Buffer.from('not a pdf'),
    }) as unknown as typeof fetch;

    const report = await docsIndex.buildDocsIndex(fakeClient, { ...scopeArgs, repo: 'broken-repo' });

    expect(report.docsInScope).toBe(2);
    expect(report.docsIndexedThisPass).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].path).toBe('docs/standards/broken.pdf');
    expect(report.complete).toBe(true);

    // Re-running does not retry the same failure until its blob SHA changes.
    const second = await docsIndex.buildDocsIndex(fakeClient, { ...scopeArgs, repo: 'broken-repo' });
    expect(second.docsIndexedThisPass).toBe(0);
    expect(second.failed).toHaveLength(1);
  });

  it('re-fetches only documents whose blob SHA changed', async () => {
    const scope = { ...scopeArgs, repo: 'reuse-repo' };
    const files = { 'docs/laws/example-law.md': lawMd, 'docs/guidelines/example-guideline.html': guidelineHtml };

    const first = fakeGithub(files);
    global.fetch = first as unknown as typeof fetch;
    await docsIndex.buildDocsIndex(fakeClient, scope);

    const unchanged = fakeGithub(files);
    global.fetch = unchanged as unknown as typeof fetch;
    const reused = await docsIndex.buildDocsIndex(fakeClient, scope);
    expect(reused.docsIndexedThisPass).toBe(0);
    expect(reused.docsReused).toBe(2);
    expect(unchanged).not.toHaveBeenCalledWith(expect.stringMatching(/contents/));

    const revisedLaw = Buffer.concat([lawMd, Buffer.from('\n\nAmended.')]);
    const revised = fakeGithub({ ...files, 'docs/laws/example-law.md': revisedLaw });
    global.fetch = revised as unknown as typeof fetch;
    const report = await docsIndex.buildDocsIndex(fakeClient, scope);
    expect(report.docsIndexedThisPass).toBe(1);
    expect(report.docsReused).toBe(1);
  });

  it('drops documents that left the repo', async () => {
    const scope = { ...scopeArgs, repo: 'remove-repo' };
    global.fetch = fakeGithub({
      'docs/laws/example-law.md': lawMd,
      'docs/guidelines/example-guideline.html': guidelineHtml,
    }) as unknown as typeof fetch;
    await docsIndex.buildDocsIndex(fakeClient, scope);

    global.fetch = fakeGithub({ 'docs/guidelines/example-guideline.html': guidelineHtml }) as unknown as typeof fetch;
    const report = await docsIndex.buildDocsIndex(fakeClient, scope);

    expect(report.docsRemoved).toBe(1);
    const result = await docsIndex.searchDocsIndex(fakeClient, { ...scope, query: 'principal contractor' });
    expect(result.matches).toEqual([]);
    expect(result.docsSearched).toBe(1);
  });

  it('lists and drops indexes without touching GitHub', async () => {
    const scope = { ...scopeArgs, repo: 'drop-repo' };
    global.fetch = fakeGithub({ 'docs/laws/example-law.md': lawMd }) as unknown as typeof fetch;
    const built = await docsIndex.buildDocsIndex(fakeClient, scope);

    const listed = await docsIndex.listDocsIndexes();
    expect(listed.indexes.some((index) => index.indexId === built.indexId)).toBe(true);

    expect(await docsIndex.dropDocsIndex(fakeClient, { indexId: built.indexId })).toMatchObject({ dropped: true });
    expect(await docsIndex.dropDocsIndex(fakeClient, { indexId: built.indexId })).toMatchObject({ dropped: false });
    await expect(docsIndex.searchDocsIndex(fakeClient, { indexId: built.indexId, query: 'anything' })).rejects.toThrow(
      /docs:build/,
    );
  });

  it('reports a clear error when the repo or token is wrong', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ message: 'Not Found' }, 404)) as unknown as typeof fetch;

    await expect(docsIndex.buildDocsIndex(fakeClient, { ...scopeArgs, repo: 'does-not-exist' })).rejects.toThrow(/HTTP 404/);
  });

  it('indexes and finds a document whose path sanitizes to a name longer than a filesystem allows in one component', async () => {
    // Regression: a real corpus (Molio's Danish standards) has document
    // titles this long; the pre-fix sanitizer produced a >255-byte filename
    // and every one of these documents failed to index with ENAMETOOLONG.
    const longPath =
      'docs/molio/A113 Fordeling af ydelser og ansvar ved projektering, fremstilling og montage af elementer af beton og letklinkerbeton/' +
      'Anvisning - Fordeling af ydelser og ansvar ved projektering, fremstilling og montage af elementer af beton og letklinkerbeton.md';
    const scope = { ...scopeArgs, repo: 'long-filename-repo' };
    global.fetch = fakeGithub({ [longPath]: lawMd }) as unknown as typeof fetch;

    const report = await docsIndex.buildDocsIndex(fakeClient, scope);
    expect(report.docsIndexedThisPass).toBe(1);
    expect(report.failed).toEqual([]);

    const result = await docsIndex.searchDocsIndex(fakeClient, { ...scope, query: 'principal contractor site safety' });
    expect(result.matches[0]?.path).toBe(longPath);
  });
});
