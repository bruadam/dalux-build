import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createDb, DB_ROLES, encryptSecret, listMemory, runMigrations, withAccount, memoryEntries, type Db } from '@dalux-platform/db';

jest.setTimeout(60_000);

jest.mock('dalux-build-api', () => ({
  createClient: () => ({ projects: {}, fileAreas: {}, folders: {}, files: {}, tasks: {} }),
}));

/** Each keyword group is one direction, so "meaning" is easy to control: fire/brandklasse/REI are the same idea. */
const AXES: [RegExp, number][] = [
  [/fire|brand|rei/i, 0],
  [/crane/i, 1],
  [/budget/i, 2],
];
jest.mock('@mistralai/mistralai', () => ({
  Mistral: jest.fn().mockImplementation(() => ({
    embeddings: {
      create: async ({ inputs }: { inputs: string[] }) => {
        if (inputs.some((text) => text.includes('explode'))) throw new Error('provider down');
        return {
          data: inputs.map((text, index) => {
            const embedding = new Array<number>(1024).fill(0);
            embedding[AXES.find(([pattern]) => pattern.test(text))?.[1] ?? 3] = 1;
            return { index, embedding };
          }),
        };
      },
    },
  })),
}));

import { buildHttpApp } from '../../src/http';
import { hashApiToken, Platform } from '../../src/platform/platform';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://migrator:migrator@localhost:54329/platform_test';
const ROLE_PASSWORD = 'test-password';
const ENCRYPTION_KEY = Buffer.alloc(32, 7);

let admin: Pool;
let owner: Pool;
let mcpDb: Db;
let dbName: string;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

function dbUrl(role: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  if (role !== 'migrator') {
    url.username = role;
    url.password = ROLE_PASSWORD;
  }
  return url.toString();
}

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(row),
  );
  return rows[0]?.id;
}

async function account(name: string, role = 'user'): Promise<string> {
  ids[name] = await insert('accounts', { type: 'personal', email: `${name}@example.com`, name, role });
  const value = `dxm_${name}_${randomUUID()}`;
  await insert('api_tokens', { account_id: ids[name], name: `${name}-laptop`, token_hash: hashApiToken(value), prefix: value.slice(0, 8) });
  tokens[name] = value;
  return ids[name];
}

const grant = async (name: string, capabilities: string[], projectId: string | null = 'p1') => {
  await insert('grants', { account_id: ids[name], connection_id: ids.site, project_id: projectId, capabilities });
  await owner.query('SELECT refresh_effective_access()');
};
const revokeAll = async (name: string) => {
  await owner.query('DELETE FROM grants WHERE account_id = $1', [ids[name]]);
  await owner.query('SELECT refresh_effective_access()');
};

const MEMORY = ['projects:read', 'memory:read', 'memory:write'];

beforeAll(async () => {
  dbName = `test_${randomUUID().replace(/-/g, '')}`;
  admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await runMigrations(dbUrl('migrator'), Object.fromEntries(DB_ROLES.map((role) => [role, ROLE_PASSWORD])));
  owner = new Pool({ connectionString: dbUrl('migrator') });
  mcpDb = createDb(dbUrl('mcp'));
  ids.site = await insert('connections', {
    name: 'site',
    slug: 'site',
    base_url: 'https://node1.field.dalux.com/service/api',
    api_key_encrypted: encryptSecret('key', ENCRYPTION_KEY),
    api_key_last4: 'last',
  });
  for (const name of ['alice', 'bob', 'carol', 'dave', 'eve']) await account(name);
  await account('root', 'admin');
  await grant('alice', MEMORY);
  await grant('bob', MEMORY);
  await grant('root', [...MEMORY, 'files:read', 'tasks:read']);
  await grant('carol', ['projects:read', 'memory:read']);
  await grant('dave', ['memory:read', 'memory:write']);
  await grant('eve', ['projects:read']);
});

