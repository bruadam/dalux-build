import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

import { resolveModel } from '../src/ifc/session';

/**
 * The download cache and the resident-model map are both keyed by fileId alone
 * and shared by every credential the process serves, so a cached model must
 * still be gated on what Dalux says this caller may read — otherwise one
 * tenant's model answers another tenant's request.
 */
const REF = { projectId: 'p1', fileAreaId: 'fa1', fileId: 'S376341429678505988' };

const previousCacheDir = process.env.DALUX_MCP_CACHE_DIR;
let cacheRoot: string;

beforeEach(() => {
  cacheRoot = mkdtempSync(path.join(tmpdir(), 'ifc-session-'));
  process.env.DALUX_MCP_CACHE_DIR = cacheRoot;
});

afterEach(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
  if (previousCacheDir === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
  else process.env.DALUX_MCP_CACHE_DIR = previousCacheDir;
});

/** Put an .ifc in the shared cache, as another caller's download would have. */
function seedCachedIfc(fileId: string): void {
  const dir = path.join(cacheRoot, 'files', fileId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'model.ifc'), 'ISO-10303-21;\nENDSEC;\n', 'utf-8');
}

function clientWith(getFile: jest.Mock): DaluxClient {
  return { files: { getFile } } as unknown as DaluxClient;
}

describe('resolveModel authorization', () => {
  it('refuses a cached file the caller may not read, before touching the cache', async () => {
    seedCachedIfc(REF.fileId);
    const getFile = jest.fn(async () => {
      throw new Error('Resource not found: /5.0/projects/p1/file_areas/fa1/files/S376341429678505988');
    });

    await expect(resolveModel(clientWith(getFile), REF)).rejects.toThrow('Resource not found');
    expect(getFile).toHaveBeenCalledTimes(1);
    expect(getFile).toHaveBeenCalledWith(REF.projectId, REF.fileAreaId, REF.fileId);
  });

  it('refuses when Dalux answers with a not-found message rather than throwing', async () => {
    seedCachedIfc(REF.fileId);
    const getFile = jest.fn(async () => 'File does not exist: Files/models/tower.ifc');

    await expect(resolveModel(clientWith(getFile), REF)).rejects.toThrow(/is not readable/);
  });

  it('refuses when the lookup resolves to nothing', async () => {
    seedCachedIfc(REF.fileId);
    const getFile = jest.fn(async () => null);

    await expect(resolveModel(clientWith(getFile), REF)).rejects.toThrow(/is not readable/);
  });
});
