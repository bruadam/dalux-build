import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';
import {
  adminStopAgent,
  createAgent,
  encryptSecret,
  getAgent,
  listMemory,
  listRuns,
  requestAgentRun,
  setAgentEnabled,
  setMemoryEnabled,
  updateAgent,
  type AgentInput,
  type Db,
} from '@dalux-platform/db';
import { createTestDatabase, type TestDatabase } from '../../../platform/db/test/testDatabase';

jest.setTimeout(180_000);

jest.mock('@mistralai/mistralai', () => ({
  Mistral: jest.fn().mockImplementation(() => ({
    embeddings: {
      create: async ({ inputs }: { inputs: string[] }) => ({
        data: inputs.map((_, index) => ({ index, embedding: new Array<number>(1024).fill(0).map((__, i) => (i === 0 ? 1 : 0)) })),
        usage: { promptTokens: 5 },
      }),
    },
  })),
}));

const projectCalls: string[] = [];
const fakeClient = {
  projects: {
    getProject: async (projectId: string) => {
      projectCalls.push(projectId);
      return { projectId, name: `Project ${projectId}` };
    },
  },
  tasks: { getProjectTasks: async () => ({ items: [{ taskId: 't1', number: 1, subject: 'Late pour', deadline: '2020-01-01' }] }) },
  fileAreas: {},
  folders: {},
  files: {},
} as unknown as DaluxClient;
jest.mock('dalux-build-api', () => ({ createClient: () => fakeClient }));

import type { ChatClientFactory, ChatReply, ChatRequest } from '../../src/agents/chat';
import { agentAccess, exportedFile, failInterruptedAgentRuns, runAgent, type AgentDeps } from '../../src/agents/run';
import { handleAgentJob, tickAgents } from '../../src/agents/worker';
import { Platform } from '../../src/platform/platform';

const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const BASE_TOOLS = ['get_project', 'list_project_tasks', 'memory_status', 'memory_write'];

let database: TestDatabase;
let web: Db;
let worker: Db;
let cacheDir: string;
const ids: Record<string, string> = {};

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await database.owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(row),
  );
  return rows[0].id;
}

async function grant(name: string, capabilities: string[], projectId: string | null = 'p1') {
  await insert('grants', { account_id: ids[name], connection_id: ids.site, project_id: projectId, capabilities });
  await database.owner.query('SELECT refresh_effective_access()');
}
async function revokeAll(name: string) {
  await database.owner.query('DELETE FROM grants WHERE account_id = $1', [ids[name]]);
  await database.owner.query('SELECT refresh_effective_access()');
}
async function setMistralKey(key: string | null) {
  await database.owner.query('DELETE FROM settings');
  if (key) await database.owner.query('INSERT INTO settings (id, embedding_key_encrypted) VALUES (true, $1)', [encryptSecret(key, ENCRYPTION_KEY)]);
}

const CAPS = ['projects:read', 'tasks:read', 'memory:read', 'memory:write'];

async function newAgent(overrides: Partial<AgentInput> = {}, owner = 'alice'): Promise<string> {
  return createAgent(web, ids[owner], {
    connectionId: ids.site,
    projectId: 'p1',
    name: `agent-${Math.random().toString(36).slice(2, 8)}`,
    instructions: 'Report on the project.',
    schedule: '0 5 * * *',
    capabilities: CAPS,
    tools: BASE_TOOLS,
    ...overrides,
  });
}

type Step = { content?: string; calls?: [string, Record<string, unknown>][]; tokens?: number };

/** A model that follows a script: each step is one reply. Requests are recorded as they were sent. */
function model(steps: Step[] | ((n: number, request: ChatRequest) => Step | Promise<Step>)) {
  const requests: ChatRequest[] = [];
  const factory: ChatClientFactory = () => ({
    async complete(request): Promise<ChatReply> {
      requests.push({ ...request, messages: [...request.messages] });
      const n = requests.length - 1;
      const step = typeof steps === 'function' ? await steps(n, request) : (steps[n] ?? { content: 'done' });
      return {
        content: step.content ?? '',
        tokens: step.tokens ?? 100,
        toolCalls: (step.calls ?? []).map(([name, args], i) => ({ id: `c${n}-${i}`, name, arguments: args })),
      };
    },
  });
  return { factory, requests };
}

