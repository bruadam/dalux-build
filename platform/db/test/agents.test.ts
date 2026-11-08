import { eq } from 'drizzle-orm';
import { withAccount } from '../src/db';
import {
  AgentError,
  adminStopAgent,
  createAgent,
  deleteAgent,
  getAgent,
  getRunFile,
  listAgents,
  listRuns,
  requestAgentRun,
  setAgentEnabled,
  updateAgent,
  validateSchedule,
  type AgentInput,
} from '../src/agents';
import { agentRunFiles, agentRuns, hostedAgents } from '../src/schema';
import { createTestDatabase, type TestDatabase } from './testDatabase';

let t: TestDatabase;
const ids: Record<string, string> = {};

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await t.owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(row),
  );
  return rows[0].id;
}

const input = (name = 'Brief'): AgentInput => ({
  connectionId: ids.conn,
  projectId: 'P1',
  name,
  instructions: 'Do the thing.',
  schedule: '0 5 * * *',
  capabilities: ['projects:read'],
  tools: ['get_project'],
});

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { cause?: { code?: string } }).cause?.code;
  }
  throw new Error('expected the query to fail');
}

beforeAll(async () => {
  t = await createTestDatabase();
  ids.conn = await insert('connections', { name: 'Acme', slug: 'acme', base_url: 'https://acme.dalux.com', api_key_encrypted: 'v1.x.y', api_key_last4: '1234' });
  for (const [name, role] of [['alice', 'user'], ['bob', 'user'], ['root', 'admin']]) {
    ids[name] = await insert('accounts', { type: 'personal', email: `${name}@example.com`, name, role });
  }
  ids.robot = await insert('accounts', { type: 'robot', name: 'robot', owner_account_id: ids.alice });
});

afterAll(async () => {
  await t?.drop();
});

describe('hosted agents: access', () => {
  let agent: string;
  let runId: string;

  beforeAll(async () => {
    agent = await createAgent(t.as('web'), ids.alice, input());
    const worker = t.as('worker');
    [{ id: runId }] = await worker.insert(agentRuns).values({ agentId: agent, trigger: 'manual', outputMarkdown: 'secret memory text' }).returning({ id: agentRuns.id });
    await worker.insert(agentRunFiles).values({ runId, name: 'r.md', contentType: 'text/markdown', size: 3, content: Buffer.from('abc') });
  });

  it('shows an owner their own agents and runs only; admins list agents but cannot read runs or files', async () => {
    const web = t.as('web');
    expect((await listAgents(web, ids.alice)).map((a) => a.name)).toEqual(['Brief']);
    expect(await listAgents(web, ids.bob)).toEqual([]);
    expect(await getAgent(web, ids.bob, agent)).toBeUndefined();
    expect((await listAgents(web, ids.root, true)).map((a) => a.name)).toEqual(['Brief']);
    expect(await listAgents(web, ids.root)).toEqual([]);

    expect((await listRuns(web, ids.alice, agent)).map((r) => r.outputMarkdown)).toEqual(['secret memory text']);
    expect(await listRuns(web, ids.root, agent)).toEqual([]);
    expect(await listRuns(web, ids.bob, agent)).toEqual([]);
    const [file] = await withAccount(web, ids.alice, (tx) => tx.select({ id: agentRunFiles.id }).from(agentRunFiles));
    expect((await getRunFile(web, ids.alice, file.id))?.content.toString()).toBe('abc');
    expect(await getRunFile(web, ids.root, file.id)).toBeUndefined();
  });

  it('does not let the web role write runs, the mcp role read anything, or a robot own an agent', async () => {
    expect(await pgCode(t.as('web').insert(agentRuns).values({ agentId: agent, trigger: 'manual' }))).toBe('42501');
    expect(await pgCode(withAccount(t.as('mcp'), ids.alice, (tx) => tx.select().from(hostedAgents)))).toBe('42501');
    await expect(createAgent(t.as('web'), ids.robot, input('Robot agent'))).rejects.toBeInstanceOf(AgentError);
  });

  it('keeps an owner from taking over or editing another person\'s agent', async () => {
    const web = t.as('web');
    await expect(updateAgent(web, ids.bob, agent, input('Mine now'))).rejects.toThrow(AgentError);
    await expect(setAgentEnabled(web, ids.bob, agent, false)).rejects.toThrow(AgentError);
    await withAccount(web, ids.bob, (tx) => tx.delete(hostedAgents).where(eq(hostedAgents.id, agent)));
    expect(await getAgent(web, ids.alice, agent)).toBeDefined();
    expect(await pgCode(withAccount(web, ids.bob, (tx) => tx.insert(hostedAgents).values({ ...input('x'), ownerId: ids.alice, instructions: 'x' })))).toBe('42501');
  });

  it('lets only an admin stop an agent, and only an admin release it', async () => {
    const web = t.as('web');
    await expect(adminStopAgent(web, ids.alice, agent, true)).rejects.toThrow('Only admins');
    await adminStopAgent(web, ids.root, agent, true);
    const stopped = await getAgent(web, ids.alice, agent);
    expect(stopped).toMatchObject({ enabled: false, stoppedBy: ids.root, pausedReason: 'Stopped by an admin' });
    await expect(setAgentEnabled(web, ids.alice, agent, true)).rejects.toThrow('stopped by an admin');
    await expect(requestAgentRun(web, ids.alice, agent)).rejects.toThrow(AgentError);
    await expect(updateAgent(web, ids.alice, agent, input())).rejects.toThrow(AgentError);

    await adminStopAgent(web, ids.root, agent, false);
    await setAgentEnabled(web, ids.alice, agent, true);
    expect(await getAgent(web, ids.alice, agent)).toMatchObject({ enabled: true, stoppedBy: null, pausedReason: null });
  });

  it('gives the worker only the status columns of an agent', async () => {
    const worker = t.as('worker');
    await worker.update(hostedAgents).set({ consecutiveFailures: 2, lastRunStatus: 'failed' }).where(eq(hostedAgents.id, agent));
    expect(await pgCode(worker.update(hostedAgents).set({ instructions: 'new' }).where(eq(hostedAgents.id, agent)))).toBe('42501');
    expect(await pgCode(worker.update(hostedAgents).set({ capabilities: ['files:read'] }).where(eq(hostedAgents.id, agent)))).toBe('42501');
  });

  it('validates input and schedules', async () => {
    const web = t.as('web');
    await expect(createAgent(web, ids.alice, input('Brief'))).rejects.toThrow('already have an agent');
    await expect(createAgent(web, ids.alice, { ...input('x'), maxToolCalls: 0 })).rejects.toThrow('Max tool calls');
    await expect(createAgent(web, ids.alice, { ...input('y'), schedule: '* * * * *' })).rejects.toThrow('at most every 15');
    expect(validateSchedule('0 5 * * *')).toBeNull();
    expect(validateSchedule('nonsense')).toMatch(/five-field/);
    expect(validateSchedule('61 * * * *')).toMatch(/not a valid/);
    await createAgent(web, ids.alice, { ...input('manual'), schedule: null });
    await deleteAgent(web, ids.alice, (await listAgents(web, ids.alice)).find((a) => a.name === 'manual')!.id);
  });

  it('deletes runs and files with the agent', async () => {
    await deleteAgent(t.as('web'), ids.alice, agent);
    const { rows } = await t.owner.query('select (select count(*) from agent_runs) as runs, (select count(*) from agent_run_files) as files');
    expect(rows[0]).toEqual({ runs: '0', files: '0' });
  });
});
