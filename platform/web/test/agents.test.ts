import type { Db } from '@dalux-platform/db';
import { validateSchedule } from '@dalux-platform/db';
import { TOOL_ACCESS } from '../../../mcp-server/src/access/registry';
import { createTestDatabase, type TestDatabase } from '../../db/test/testDatabase';
import type { Actor } from '../lib/server/actor';
import {
  AGENT_TEMPLATES,
  AGENT_TOOLSETS,
  agentInputFrom,
  createOwnAgent,
  getAgent,
  listAgents,
  runAgentNow,
  stopAnyAgent,
  switchAgent,
  updateOwnAgent,
} from '../lib/server/agents';
import { UserError } from '../lib/server/errors';

let t: TestDatabase;
let db: Db;
let connectionId: string;
const actors: Record<string, Actor> = {};

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await t.owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(row),
  );
  return rows[0].id;
}

const base = () => ({
  connectionId,
  projectId: 'P1',
  name: 'Brief',
  instructions: 'Report.',
  schedule: '0 5 * * *',
  capabilities: ['projects:read', 'tasks:read'],
  tools: ['get_project', 'list_project_tasks'],
});

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.as('web');
  connectionId = await insert('connections', { name: 'Main', slug: 'main', base_url: 'https://x.dalux.com', api_key_encrypted: 'v1.x.y', api_key_last4: '1234' });
  for (const [name, role] of [['uma', 'user'], ['ada', 'admin']] as const) {
    const accountId = await insert('accounts', { type: 'personal', email: `${name}@example.com`, name, role });
    actors[name] = { accountId, role, name, email: `${name}@example.com` };
  }
  await insert('grants', { account_id: actors.uma.accountId, connection_id: connectionId, project_id: 'P1', capabilities: ['projects:read', 'tasks:read'] });
  await t.owner.query('SELECT refresh_effective_access()');
});

afterAll(async () => {
  await t?.drop();
});

describe('agent templates', () => {
  it('only name tools that agents can have, and capabilities that cover those tools', () => {
    const offered = new Set<string>(AGENT_TOOLSETS.flatMap((set) => set.tools));
    for (const template of AGENT_TEMPLATES) {
      expect(validateSchedule(template.schedule)).toBeNull();
      for (const tool of template.tools) {
        expect(offered.has(tool)).toBe(true);
        const needed = TOOL_ACCESS[tool].capability;
        if (needed !== 'none') expect({ template: template.id, tool, covered: template.capabilities.includes(needed) }).toMatchObject({ covered: true });
      }
    }
  });

  it('keep admin-only index tools and the memory switch away from agents', () => {
    const offered = AGENT_TOOLSETS.flatMap((set) => set.tools) as string[];
    expect(offered).not.toContain('build_task_index');
    expect(offered).not.toContain('memory_set_enabled');
    expect(offered).toContain('memory_write');
  });
});

describe('own agents', () => {
  it('creates an agent from form fields and limits it to what the owner holds', async () => {
    const form = new FormData();
    form.set('connectionId', connectionId);
    form.set('projectId', 'P1');
    form.set('name', 'Digest');
    form.set('instructions', 'List overdue tasks.');
    form.set('schedule', '0 6 * * 1');
    form.append('capabilities', 'tasks:read');
    form.append('tools', 'list_project_tasks');
    form.set('maxToolCalls', '10');
    const id = await createOwnAgent(db, actors.uma, agentInputFrom(form));
    expect(await getAgent(db, actors.uma.accountId, id)).toMatchObject({
      name: 'Digest',
      schedule: '0 6 * * 1',
      capabilities: ['tasks:read'],
      maxToolCalls: 10,
      maxTokens: 200_000,
      enabled: true,
    });

    await expect(createOwnAgent(db, actors.uma, { ...base(), name: 'Too much', capabilities: ['files:read'] })).rejects.toThrow('You do not hold files:read');
    await expect(createOwnAgent(db, actors.uma, { ...base(), name: 'Other project', projectId: 'P2' })).rejects.toThrow('You do not hold');
    await expect(createOwnAgent(db, actors.uma, { ...base(), name: 'Admin tool', tools: ['build_task_index'] })).rejects.toThrow('not available to agents');
    await expect(createOwnAgent(db, actors.uma, { ...base(), name: 'Bad cron', schedule: 'daily' })).rejects.toBeInstanceOf(UserError);
    await expect(createOwnAgent(db, actors.uma, base())).resolves.toBeDefined();
    await expect(createOwnAgent(db, actors.uma, base())).rejects.toThrow('already have an agent');
  });

  it('shows one person only their own agents, and admins all of them', async () => {
    expect(await listAgents(db, actors.ada.accountId)).toEqual([]);
    expect((await listAgents(db, actors.ada.accountId, true)).map((agent) => agent.name).sort()).toEqual(['Brief', 'Digest']);
    expect((await listAgents(db, actors.uma.accountId, true)).map((agent) => agent.name).sort()).toEqual(['Brief', 'Digest']);
  });

  it('pauses, resumes, edits and queues a run; a stopped agent only an admin can release', async () => {
    const [agent] = await listAgents(db, actors.uma.accountId);
    await switchAgent(db, actors.uma, agent.id, false);
    expect(await getAgent(db, actors.uma.accountId, agent.id)).toMatchObject({ enabled: false, pausedReason: 'Paused by the owner' });
    await switchAgent(db, actors.uma, agent.id, true);
    await updateOwnAgent(db, actors.uma, agent.id, { ...base(), name: agent.name, instructions: 'New text.' });
    await runAgentNow(db, actors.uma, agent.id);
    expect((await getAgent(db, actors.uma.accountId, agent.id))?.runRequestedAt).toBeInstanceOf(Date);

    await expect(stopAnyAgent(db, actors.uma, agent.id, true)).rejects.toThrow('Only admins');
    await stopAnyAgent(db, actors.ada, agent.id, true);
    await expect(switchAgent(db, actors.uma, agent.id, true)).rejects.toThrow('stopped by an admin');
    const { rows } = await t.owner.query("SELECT action FROM audit_log WHERE kind = 'admin' AND target_id = $1", [agent.id]);
    expect(rows).toEqual([{ action: 'agent.stop' }]);
    await stopAnyAgent(db, actors.ada, agent.id, false);
    await switchAgent(db, actors.uma, agent.id, true);
  });
});
