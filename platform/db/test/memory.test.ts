import { eq, sql } from 'drizzle-orm';
import {
  addMemory,
  forgetAllMemory,
  forgetMemory,
  listMemory,
  listMemoryProjects,
  memoryEnabled,
  reviseMemory,
  setMemoryEnabled,
  MEMORY_MAX_ENTRIES,
  type MemoryScope,
} from '../src/memory';
import { withAccount } from '../src/db';
import { memoryEntries } from '../src/schema';
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

const grant = async (account: string, capabilities: string[], projectId: string | null = 'P1') => {
  await insert('grants', { account_id: ids[account], connection_id: ids.conn, project_id: projectId, capabilities });
  await t.owner.query('SELECT refresh_effective_access()');
};
const revoke = async (account: string) => {
  await t.owner.query('DELETE FROM grants WHERE account_id = $1', [ids[account]]);
  await t.owner.query('SELECT refresh_effective_access()');
};

const scope = (account: string, projectId = 'P1'): MemoryScope => ({ accountId: ids[account], connectionId: ids.conn, projectId });
const note = (text: string, extra: object = {}) => ({ kind: 'fact' as const, text, source: 'user', ...extra });

/** Entry texts `account` sees when it queries the table directly with `role`, whatever it asks for. */
async function visibleTexts(role: 'mcp' | 'web' | 'worker', account: string): Promise<string[]> {
  const rows = await withAccount(t.as(role), ids[account], (tx) => tx.select({ text: memoryEntries.text }).from(memoryEntries));
  return rows.map((row) => row.text).sort();
}

async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const { cause } = error as { cause?: Error };
    return (cause ?? (error as Error)).message;
  }
  throw new Error('expected the query to fail');
}

beforeAll(async () => {
  t = await createTestDatabase();
  ids.conn = await insert('connections', { name: 'Acme', slug: 'acme', base_url: 'https://acme.dalux.com', api_key_encrypted: 'v1.x.y', api_key_last4: '1234' });
  const personal = (name: string, role = 'user') =>
    insert('accounts', { type: 'personal', email: `${name}@example.com`, name, status: 'active', role });
  ids.alice = await personal('alice');
  ids.bob = await personal('bob');
  ids.root = await personal('root', 'admin');
  ids.robot = await insert('accounts', { type: 'robot', name: 'triage', owner_account_id: ids.alice });
  await grant('alice', ['projects:read', 'memory:read', 'memory:write']);
  await grant('bob', ['projects:read', 'memory:read', 'memory:write'], null);
  await grant('root', ['projects:read', 'files:read', 'tasks:read', 'models:read', 'memory:read']);
  await grant('robot', ['projects:read', 'memory:read', 'memory:write']);
});

afterAll(() => t.drop());

describe('memory row-level security', () => {
  beforeAll(async () => {
    await addMemory(t.as('mcp'), scope('alice'), note('alice fact'));
    await addMemory(t.as('mcp'), scope('bob'), note('bob fact'));
  });

  it('shows an owner only their own entries, to the mcp and web roles', async () => {
    expect(await visibleTexts('mcp', 'alice')).toEqual(['alice fact']);
    expect(await visibleTexts('web', 'alice')).toEqual(['alice fact']);
    expect(await visibleTexts('mcp', 'bob')).toEqual(['bob fact']);
  });

  it('gives admins no access to other people\'s entries, even with every read capability', async () => {
    expect(await visibleTexts('mcp', 'root')).toEqual([]);
    expect(await visibleTexts('web', 'root')).toEqual([]);
  });

  it('shows nothing without an account in the session, and nothing to the worker role', async () => {
    expect(await t.as('mcp').select({ text: memoryEntries.text }).from(memoryEntries)).toEqual([]);
    expect(await pgError(t.as('worker').select({ text: memoryEntries.text }).from(memoryEntries))).toContain('permission denied');
  });

  it('refuses to write another account\'s entry', async () => {
    const forged = withAccount(t.as('mcp'), ids.alice, (tx) =>
      tx.insert(memoryEntries).values({ ...scope('bob'), kind: 'fact', text: 'planted', source: 'user' }),
    );
    expect(await pgError(forged)).toContain('row-level security');
  });

  it('hides entries from robots and lets no one change text in place', async () => {
    expect(await pgError(addMemory(t.as('mcp'), scope('robot'), note('robot fact')))).toContain('row-level security');
    const edit = withAccount(t.as('mcp'), ids.alice, (tx) => tx.update(memoryEntries).set({ text: 'changed' }));
    expect(await pgError(edit)).toContain('permission denied');
  });

  it('hides entries while the owner has no read access to the project, and shows them again with it', async () => {
    await revoke('alice');
    expect(await visibleTexts('mcp', 'alice')).toEqual([]);
    expect(await pgError(addMemory(t.as('mcp'), scope('alice'), note('late')))).toContain('row-level security');
    await grant('alice', ['memory:read', 'memory:write']);
    expect(await visibleTexts('mcp', 'alice')).toEqual([]);
    await grant('alice', ['tasks:read']);
    expect(await visibleTexts('mcp', 'alice')).toEqual(['alice fact']);
  });

  it('needs memory:read to read and memory:write to write, on the project', async () => {
    await revoke('alice');
    await grant('alice', ['projects:read', 'memory:read']);
    expect(await visibleTexts('mcp', 'alice')).toEqual(['alice fact']);
    expect(await pgError(addMemory(t.as('mcp'), scope('alice'), note('x')))).toContain('row-level security');
    await revoke('alice');
    await grant('alice', ['projects:read', 'memory:read', 'memory:write'], 'P2');
    expect(await visibleTexts('mcp', 'alice')).toEqual([]);
    await revoke('alice');
    await grant('alice', ['projects:read', 'memory:read', 'memory:write'], null);
    expect(await visibleTexts('mcp', 'alice')).toEqual(['alice fact']);
  });
});