function deps(chat: ChatClientFactory): AgentDeps {
  return { db: worker, platform: new Platform(database.as('mcp'), ENCRYPTION_KEY), chat };
}

async function run(agent: string, chat: ChatClientFactory, trigger: 'schedule' | 'manual' = 'manual') {
  return runAgent(deps(chat), agent, trigger);
}

async function waitFor<T>(read: () => Promise<T | undefined | false>, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const auditRows = async (agent: string) =>
  (await database.owner.query("SELECT * FROM audit_log WHERE kind = 'tool' AND client LIKE $1 ORDER BY id", [`%${agent}%`])).rows;
const runRow = async (id: string) => (await database.owner.query('SELECT * FROM agent_runs WHERE id = $1', [id])).rows[0];
const agentRow = async (id: string) => (await database.owner.query('SELECT * FROM hosted_agents WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  database = await createTestDatabase();
  web = database.as('web');
  worker = database.as('worker');
  cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-agents-'));
  process.env.DALUX_MCP_CACHE_DIR = cacheDir;
  delete process.env.MISTRAL_API_KEY;
  ids.site = await insert('connections', {
    name: 'site',
    slug: 'site',
    base_url: 'https://node1.field.dalux.com/service/api',
    api_key_encrypted: encryptSecret('dalux-key', ENCRYPTION_KEY),
    api_key_last4: 'last',
  });
  for (const [name, role] of [['alice', 'user'], ['bob', 'user'], ['root', 'admin']]) {
    ids[name] = await insert('accounts', { type: 'personal', email: `${name}@example.com`, name, role });
  }
  await grant('alice', CAPS);
  await grant('alice', ['projects:read'], 'p2');
  await grant('root', [...CAPS, 'files:read']);
  await setMistralKey('mistral-key');
});

afterAll(async () => {
  await database?.drop();
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('what an agent may reach', () => {
  it('narrows the owner access to the agent project and capabilities, never beyond the owner', () => {
    const owner = [
      { connectionId: 'c', capability: 'tasks:read', projectId: null, fileAreaId: null, folderId: null },
      { connectionId: 'c', capability: 'projects:read', projectId: 'p2', fileAreaId: null, folderId: null },
      { connectionId: 'c', capability: 'files:read', projectId: 'p1', fileAreaId: 'fa', folderId: null },
      { connectionId: 'other', capability: 'tasks:read', projectId: null, fileAreaId: null, folderId: null },
    ] as const;
    const agent = { connectionId: 'c', projectId: 'p1', capabilities: ['tasks:read', 'projects:read', 'files:read', 'memory:write'] };
    expect(agentAccess([...owner], agent)).toEqual([
      { connectionId: 'c', capability: 'tasks:read', projectId: 'p1', fileAreaId: null, folderId: null },
      { connectionId: 'c', capability: 'files:read', projectId: 'p1', fileAreaId: 'fa', folderId: null },
    ]);
  });

  it('runs tools as the owner and audits them under the owner with the agent in the client field', async () => {
    const agent = await newAgent({ name: 'Weekly' });
    const { factory, requests } = model([
      { calls: [['list_project_tasks', { projectId: 'p1' }]], tokens: 120 },
      { content: '## Report\n1 overdue task', tokens: 80 },
    ]);
    const outcome = (await run(agent, factory))!;
    expect(outcome).toMatchObject({ status: 'ok', error: null, paused: false });

    expect(await runRow(outcome.runId)).toMatchObject({ status: 'ok', model_tokens: 200, tool_calls: 1, output_markdown: '## Report\n1 overdue task', trigger: 'manual' });
    expect(await agentRow(agent)).toMatchObject({ last_run_status: 'ok', last_run_tokens: 200, last_run_tool_calls: 1, consecutive_failures: 0 });
    expect(requests[0].tools.map((t) => t.name).sort()).toEqual([...BASE_TOOLS].sort());
    const toolMessage = requests[1].messages.at(-1)!;
    expect(toolMessage).toMatchObject({ role: 'tool', name: 'list_project_tasks' });
    expect((toolMessage as { content: string }).content).toContain('trust="untrusted-data"');
    expect((toolMessage as { content: string }).content).toContain('Late pour');

    const rows = await waitFor(async () => {
      const found = await auditRows(agent);
      return found.length ? found : false;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ account_id: ids.alice, action: 'list_project_tasks', status: 'ok', capability: 'tasks:read', project_id: 'p1' });
    expect(rows[0].client).toBe(`hosted agent: Weekly (${agent})`);
    expect(rows[0]).toMatchObject({ auth_method: 'agent', agent_id: agent, agent_name: 'Weekly', client_ip: null });
    expect(rows[0].request_id).toEqual(expect.any(String));
  });

  it('refuses a project outside the agent, a capability outside its subset, and a tool outside its list', async () => {
    const agent = await newAgent({ capabilities: ['projects:read', 'memory:read'], tools: ['get_project', 'list_project_tasks'] });
    const before = projectCalls.length;
    const { factory, requests } = model([
      {
        calls: [
          ['get_project', { projectId: 'p2' }],
          ['list_project_tasks', { projectId: 'p1' }],
          ['list_files', { projectId: 'p1', fileAreaId: 'x' }],
          ['get_project', { projectId: 'p1' }],
        ],
      },
      { content: 'done' },
    ]);
    const outcome = (await run(agent, factory))!;
    expect(outcome.status).toBe('ok');
    const results = requests[1].messages.filter((m) => m.role === 'tool').map((m) => (m as { content: string }).content);
    expect(results[0]).toContain('Missing capability projects:read');
    expect(results[1]).toContain('Missing capability tasks:read');
    expect(results[2]).toContain('not available to this agent');
    expect(results[3]).toContain('Project p1');
    expect(projectCalls.slice(before)).toEqual(['p1']);
    expect(await runRow(outcome.runId)).toMatchObject({ tool_calls: 4 });

    const rows = await waitFor(async () => ((await auditRows(agent)).length === 3 ? auditRows(agent) : false));
    expect(rows.map((r) => `${r.action}:${r.status}`).sort()).toEqual(['get_project:denied', 'get_project:ok', 'list_project_tasks:denied']);
  });

  it('gives an admin owner no admin-only tools', async () => {
    const agent = await newAgent({ tools: ['build_task_index', 'get_project'] }, 'root');
    const { factory, requests } = model([{ content: 'done' }]);
    await run(agent, factory);
    expect(requests[0].tools.map((t) => t.name)).toEqual(['get_project']);
  });
});

describe('when the agent does not run', () => {
  it('skips a run, with the reason, when the owner lost access, and runs again after it is back', async () => {
    const agent = await newAgent({}, 'bob');
    const { factory, requests } = model([{ content: 'done' }]);
    const skipped = (await run(agent, factory))!;
    expect(skipped.status).toBe('skipped');
    expect(skipped.error).toMatch(/none of the capabilities/);
    expect(requests).toHaveLength(0);
    expect(await agentRow(agent)).toMatchObject({ last_run_status: 'skipped', consecutive_failures: 0, enabled: true });

    await grant('bob', ['projects:read'], 'p1');
    expect((await run(agent, factory))!.status).toBe('ok');
    await revokeAll('bob');
  });

  it('skips when the owner is disabled, or no Mistral key is set', async () => {
    const agent = await newAgent();
    const { factory, requests } = model([{ content: 'done' }]);
    await setMistralKey(null);
    expect((await run(agent, factory))!.error).toMatch(/No Mistral key/);
    await setMistralKey('mistral-key');
    await database.owner.query("UPDATE accounts SET status = 'disabled' WHERE id = $1", [ids.alice]);
    await database.owner.query('SELECT refresh_effective_access()');
    expect((await run(agent, factory))!.error).toMatch(/owner account is disabled/);
    await database.owner.query("UPDATE accounts SET status = 'active' WHERE id = $1", [ids.alice]);
    await database.owner.query('SELECT refresh_effective_access()');
    expect(requests).toHaveLength(0);
  });

  it('does not run scheduled jobs of a paused agent, but runs it on request', async () => {
    const agent = await newAgent();
    await setAgentEnabled(web, ids.alice, agent, false);
    const { factory } = model([{ content: 'done' }]);
    expect(await run(agent, factory, 'schedule')).toBeNull();
    expect((await run(agent, factory, 'manual'))!.status).toBe('ok');
    await adminStopAgent(web, ids.root, agent, true);
    expect(await run(agent, factory, 'manual')).toBeNull();
  });

  it('stops a run in progress when an admin stops the agent', async () => {
    const agent = await newAgent();
    const { factory } = model(async (n) => {
      if (n === 0) {
        await adminStopAgent(web, ids.root, agent, true);
        return { calls: [['get_project', { projectId: 'p1' }]] };
      }
      return { content: 'never reached' };
    });
    const outcome = (await run(agent, factory))!;
    expect(outcome).toMatchObject({ status: 'stopped', error: 'Stopped by an admin.' });
  });
});

describe('hard limits', () => {
  it('ends the run at the tool call limit', async () => {
    const agent = await newAgent({ maxToolCalls: 2 });
    const { factory } = model(() => ({ calls: [['get_project', { projectId: 'p1' }]], content: 'working' }));
    const outcome = (await run(agent, factory))!;
    expect(outcome).toMatchObject({ status: 'limit', error: 'Tool call limit reached (2).' });
    expect(await runRow(outcome.runId)).toMatchObject({ tool_calls: 2, output_markdown: 'working' });
  });

  it('ends the run at the model token limit', async () => {
    const agent = await newAgent({ maxTokens: 1000 });
    const { factory, requests } = model(() => ({ calls: [['get_project', { projectId: 'p1' }]], tokens: 600 }));
    const outcome = (await run(agent, factory))!;
    expect(outcome).toMatchObject({ status: 'limit', error: 'Model token limit reached (1000).' });
    expect(requests).toHaveLength(2);
    expect(requests[1].maxTokens).toBe(400);
  });

  it('ends the run at the time limit', async () => {
    const agent = await newAgent({ maxDurationSeconds: 30 });
    const base = Date.now();
    let offset = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => base + offset);
    try {
      const { factory } = model(() => {
        offset += 31_000;
        return { calls: [['get_project', { projectId: 'p1' }]] };
      });
      const outcome = (await run(agent, factory))!;
      expect(outcome.status).toBe('limit');
      expect(outcome.error).toMatch(/Time limit reached/);
    } finally {
      now.mockRestore();
    }
  });
});

describe('failures', () => {
  it('counts failed runs, pauses after three in a row, and resets on a good run', async () => {
    const agent = await newAgent();
    const broken: ChatClientFactory = () => ({
      complete: async () => {
        throw new Error('Mistral is down');
      },
    });
    const good = model([{ content: 'fine' }]).factory;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect((await run(agent, broken))).toMatchObject({ status: 'failed', error: 'Mistral is down', paused: false });
    expect((await run(agent, good))!.status).toBe('ok');
    expect((await agentRow(agent)).consecutive_failures).toBe(0);

    await run(agent, broken);
    await run(agent, broken);
    expect((await agentRow(agent)).consecutive_failures).toBe(2);
    const third = (await run(agent, broken))!;
    expect(third.paused).toBe(true);
    expect(await agentRow(agent)).toMatchObject({ enabled: false, consecutive_failures: 3 });
    expect((await agentRow(agent)).paused_reason).toMatch(/Paused after 3 failed runs in a row. Last error: Mistral is down/);
    expect(await run(agent, good, 'schedule')).toBeNull();

    await setAgentEnabled(web, ids.alice, agent, true);
    expect(await agentRow(agent)).toMatchObject({ enabled: true, consecutive_failures: 0, paused_reason: null });
    jest.restoreAllMocks();
  });

  it('lets pg-boss retry a failed scheduled run, but not a manual one', async () => {
    const agent = await newAgent();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: ChatClientFactory = () => ({ complete: async () => Promise.reject(new Error('boom')) });
    await expect(handleAgentJob(deps(broken), { agentId: agent, trigger: 'schedule' }, 0)).rejects.toThrow('boom');
    await expect(handleAgentJob(deps(broken), { agentId: agent, trigger: 'manual' }, 0)).resolves.toBeUndefined();
    await handleAgentJob(deps(model([{ content: 'ok' }]).factory), { agentId: agent, trigger: 'schedule' }, 1);
    const runs = await listRuns(web, ids.alice, agent);
    expect(runs.map((r) => [r.trigger, r.status]).sort()).toEqual([['manual', 'failed'], ['retry', 'ok'], ['schedule', 'failed']]);
    jest.restoreAllMocks();
  });

  it('marks runs that were interrupted by a worker stop as failed', async () => {
    const agent = await newAgent();
    const [{ id }] = (await database.owner.query("INSERT INTO agent_runs (agent_id, trigger) VALUES ($1, 'schedule') RETURNING id", [agent])).rows;
    await failInterruptedAgentRuns(worker);
    expect(await runRow(id)).toMatchObject({ status: 'failed', error: 'The worker stopped during this run.' });
  });
});

describe('memory and outputs', () => {
  const scope = () => ({ accountId: ids.alice, connectionId: ids.site, projectId: 'p1' });
  const brief = [
    { calls: [['memory_write', { projectId: 'p1', kind: 'summary', text: 'Project brief: crane on site.' }]] as [string, Record<string, unknown>][] },
    { content: 'Updated the brief.' },
  ];

  it('writes to the owner memory only when memory is on, as hosted_agent:<id>, and admins cannot read it', async () => {
    const agent = await newAgent({ name: 'Brief' });
    const mcp = database.as('mcp');

    const off = model(brief);
    await run(agent, off.factory);
    expect((await listMemory(mcp, scope(), {})).total).toBe(0);
    expect((off.requests[1].messages.at(-1) as { content: string }).content).toContain('Memory is off');

    await setMemoryEnabled(web, scope(), true);
    await run(agent, model(brief).factory);
    const entries = (await listMemory(mcp, scope(), {})).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'summary', text: 'Project brief: crane on site.', source: `hosted_agent:${agent}`, hasEmbedding: true });
    expect((await listMemory(mcp, { ...scope(), accountId: ids.root }, {})).total).toBe(0);

    const rows = await waitFor(async () => ((await auditRows(agent)).filter((r) => r.action === 'memory_write').length === 2 ? auditRows(agent) : false));
    expect(rows.every((r) => r.account_id === ids.alice)).toBe(true);
  });

  it('refuses memory writes when the agent was not given memory:write', async () => {
    const agent = await newAgent({ capabilities: ['projects:read', 'memory:read'] });
    await setMemoryEnabled(web, scope(), true);
    const { factory, requests } = model(brief);
    await run(agent, factory);
    expect((requests[1].messages.at(-1) as { content: string }).content).toContain('Missing capability memory:write');
    expect((await listMemory(database.as('mcp'), scope(), {})).entries.filter((e) => e.source === `hosted_agent:${agent}`)).toHaveLength(0);
  });

  it('gives the next run the previous report to compare with', async () => {
    const agent = await newAgent();
    const first = model([{ content: '## Findings\nA is 3, B is 4' }]);
    await run(agent, first.factory);
    const second = model([{ content: 'No new findings' }]);
    await run(agent, second.factory);
    expect((second.requests[0].messages[1] as { content: string }).content).toContain('Report of the previous run');
    expect((second.requests[0].messages[1] as { content: string }).content).toContain('A is 3, B is 4');
    expect((first.requests[0].messages[1] as { content: string }).content).not.toContain('previous run');
  });
});

