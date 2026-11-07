import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LoadedModel } from '@ifc-lite/mcp';
import type { DaluxClient } from 'dalux-build-api';

jest.mock('../src/ifc/session', () => ({
  ensureLocalIfc: async () => '/tmp/model.ifc',
  assertReadable: async () => undefined,
}));
jest.mock('../src/ifc/runtime', () => ({
  loadIfcLite: async () => ({
    loadIfcModel: async () => ({}),
    InMemoryModelRegistry: class {
      add() {}
    },
  }),
  loadIfcClash: async () => ({ CLASH_RULE_PRESETS: [] }),
}));

import type { RequestContext } from '../src/access/context';
import { runWithContext } from '../src/access/requestScope';
import { getClashJob, listClashJobs, startClashJob } from '../src/ifc/clashJobs';
import { getVolumeJob, startVolumeJob } from '../src/ifc/volumeJobs';
import { getEditSession, openEditSession } from '../src/ifc/editSession';
import { deleteRule, listRules, saveRule } from '../src/ifc/ruleCatalog';

const caller = (account: string, connection: string): RequestContext => ({
  account: { id: account, role: 'user' },
  connection: { id: connection },
  access: [],
});
const alice = caller('alice', 'c1');
const bob = caller('bob', 'c1');
const aliceOnC2 = caller('alice', 'c2');
const client = {} as DaluxClient;
const ref = { projectId: 'p1', fileAreaId: 'fa1', fileId: 'f1' };

describe('IFC jobs and edit sessions belong to the caller that started them', () => {
  it('hides a clash job from other accounts and connections', () => {
    const job = runWithContext(alice, () => startClashJob({ fileIds: ['f1'], models: [], rules: [] }));
    expect(runWithContext(alice, () => getClashJob(job.id))).toBe(job);
    expect(runWithContext(alice, () => listClashJobs())).toContain(job);
    expect(runWithContext(bob, () => getClashJob(job.id))).toBeUndefined();
    expect(runWithContext(bob, () => listClashJobs())).not.toContain(job);
    expect(runWithContext(aliceOnC2, () => getClashJob(job.id))).toBeUndefined();
    expect(getClashJob(job.id)).toBeUndefined();
  });

  it('hides a volume job from other accounts', () => {
    const job = runWithContext(alice, () => startVolumeJob({ fileId: 'f1', model: {} as LoadedModel }));
    expect(runWithContext(alice, () => getVolumeJob(job.id))).toBe(job);
    expect(runWithContext(bob, () => getVolumeJob(job.id))).toBeUndefined();
  });

  it('keeps jobs visible without accounts (stdio, header mode)', () => {
    const job = startVolumeJob({ fileId: 'f1', model: {} as LoadedModel });
    expect(getVolumeJob(job.id)).toBe(job);
  });

  it('answers unknown editId to other accounts', async () => {
    const session = await runWithContext(alice, () => openEditSession(client, ref));
    await expect(runWithContext(alice, () => getEditSession(client, session.id))).resolves.toBe(session);
    await expect(runWithContext(bob, () => getEditSession(client, session.id))).rejects.toThrow('Unknown editId');
  });
});

describe('clash rules are kept per connection', () => {
  let cacheDir: string;
  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-mcp-rules-'));
    process.env.DALUX_MCP_CACHE_DIR = cacheDir;
  });
  afterEach(() => {
    delete process.env.DALUX_MCP_CACHE_DIR;
    rmSync(cacheDir, { recursive: true, force: true });
  });

  const ids = async (context?: RequestContext) =>
    (await (context ? runWithContext(context, listRules) : listRules())).map((rule) => rule.id);

  it('does not share saved rules between connections', async () => {
    runWithContext(alice, () => saveRule({ name: 'Ducts vs beams', a: 'IfcDuct*', b: 'IfcBeam' }));
    expect(await ids(bob)).toEqual(['ducts-vs-beams']);
    expect(await ids(aliceOnC2)).toEqual([]);
    expect(await ids()).toEqual([]);
    expect(runWithContext(aliceOnC2, () => deleteRule('ducts-vs-beams'))).toBe(false);
    expect(runWithContext(bob, () => deleteRule('ducts-vs-beams'))).toBe(true);
  });
});
