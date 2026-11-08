import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';

import { runWithContext } from '../src/access/requestScope';
import { ensureLocalIfc, resolveModel } from '../src/ifc/session';

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

describe('ensureLocalIfc across connections', () => {
  const FILE_ID = 'S1';
  const ref = { projectId: 'p1', fileAreaId: 'fa1', fileId: FILE_ID };

  /** Dalux answers with a different model per connection, as two customers can reuse a file id. */
  function clientFor(content: string): DaluxClient {
    const getFile = jest.fn(async (_p: string, _a: string, _f: string, options?: { savePath?: string }) => {
      if (!options?.savePath) return { data: { fileId: FILE_ID } };
      mkdirSync(options.savePath, { recursive: true });
      const downloadedFilePath = path.join(options.savePath, 'model.ifc');
      writeFileSync(downloadedFilePath, content, 'utf-8');
      return { data: { fileId: FILE_ID }, downloadedFilePath };
    });
    return { files: { getFile } } as unknown as DaluxClient;
  }
  const as = (connection: string, run: () => Promise<string>) => runWithContext({ access: 'unrestricted', connection: { id: connection } }, run);

  it('serves one connection\'s cached model only to that connection', async () => {
    const a = await as('conn-a', () => ensureLocalIfc(clientFor('model of A'), ref));
    const b = await as('conn-b', () => ensureLocalIfc(clientFor('model of B'), ref));

    expect(a).not.toEqual(b);
    expect(readFileSync(a, 'utf-8')).toBe('model of A');
    expect(readFileSync(b, 'utf-8')).toBe('model of B');
    // a second call by A reuses its own copy, after the access check
    const again = clientFor('model of A, changed');
    expect(await as('conn-a', () => ensureLocalIfc(again, ref))).toEqual(a);
    expect(again.files.getFile).toHaveBeenCalledTimes(1);
  });
});