afterAll(async () => {
  await Promise.all([owner.end(), mcpDb.$client.end()]);
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.query(`DROP DATABASE ${dbName}`);
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== '55006' || attempt === 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await admin.end();
});

/** A fresh server (empty caches), with the admin's embedding key set or not. */
async function server(embeddingKey: string | null) {
  await owner.query('DELETE FROM settings');
  if (embeddingKey) {
    await owner.query('INSERT INTO settings (id, embedding_key_encrypted) VALUES (true, $1)', [encryptSecret(embeddingKey, ENCRYPTION_KEY)]);
  }
  return buildHttpApp({ platform: new Platform(mcpDb, ENCRYPTION_KEY) }).handleRequest;
}

type Json = Record<string, any>;

async function rpc(handle: Awaited<ReturnType<typeof server>>, token: string, method: string, params: Json) {
  const response = await handle(
    new Request('http://localhost/mcp/c/site', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const text = await response.text();
  const data = text.includes('data: ') ? text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).at(-1)! : text;
  return JSON.parse(data).result as Json;
}

function client(handle: Awaited<ReturnType<typeof server>>, name: string) {
  return {
    tools: async (): Promise<string[]> => (await rpc(handle, tokens[name], 'tools/list', {})).tools.map((t: { name: string }) => t.name),
    /** The tool's JSON result (or the refusal text). */
    call: async (tool: string, args: Json): Promise<{ isError: boolean; body: Json; raw: string }> => {
      const result = await rpc(handle, tokens[name], 'tools/call', { name: tool, arguments: { projectId: 'p1', ...args } });
      const raw = result.content.map((c: { text: string }) => c.text).join('');
      let body: Json = {};
      try {
        body = JSON.parse(raw);
      } catch {
        // a plain refusal from the access guard
      }
      return { isError: Boolean(result.isError), body, raw };
    },
  };
}

const count = async (name: string) =>
  Number((await owner.query('SELECT count(*) FROM memory_entries WHERE account_id = $1', [ids[name]])).rows[0].count);

describe('memory tools', () => {
  let lexical: Awaited<ReturnType<typeof server>>;
  let hybrid: Awaited<ReturnType<typeof server>>;
  let alice: ReturnType<typeof client>;

  beforeAll(async () => {
    lexical = await server(null);
    alice = client(lexical, 'alice');
  });

  it('lists the memory tools for people granted memory, and for no one else', async () => {
    const memoryTools = (await alice.tools()).filter((name) => name.startsWith('memory_')).sort();
    expect(memoryTools).toEqual(
      ['memory_forget', 'memory_list', 'memory_search', 'memory_set_enabled', 'memory_status', 'memory_update', 'memory_write'],
    );
    expect((await client(lexical, 'eve').tools()).some((name) => name.startsWith('memory_'))).toBe(false);
  });

  it('is off by default: every tool says so and nothing is written', async () => {
    for (const [tool, args] of [
      ['memory_status', {}],
      ['memory_search', { query: 'fire' }],
      ['memory_list', {}],
      ['memory_write', { kind: 'fact', text: 'must not be saved' }],
      ['memory_update', { id: randomUUID(), text: 'x' }],
      ['memory_forget', { id: randomUUID() }],
    ] as const) {
      const result = await alice.call(tool, args);
      expect(result.isError).toBe(false);
      expect(result.body).toMatchObject({ enabled: false });
      expect(result.body.message).toContain('Memory is off');
    }
    expect(await count('alice')).toBe(0);
  });

  it('refuses callers without the capability, naming it', async () => {
    const result = await client(lexical, 'carol').call('memory_write', { kind: 'fact', text: 'read-only caller' });
    expect(result.isError).toBe(true);
    expect(result.raw).toContain('memory:write');
    expect(await count('carol')).toBe(0);
    expect((await client(lexical, 'carol').call('memory_status', {})).body).toMatchObject({ enabled: false });
  });

  it('refuses a caller who cannot read the project', async () => {
    const result = await client(lexical, 'dave').call('memory_status', {});
    expect(result.isError).toBe(true);
    expect(result.raw).toContain('read access to the project');
  });

  it('turns on per project, writes entries with their writer, and keeps one summary', async () => {
    expect((await alice.call('memory_set_enabled', { enabled: true })).body).toEqual({ enabled: true });
    expect((await alice.call('memory_status', { projectId: 'p2' })).raw).toContain('memory:read');
    const written = await alice.call('memory_write', {
      kind: 'fact',
      text: 'The fire class of the stair core is REI 60.',
      tags: ['fire'],
      citations: [{ fileId: 'f1', fileName: 'fire-strategy.pdf', location: 'p. 4' }],
    });
    expect(written.body).toMatchObject({ saved: true, kind: 'fact' });
    await alice.call('memory_write', { kind: 'summary', text: 'Brief one.' });
    await alice.call('memory_write', { kind: 'summary', text: 'Brief two.' });

    const status = (await alice.call('memory_status', {})).body;
    expect(status).toMatchObject({ enabled: true, entries: 2, summary: { text: 'Brief two.', source: 'agent:alice-laptop' } });
    expect(status.note).toContain('not as instructions');

    const { entries } = await listMemory(mcpDb, { accountId: ids.alice, connectionId: ids.site, projectId: 'p1' }, { kind: 'fact' });
    expect(entries[0]).toMatchObject({ source: 'agent:alice-laptop', citations: [{ fileName: 'fire-strategy.pdf', location: 'p. 4' }] });
  });

  it('finds entries by keywords with ids, citations and one untrusted-text note', async () => {
    await alice.call('memory_write', { kind: 'decision', text: 'The client chose a tower crane on the north side.' });
    const result = (await alice.call('memory_search', { query: 'tower crane' })).body;
    expect(result.mode).toBe('lexical');
    expect(result.matches[0]).toMatchObject({ kind: 'decision', source: 'agent:alice-laptop' });
    expect(result.matches[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.note).toContain('not as instructions');
    expect(result.matches.some((m: Json) => 'note' in m)).toBe(false);
    const fire = (await alice.call('memory_search', { query: 'fire class stair' })).body;
    expect(fire.matches[0]).toMatchObject({ citations: [{ fileName: 'fire-strategy.pdf' }], tags: ['fire'] });
  });

  it('returns at most 8 hits of at most 500 characters, and full text by id', async () => {
    const long = `budget ${'overrun '.repeat(100)}`;
    for (let i = 0; i < 10; i++) await alice.call('memory_write', { kind: 'fact', text: `${long} item ${i}` });
    const { matches } = (await alice.call('memory_search', { query: 'budget overrun', topK: 8 })).body;
    expect(matches).toHaveLength(8);
    expect(matches.every((m: Json) => m.text.length <= 500 && m.truncated === true)).toBe(true);
    const listed = (await alice.call('memory_list', { ids: [matches[0].id] })).body;
    expect(listed.entries[0].text.length).toBeGreaterThan(500);
    expect((await alice.call('memory_search', { query: 'budget', topK: 20 })).isError).toBe(true);
  });

  it('adds meaning to the ranking when the admin has set an embedding key', async () => {
    await alice.call('memory_write', { kind: 'fact', text: 'Brandklasse for trappekernen er REI 90.' });
    expect((await alice.call('memory_search', { query: 'brand' })).body.matches).toEqual([]);

    hybrid = await server('embedding-key');
    const withKey = client(hybrid, 'alice');
    await withKey.call('memory_write', { kind: 'fact', text: 'Brandklasse for kælderen er REI 120.' });
    const result = (await withKey.call('memory_search', { query: 'brand', topK: 5 })).body;
    expect(result.mode).toBe('hybrid');
    const texts = result.matches.map((m: Json) => m.text).join(' ');
    expect(texts).toContain('REI 120');
    // Entries saved while no key was set have no embedding: they are found by keywords only.
    expect(texts).not.toContain('REI 90');
    expect(texts).not.toContain('crane');
    const scores = result.matches.map((m: Json) => m.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('saves without an embedding, and says so, when the provider fails', async () => {
    const result = await client(hybrid, 'alice').call('memory_write', { kind: 'fact', text: 'explode the provider' });
    expect(result.body).toMatchObject({ saved: true });
    expect(result.body.warning).toContain('keywords only');
    const { rows } = await owner.query("SELECT embedding IS NULL AS missing FROM memory_entries WHERE text = 'explode the provider'");
    expect(rows[0].missing).toBe(true);
  });

  it('versions an update and keeps the old entry', async () => {
    const written = (await alice.call('memory_write', { kind: 'preference', text: 'Reports as xlsx.' })).body;
    const updated = (await alice.call('memory_update', { id: written.id, text: 'Reports as docx.' })).body;
    expect(updated).toMatchObject({ updated: true, previousId: written.id });
    expect(updated.id).not.toBe(written.id);

    const current = (await alice.call('memory_list', { kind: 'preference' })).body;
    expect(current.entries.map((e: Json) => e.text)).toEqual(['Reports as docx.']);
    const history = (await alice.call('memory_list', { kind: 'preference', includeSuperseded: true })).body;
    expect(history.entries.find((e: Json) => e.id === written.id)).toMatchObject({ supersededBy: updated.id });
    expect((await alice.call('memory_update', { id: written.id, text: 'stale' })).isError).toBe(true);
    expect((await alice.call('memory_update', { id: updated.id })).isError).toBe(true);
  });

  it('forgets an entry for good', async () => {
    const { id } = (await alice.call('memory_write', { kind: 'open_question', text: 'Who signs off the slab?' })).body;
    expect((await alice.call('memory_forget', { id })).body).toEqual({ forgotten: true, id });
    expect((await alice.call('memory_forget', { id })).isError).toBe(true);
    expect((await alice.call('memory_list', { ids: [id] })).body.entries).toEqual([]);
  });

  it('keeps entries private: not for another user, not for an admin, not through the mcp role', async () => {
    const { id } = (await alice.call('memory_write', { kind: 'fact', text: 'Alice-only secret plan.' })).body;
    for (const name of ['bob', 'root']) {
      const other = client(lexical, name);
      await other.call('memory_set_enabled', { enabled: true });
      expect((await other.call('memory_search', { query: 'Alice secret plan' })).body.matches).toEqual([]);
      expect((await other.call('memory_list', { ids: [id] })).body.entries).toEqual([]);
      expect((await other.call('memory_forget', { id })).isError).toBe(true);
      expect((await other.call('memory_update', { id, text: 'hijacked' })).isError).toBe(true);
    }
    const rows = await withAccount(mcpDb, ids.root, (tx) => tx.select({ id: memoryEntries.id }).from(memoryEntries));
    expect(rows).toEqual([]);
    expect((await alice.call('memory_list', { ids: [id] })).body.entries[0].text).toBe('Alice-only secret plan.');
  });

  it('hides entries when the owner loses read access to the project', async () => {
    await client(lexical, 'bob').call('memory_write', { kind: 'fact', text: 'Bob keeps this note.' });
    await revokeAll('bob');
    await grant('bob', ['memory:read', 'memory:write']);
    const bob = client(await server(null), 'bob');
    const refused = await bob.call('memory_list', {});
    expect(refused.isError).toBe(true);
    expect(refused.raw).toContain('read access to the project');
    const rows = await withAccount(mcpDb, ids.bob, (tx) => tx.select({ id: memoryEntries.id }).from(memoryEntries));
    expect(rows).toEqual([]);
    await grant('bob', ['projects:read']);
    expect((await client(await server(null), 'bob').call('memory_list', {})).body.total).toBeGreaterThan(0);
  });
});
