import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runWithContext } from '../src/access/requestScope';
import { cacheDirFor, derivedDirFor, mcpCacheRoot } from '../src/cachePaths';

const previousCacheDir = process.env.DALUX_MCP_CACHE_DIR;

afterEach(() => {
  if (previousCacheDir === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
  else process.env.DALUX_MCP_CACHE_DIR = previousCacheDir;
});

describe('derivedDirFor', () => {
  it('keeps derived artifacts out of the download directory', () => {
    // modelLinks.resolveModelFile serves the first non-dot entry of the
    // download directory as the model, so a schedule CSV or clash JSON landing
    // in there would be handed to the 3D viewer instead of the IFC.
    const download = cacheDirFor('f1');
    const derived = derivedDirFor('f1');

    expect(derived).not.toEqual(download);
    expect(path.relative(download, derived).startsWith('..')).toBe(true);
    expect(path.relative(mcpCacheRoot(), derived).startsWith('..')).toBe(false);
  });

  it('separates artifacts per file', () => {
    expect(derivedDirFor('f1')).not.toEqual(derivedDirFor('f2'));
  });
});

describe('file cache scope', () => {
  const inConnection = (id: string) => runWithContext({ access: 'unrestricted', connection: { id } }, () => ({ files: cacheDirFor('f1'), derived: derivedDirFor('f1') }));

  it('keeps downloads and derived artifacts of different connections apart', () => {
    const a = inConnection('conn-a');
    const b = inConnection('conn-b');
    expect(a.files).not.toEqual(b.files);
    expect(a.derived).not.toEqual(b.derived);
    expect(a.files).toEqual(inConnection('conn-a').files);
  });

  it('uses the credentials namespace in header mode', () => {
    const dir = runWithContext({ access: 'unrestricted', fileNamespace: 'abc123' }, () => cacheDirFor('f1'));
    expect(dir).toContain(`${path.sep}abc123${path.sep}`);
  });

  it.each(['../escape', 'a/b', '..', '', 'x\\y'])('refuses the file id %j, which could leave the cache', (fileId) => {
    expect(() => cacheDirFor(fileId)).toThrow('Invalid file id');
    expect(() => derivedDirFor(fileId)).toThrow('Invalid file id');
  });
});

describe('cache directory permissions (SECURITY-ANALYSIS #4)', () => {
  it('creates cache directories readable by the server user only', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dalux-cache-mode-'));
    process.env.DALUX_MCP_CACHE_DIR = path.join(root, 'cache');
    try {
      const dir = cacheDirFor('f1');
      for (const created of [dir, path.dirname(dir), mcpCacheRoot()]) {
        expect(statSync(created).mode & 0o077).toBe(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
