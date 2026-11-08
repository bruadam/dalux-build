import { addMemory, type Db } from '@dalux-platform/db';
import { createTestDatabase, type TestDatabase } from '../../db/test/testDatabase';
import { PRESETS } from '../lib/capabilities';
import type { Actor } from '../lib/server/actor';
import { UserError } from '../lib/server/errors';
import { resolveGrant } from '../lib/server/grants';
import {
  deleteAllMemory,
  deleteMemoryEntry,
  editMemoryEntry,
  exportMemoryFile,
  listMemoryProjects,
  memoryMarkdown,
  switchMemory,
  viewMemory,
  writerLabel,
} from '../lib/server/memory';

let t: TestDatabase;
let db: Db;
let mcp: Db;
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

async function person(name: string, role: 'admin' | 'user', capabilities: string[]) {
  const accountId = await insert('accounts', { type: 'personal', email: `${name}@example.com`, name, role });
  await insert('grants', { account_id: accountId, connection_id: connectionId, project_id: 'P1', capabilities });
  actors[name] = { accountId, role, name, email: `${name}@example.com` };
}

const refresh = () => t.owner.query('SELECT refresh_effective_access()');
const where = (name: string, projectId = 'P1') => ({ connectionId, projectId, actor: actors[name] });
const ask = (name: string) => viewMemory(db, actors[name], { connectionId, projectId: 'P1' });

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.as('web');
  mcp = t.as('mcp');
  connectionId = await insert('connections', { name: 'Main', slug: 'main', base_url: 'https://x.dalux.com', api_key_encrypted: 'v1.x.y', api_key_last4: '1234' });
  await person('uma', 'user', ['projects:read', 'memory:read', 'memory:write']);
  await person('ada', 'admin', ['projects:read', 'files:read', 'tasks:read', 'memory:read', 'memory:write']);
  await person('reader', 'user', ['projects:read', 'memory:read']);
  await refresh();
  const mine = { accountId: actors.uma.accountId, connectionId, projectId: 'P1' };
  await addMemory(mcp, mine, { kind: 'summary', text: 'Brief.', source: 'agent:Claude' });
  await addMemory(mcp, mine, { kind: 'fact', text: 'Crane pad is 6 x 6 m.', source: 'user', tags: ['site'] });
  await addMemory(mcp, mine, {
    kind: 'decision',
    text: 'Use REI 90 doors.',
    source: 'hosted_agent:nightly',
    citations: [{ fileName: 'fire.pdf', location: 'p. 3' }],
  });
});

afterAll(() => t.drop());