describe('exported files', () => {
  it('keeps an exported report that lies in the cache, and nothing else', () => {
    const dir = path.join(cacheDir, 'callers', 'x');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'report.md'), '# Findings');
    writeFileSync(path.join(tmpdir(), 'outside.md'), 'secret');
    const result = (filePath: string) => ({ isError: false, text: JSON.stringify({ filePath, fileName: path.basename(filePath) }) });

    const file = exportedFile('export_inconsistency_report', result(path.join(dir, 'report.md')));
    expect(file).toMatchObject({ name: 'report.md', contentType: 'text/markdown' });
    expect(file?.content.toString()).toBe('# Findings');
    expect(exportedFile('export_inconsistency_report', result(path.join(tmpdir(), 'outside.md')))).toBeUndefined();
    expect(exportedFile('export_inconsistency_report', result(path.join(cacheDir, '..', 'outside.md')))).toBeUndefined();
    expect(exportedFile('get_project', result(path.join(dir, 'report.md')))).toBeUndefined();
    expect(exportedFile('export_inconsistency_report', { isError: true, text: 'nope' })).toBeUndefined();
  });
});

describe('schedules', () => {
  /** A stand-in for pg-boss that remembers its schedules and the jobs sent. */
  function fakeBoss() {
    const schedules = new Map<string, string>();
    const sent: [object, object | undefined][] = [];
    return {
      schedules,
      sent,
      boss: {
        getSchedules: async () => [...schedules].map(([key, cron]) => ({ key, cron })),
        schedule: async (_name: string, cron: string, _data: object, options: { key: string }) => void schedules.set(options.key, cron),
        unschedule: async (_name: string, key: string) => void schedules.delete(key),
        send: async (_name: string, data: object, options?: object) => (sent.push([data, options]), null),
      } as never,
    };
  }

  it('keeps one schedule per enabled agent in step with the agent, and queues "Run now" requests once', async () => {
    await database.owner.query('DELETE FROM hosted_agents');
    const { boss, schedules, sent } = fakeBoss();
    const agent = await newAgent({ schedule: '0 5 * * *' });
    const manual = await newAgent({ schedule: null });

    await tickAgents(boss, worker);
    expect(Object.fromEntries(schedules)).toEqual({ [agent]: '0 5 * * *' });

    await updateAgent(web, ids.alice, agent, {
      connectionId: ids.site, projectId: 'p1', name: 'renamed', instructions: 'x', schedule: '30 6 * * 1', capabilities: CAPS, tools: BASE_TOOLS,
    });
    await tickAgents(boss, worker);
    expect(Object.fromEntries(schedules)).toEqual({ [agent]: '30 6 * * 1' });

    await setAgentEnabled(web, ids.alice, agent, false);
    await tickAgents(boss, worker);
    expect(schedules.size).toBe(0);

    await requestAgentRun(web, ids.alice, manual);
    await tickAgents(boss, worker);
    await tickAgents(boss, worker);
    expect(sent).toEqual([[{ agentId: manual, trigger: 'manual' }, { singletonKey: manual }]]);
    expect((await agentRow(manual)).run_requested_at).toBeNull();

    await requestAgentRun(web, ids.alice, manual);
    await adminStopAgent(web, ids.root, manual, true);
    await tickAgents(boss, worker);
    expect(sent).toHaveLength(1);
  });

  it('runs scheduled and "Run now" agents in a real worker process through pg-boss', async () => {
    // A real `dalux-mcp worker` (pg-boss is ESM-only, which jest cannot load). With no Mistral key in the
    // settings the runs end as "skipped": they prove the schedule, the queue and the job handler without a model.
    await database.owner.query('DELETE FROM hosted_agents');
    await setMistralKey(null);
    const scheduled = await insert('hosted_agents', {
      owner_id: ids.alice, connection_id: ids.site, project_id: 'p1', name: 'every minute', instructions: 'Report.',
      schedule: '* * * * *', capabilities: CAPS, tools: ['get_project'],
    });
    const manual = await newAgent({ schedule: null });
    await requestAgentRun(web, ids.alice, manual);

    const child = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/cli.ts', 'worker'], {
      cwd: path.join(__dirname, '../..'),
      env: {
        ...process.env,
        DATABASE_URL: database.url('mcp'),
        DATABASE_URL_WORKER: database.url('worker'),
        PLATFORM_ENCRYPTION_KEY: ENCRYPTION_KEY.toString('base64'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    try {
      const firstRun = (agent: string) => async () => (await database.owner.query("SELECT trigger, status, error FROM agent_runs WHERE agent_id = $1 AND status <> 'running'", [agent])).rows[0];
      const runNow = await waitFor(firstRun(manual), 90_000);
      expect(runNow).toMatchObject({ trigger: 'manual', status: 'skipped' });
      expect(runNow.error).toMatch(/No Mistral key/);
      const cron = await waitFor(firstRun(scheduled), 150_000);
      expect(cron).toMatchObject({ trigger: 'schedule', status: 'skipped' });
      expect(stderr).not.toMatch(/hosted agents are off/);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  });
});
