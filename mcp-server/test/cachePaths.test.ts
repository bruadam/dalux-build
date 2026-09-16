import path from 'node:path';

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