describe('memory store', () => {
  it('keeps the switch off by default and per project', async () => {
    expect(await memoryEnabled(t.as('mcp'), scope('bob', 'P1'))).toBe(false);
    await setMemoryEnabled(t.as('web'), scope('bob', 'P1'), true);
    expect(await memoryEnabled(t.as('mcp'), scope('bob', 'P1'))).toBe(true);
    expect(await memoryEnabled(t.as('mcp'), scope('bob', 'P2'))).toBe(false);
    expect(await memoryEnabled(t.as('mcp'), scope('alice', 'P1'))).toBe(false);
  });

  it('versions an edit: the old entry is kept and points at the new one', async () => {
    const first = await addMemory(t.as('mcp'), scope('bob'), note('Fire class is REI 60', { tags: ['fire'] }));
    const second = await reviseMemory(t.as('mcp'), scope('bob'), first.id, { text: 'Fire class is REI 90', source: 'agent:Claude' });
    expect(second).toMatchObject({ text: 'Fire class is REI 90', kind: 'fact', tags: ['fire'], source: 'agent:Claude' });

    const current = await listMemory(t.as('mcp'), scope('bob'), { tag: 'fire' });
    expect(current.entries.map((e) => e.id)).toEqual([second!.id]);
    const all = await listMemory(t.as('mcp'), scope('bob'), { tag: 'fire', includeSuperseded: true });
    expect(all.entries.find((e) => e.id === first.id)).toMatchObject({ supersededBy: second!.id });
    expect(await reviseMemory(t.as('mcp'), scope('bob'), first.id, { text: 'again', source: 'user' })).toBeUndefined();
  });

  it('keeps one current summary per project and versions it', async () => {
    const a = await addMemory(t.as('mcp'), scope('bob'), { kind: 'summary', text: 'Brief v1', source: 'user' });
    const b = await addMemory(t.as('mcp'), scope('bob'), { kind: 'summary', text: 'Brief v2', source: 'agent:Claude' });
    const summaries = await listMemory(t.as('mcp'), scope('bob'), { kind: 'summary' });
    expect(summaries.entries.map((e) => e.text)).toEqual(['Brief v2']);
    const history = await listMemory(t.as('mcp'), scope('bob'), { kind: 'summary', includeSuperseded: true });
    expect(history.entries.find((e) => e.id === a.id)?.supersededBy).toBe(b.id);
  });

  it('forgets an entry together with its old versions', async () => {
    const first = await addMemory(t.as('mcp'), scope('bob'), note('to forget'));
    const second = await reviseMemory(t.as('mcp'), scope('bob'), first.id, { text: 'to forget v2', source: 'user' });
    expect(await forgetMemory(t.as('mcp'), scope('bob'), second!.id)).toBe(true);
    const { entries } = await listMemory(t.as('mcp'), scope('bob'), { includeSuperseded: true, contains: 'to forget' });
    expect(entries).toEqual([]);
    expect(await forgetMemory(t.as('mcp'), scope('bob'), second!.id)).toBe(false);
  });

  it('does not let one owner forget another\'s entry', async () => {
    const mine = await addMemory(t.as('mcp'), scope('alice'), note('alice only'));
    expect(await forgetMemory(t.as('mcp'), { ...scope('bob') }, mine.id)).toBe(false);
    expect((await listMemory(t.as('mcp'), scope('alice'), { ids: [mine.id] })).entries).toHaveLength(1);
  });

  it('lists the projects with a switch or entries, and deletes all of one project', async () => {
    await addMemory(t.as('mcp'), scope('bob', 'P2'), note('p2 note'));
    expect((await listMemoryProjects(t.as('web'), ids.bob)).map((p) => [p.projectId, p.enabled])).toEqual([
      ['P1', true],
      ['P2', false],
    ]);
    expect(await forgetAllMemory(t.as('web'), scope('bob', 'P1'))).toBeGreaterThan(0);
    expect((await listMemory(t.as('mcp'), scope('bob', 'P1'), { includeSuperseded: true })).total).toBe(0);
    expect((await listMemory(t.as('mcp'), scope('bob', 'P2'))).total).toBe(1);
  });

  it('refuses an entry over the limit, and text over 2,000 characters', async () => {
    expect(await pgError(addMemory(t.as('mcp'), scope('bob', 'P2'), note('x'.repeat(2001))))).toContain('memory_entries_text_length');
    await t.owner.query(
      `INSERT INTO memory_entries (account_id, connection_id, project_id, kind, text, source)
       SELECT $1, $2, 'P3', 'fact', 'n' || g, 'user' FROM generate_series(1, $3) g`,
      [ids.bob, ids.conn, MEMORY_MAX_ENTRIES],
    );
    await expect(addMemory(t.as('mcp'), scope('bob', 'P3'), note('one more'))).rejects.toThrow('already has');
  });

  it('removes an account\'s entries when the account is deleted', async () => {
    await t.owner.query('DELETE FROM accounts WHERE id = $1', [ids.robot]);
    const { rows } = await t.owner.query('SELECT count(*)::int AS n FROM memory_entries WHERE account_id = $1', [ids.bob]);
    expect(rows[0].n).toBeGreaterThan(0);
    await t.owner.query('DELETE FROM accounts WHERE id = $1', [ids.bob]);
    expect((await t.owner.query('SELECT count(*)::int AS n FROM memory_entries WHERE account_id = $1', [ids.bob])).rows[0].n).toBe(0);
  });
});