describe('My memory (web role)', () => {
  it('lists the owner\'s entries, filtered, and shows who wrote them', async () => {
    const { total, entries } = await ask('uma');
    expect(total).toBe(3);
    expect(entries.map((e) => writerLabel(e.source)).sort()).toEqual(['Agent Claude', 'Hosted agent nightly', 'You']);
    const found = await viewMemory(db, actors.uma, { connectionId, projectId: 'P1', contains: 'CRANE' });
    expect(found.entries.map((e) => e.text)).toEqual(['Crane pad is 6 x 6 m.']);
    expect((await viewMemory(db, actors.uma, { connectionId, projectId: 'P1', kind: 'decision' })).total).toBe(1);
  });

  it('shows an admin nothing of someone else\'s memory', async () => {
    expect((await ask('ada')).total).toBe(0);
    expect(await listMemoryProjects(db, actors.ada.accountId)).toEqual([]);
  });

  it('turns memory on and off per project, and lists projects with entries or a switch', async () => {
    await switchMemory(db, actors.uma, { connectionId, projectId: 'P1', enabled: true });
    expect(await listMemoryProjects(db, actors.uma.accountId)).toEqual([{ connectionId, projectId: 'P1', enabled: true, entries: 3 }]);
    await switchMemory(db, actors.uma, { connectionId, projectId: 'P1', enabled: false });
    expect((await listMemoryProjects(db, actors.uma.accountId))[0]).toMatchObject({ enabled: false, entries: 3 });
  });

  it('explains a refused switch or edit when the grant is missing', async () => {
    await expect(switchMemory(db, actors.reader, { connectionId, projectId: 'P1', enabled: true })).rejects.toThrow(UserError);
    await expect(switchMemory(db, actors.uma, { connectionId, projectId: 'OTHER', enabled: true })).rejects.toThrow('memory:write');
    await expect(switchMemory(db, actors.uma, { connectionId: 'nope', projectId: 'P1', enabled: true })).rejects.toThrow('Choose a connection');
  });

  it('edits an entry as a new version written by the user, keeping the old one', async () => {
    const [fact] = (await viewMemory(db, actors.uma, { connectionId, projectId: 'P1', kind: 'fact' })).entries;
    await editMemoryEntry(db, actors.uma, { connectionId, projectId: 'P1', id: fact.id, text: 'Crane pad is 8 x 8 m.' });
    const now = (await viewMemory(db, actors.uma, { connectionId, projectId: 'P1', kind: 'fact' })).entries;
    expect(now).toMatchObject([{ text: 'Crane pad is 8 x 8 m.', source: 'user', tags: ['site'] }]);
    await expect(editMemoryEntry(db, actors.uma, { connectionId, projectId: 'P1', id: fact.id, text: 'stale' })).rejects.toThrow('Reload');
    await expect(editMemoryEntry(db, actors.uma, { connectionId, projectId: 'P1', id: now[0].id, text: '  ' })).rejects.toThrow('empty');
  });

  it('exports JSON and Markdown with old versions and writers', async () => {
    const json = await exportMemoryFile(db, actors.uma, { ...where('uma'), connectionName: 'Main', format: 'json' });
    expect(json.filename).toBe('memory-P1.json');
    const parsed = JSON.parse(json.body);
    expect(parsed.entries).toHaveLength(4);
    expect(parsed.entries.some((e: { supersededBy: string | null }) => e.supersededBy)).toBe(true);
    expect(json.body).not.toContain('embedding');

    const md = await exportMemoryFile(db, actors.uma, { ...where('uma'), connectionName: 'Main', format: 'md' });
    expect(md.body).toContain('## Decisions');
    expect(md.body).toContain('Use REI 90 doors. _(Hosted agent nightly');
    expect(md.body).toContain('fire.pdf, p. 3');
    expect(md.body).toContain('## Older versions');
    expect(memoryMarkdown([], { connection: 'Main', projectId: 'P1' })).toContain('# Memory: Main / project P1');
  });

  it('exports nothing of another person\'s memory', async () => {
    const file = await exportMemoryFile(db, actors.ada, { ...where('ada'), connectionName: 'Main', format: 'json' });
    expect(JSON.parse(file.body).entries).toEqual([]);
  });

  it('deletes one entry, then everything of the project', async () => {
    const { entries } = await ask('uma');
    const decision = entries.find((e) => e.kind === 'decision')!;
    await deleteMemoryEntry(db, actors.uma, { connectionId, projectId: 'P1', id: decision.id });
    expect((await ask('uma')).total).toBe(2);
    await expect(deleteMemoryEntry(db, actors.uma, { connectionId, projectId: 'P1', id: decision.id })).rejects.toThrow('already deleted');

    expect(await deleteAllMemory(db, actors.uma, { connectionId, projectId: 'P1' })).toBe(2);
    expect((await exportMemoryFile(db, actors.uma, { ...where('uma'), connectionName: 'Main', format: 'json' })).body).toContain('"entries": []');
  });

  it('hides entries when the grant is withdrawn', async () => {
    await addMemory(mcp, { accountId: actors.uma.accountId, connectionId, projectId: 'P1' }, { kind: 'fact', text: 'Visible while granted.', source: 'user' });
    expect((await ask('uma')).total).toBe(1);
    await t.owner.query('DELETE FROM grants WHERE account_id = $1', [actors.uma.accountId]);
    await refresh();
    expect((await ask('uma')).total).toBe(0);
  });
});

describe('memory capabilities in grants', () => {
  it('keeps memory out of the Reader preset', () => {
    expect(PRESETS.reader).toContain('projects:read');
    expect(PRESETS.reader.filter((capability) => capability.startsWith('memory:'))).toEqual([]);
  });

  it('takes memory capabilities explicitly, on a connection or project but not on files', () => {
    const base = { accountId: actors.uma.accountId, connectionId, projectId: 'P1' };
    expect(resolveGrant({ ...base, preset: 'reader', capabilities: ['memory:read', 'memory:write'] }).capabilities).toContain('memory:write');
    expect(() => resolveGrant({ ...base, fileAreaId: 'FA', capabilities: ['memory:read'] })).toThrow('files:*');
  });
});
