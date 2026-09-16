import { EventEmitter } from 'node:events';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

import { execFile } from 'node:child_process';
import { fetchDocContent, listDocsEntries, type DocsRepoScope } from '../src/rag/docsSource';

const execFileMock = execFile as unknown as jest.Mock;

function respondWith(body: unknown) {
  execFileMock.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (...cbArgs: unknown[]) => void) => {
    callback(null, JSON.stringify(body), '');
    return new EventEmitter();
  });
}

function respondWithError(message: string) {
  execFileMock.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (...cbArgs: unknown[]) => void) => {
    callback(new Error('Command failed'), '', message);
    return new EventEmitter();
  });
}

describe('docsSource — DOCS_GITHUB_USE_GH_CLI fallback', () => {
  const scope: DocsRepoScope = { owner: 'bruadam', repo: 'dalux-build-docs', ref: 'main', path: 'docs' };
  const originalFlag = process.env.DOCS_GITHUB_USE_GH_CLI;

  beforeEach(() => {
    execFileMock.mockReset();
    process.env.DOCS_GITHUB_USE_GH_CLI = '1';
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.DOCS_GITHUB_USE_GH_CLI;
    else process.env.DOCS_GITHUB_USE_GH_CLI = originalFlag;
  });

  it('lists entries via `gh api` instead of fetch when no token is passed', async () => {
    respondWith({ tree: [{ path: 'docs/laws/example.md', type: 'blob', sha: 'abc123' }], truncated: false });

    const { entries } = await listDocsEntries(scope, null);

    expect(entries).toEqual([{ path: 'docs/laws/example.md', sha: 'abc123' }]);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args] = execFileMock.mock.calls[0];
    expect(file).toBe('gh');
    expect(args).toEqual(['api', 'repos/bruadam/dalux-build-docs/git/trees/main?recursive=1']);
  });

  it('fetches file content via `gh api` and base64-decodes it', async () => {
    const raw = Buffer.from('# Example\n\nSome text.', 'utf-8');
    respondWith({ content: raw.toString('base64'), encoding: 'base64' });

    const buffer = await fetchDocContent(scope, 'docs/laws/example.md', null);

    expect(buffer.toString('utf-8')).toBe(raw.toString('utf-8'));
  });

  it('is not used once a real token is passed, even with the flag set', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ tree: [], truncated: false }),
        text: async () => '{}',
      }) as unknown as Response,
    ) as unknown as typeof fetch;

    try {
      await listDocsEntries(scope, 'a-real-token');
      expect(execFileMock).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('wraps a `gh` failure (not logged in, not installed) in a message pointing at gh auth login / DOCS_GITHUB_TOKEN', async () => {
    respondWithError('gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.');

    await expect(listDocsEntries(scope, null)).rejects.toThrow(/gh auth login/);
  });
});
