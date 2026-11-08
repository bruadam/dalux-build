import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { DaluxClient } from 'dalux-build-api';
import { encryptSecret, indexRuns, indexScopes, type Db } from '@dalux-platform/db';
import { createTestDatabase, type TestDatabase } from '../../../platform/db/test/testDatabase';

const embedCalls: string[][] = [];
jest.mock('@mistralai/mistralai', () => ({
  Mistral: jest.fn().mockImplementation(() => ({
    embeddings: {
      create: async ({ inputs }: { inputs: string[] }) => {
        embedCalls.push(inputs);
        const vector = new Array(1024).fill(0);
        vector[0] = 1;
        return { data: inputs.map((_, index) => ({ index, embedding: vector })), usage: { promptTokens: 10 * inputs.length } };
      },
    },
  })),
}));

/** The fake Dalux connection: files of one file area, and project users. */
const files = [
  { fileId: 'a', fileName: 'a.md', folderId: 'f1', downloadLink: 'link:a', contentHash: 'a1' },
  { fileId: 'b', fileName: 'b.md', folderId: 'f1', downloadLink: 'link:b', contentHash: 'b1' },
  { fileId: 'c', fileName: 'plan.dwg', folderId: 'f1', downloadLink: 'link:c', contentHash: 'c1' },
];
const projectUsers: Record<string, object[]> = {
  p1: [
    { userId: 'u1', userType: 'user', email: ' Alice@Example.com ', firstName: 'Alice', lastName: 'A' },
    { userId: 'u2', userType: 'user', email: 'dup@example.com' },
  ],
  p2: [
    { userId: 'u1', userType: 'user', email: 'alice@example.com' },
    { userId: 'u3', userType: 'user', email: 'DUP@example.com' },
    { userId: 'u4', userType: 'user', email: 'carol@example.com' },
    { userId: 'u5', userType: 'user', email: 'bot@example.com' },
  ],
};
let failUsers = false;

const fakeClient = {
  projects: { listProjects: async () => ({ items: [{ projectId: 'p1' }, { projectId: 'p2' }] }) },
  users: {
    listProjectUsers: async (projectId: string) => {
      if (failUsers) throw new Error('Dalux is down');
      return { items: projectUsers[projectId] };
    },
  },
  folders: { listFolders: async () => ({ items: [{ folderId: 'f1', parentFolderId: null }] }) },
  files: {
    listFiles: async () => ({ items: files }),
    downloadFileFromLink: async (link: string, name: string, dir: string) => {
      const target = path.join(dir, name);
      writeFileSync(target, `# File ${link}\n\nRevision ${files.find((f) => f.downloadLink === link)?.contentHash}.\n`);
      return target;
    },
  },
} as unknown as DaluxClient;

jest.mock('dalux-build-api', () => ({ createClient: () => fakeClient }));

import { postgresIndexStores } from '../../src/store/postgres';
import { setIndexStores } from '../../src/store';
import { matchConnection, planLinks, syncConnectionUsers } from '../../src/worker/daluxUsers';
import { dueScopes, runScope, type WorkerDeps } from '../../src/worker/indexScopes';
import { purgeAuditLog } from '../../src/worker/auditRetention';
import { tick } from '../../src/worker/main';

jest.setTimeout(120_000);

const ENCRYPTION_KEY = Buffer.alloc(32, 7);

let database: TestDatabase;
let worker: Db;
let web: Db;
let cacheDir: string;
let connectionId: string;
let embeddingKey: string | null = 'mistral-key';

const deps = (): WorkerDeps => ({ db: worker, clientFor: async () => fakeClient, embeddingKey: async () => embeddingKey });

async function ownerRow<T>(query: string, values: unknown[] = []): Promise<T> {
  const { rows } = await database.owner.query(query, values);
  return rows[0] as T;
}

async function createScope(values: Partial<typeof indexScopes.$inferInsert> = {}): Promise<string> {
  const [row] = await web
    .insert(indexScopes)
    .values({ connectionId, kind: 'file', name: 'Docs', scope: { projectId: 'p1', fileAreaId: 'fa1', folderId: 'f1' }, ...values })
    .returning({ id: indexScopes.id });
  return row.id;
}

async function run(id: string) {
  return ownerRow<Record<string, unknown>>('select * from index_runs where id = $1', [await runScope(deps(), id, 'manual')]);
}

beforeAll(async () => {
  database = await createTestDatabase();
  worker = database.as('worker');
  web = database.as('web');
  const { build } = postgresIndexStores({ mcp: worker, worker });
  setIndexStores(build, build);
  cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-worker-'));
  process.env.DALUX_MCP_CACHE_DIR = cacheDir;
  delete process.env.MISTRAL_API_KEY;
  ({ id: connectionId } = await ownerRow<{ id: string }>(
    `insert into connections (name, slug, base_url, api_key_encrypted, api_key_last4)
     values ('Site', 'site', 'https://node1.field.dalux.com/service/api', $1, 'last') returning id`,
    [encryptSecret('dalux-key', ENCRYPTION_KEY)],
  ));
});

afterAll(async () => {
  await database?.drop();
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('index scopes', () => {
  it('lets the web role manage scopes and only read runs; the mcp role sees neither', async () => {
    const id = await createScope({ name: 'Temp' });
    await web.update(indexScopes).set({ enabled: false, intervalMinutes: 60 }).where(sql`id = ${id}`);
    const denied = (query: Promise<unknown>) => expect(query).rejects.toHaveProperty('cause.code', '42501');
    await denied(web.insert(indexRuns).values({ scopeId: id, trigger: 'manual' }));
    await denied(worker.insert(indexScopes).values({ connectionId, kind: 'task', name: 'x', scope: {} }));
    await denied(database.as('mcp').select().from(indexScopes));
    await denied(database.as('mcp').select().from(indexRuns));
    await expect(web.update(indexScopes).set({ intervalMinutes: 5 }).where(sql`id = ${id}`)).rejects.toHaveProperty('cause.constraint', 'index_scopes_interval');
    await web.delete(indexScopes).where(sql`id = ${id}`);
  });

  it('picks scopes that are new, past their interval, or asked to refresh', async () => {
    const enabled = await createScope();
    const disabled = await createScope({ enabled: false });
    expect(await dueScopes(worker)).toEqual([{ id: enabled, trigger: 'schedule' }]);

    await database.owner.query(`update index_scopes set last_run_at = now() where id = $1`, [enabled]);
    expect(await dueScopes(worker)).toEqual([]);
    await database.owner.query(`update index_scopes set last_run_at = now() - interval '361 minutes' where id = $1`, [enabled]);
    await web.update(indexScopes).set({ refreshRequestedAt: new Date() }).where(sql`id = ${disabled}`);
    expect(await dueScopes(worker)).toEqual([
      { id: disabled, trigger: 'manual' },
      { id: enabled, trigger: 'schedule' },
    ]);
    await database.owner.query(`delete from index_scopes`);
  });

  it('builds a scope, records the run, and refreshes only changed files', async () => {
    const id = await createScope();
    embedCalls.length = 0;

    const first = await run(id);
    expect(first).toMatchObject({
      trigger: 'manual',
      status: 'ok',
      items_in_scope: 2,
      items_indexed: 2,
      items_reused: 0,
      embedding_model: 'mistral-embed',
      embedding_tokens: 10 * embedCalls.flat().length,
      embedding_tokens_estimated: false,
      error: null,
    });
    expect(first.skipped).toEqual([expect.objectContaining({ count: 1 })]);
    expect(first.duration_ms).toEqual(expect.any(Number));
    expect(embedCalls.length).toBeGreaterThan(0);
    expect(await ownerRow('select last_run_status from index_scopes where id = $1', [id])).toEqual({ last_run_status: 'ok' });
    const { count } = await ownerRow<{ count: string }>(`select count(*) from documents where connection_id = $1`, [connectionId]);
    expect(Number(count)).toBe(2);

    embedCalls.length = 0;
    const unchanged = await run(id);
    expect(unchanged).toMatchObject({ status: 'ok', items_indexed: 0, items_reused: 2, embedding_tokens: 0 });
    expect(embedCalls).toEqual([]);

    files[1].contentHash = 'b2';
    const changed = await run(id);
    expect(changed).toMatchObject({ status: 'ok', items_indexed: 1, items_reused: 1 });
    expect(embedCalls.flat().every((input) => input.includes('link:b'))).toBe(true);
    await database.owner.query(`delete from index_scopes`);
  });

  it('builds lexical indexes without an embedding key, with no fallback to MISTRAL_API_KEY', async () => {
    embeddingKey = null;
    process.env.MISTRAL_API_KEY = 'env-key';
    try {
      const id = await createScope({ scope: { projectId: 'p1', fileAreaId: 'fa2' } });
      embedCalls.length = 0;
      expect(await run(id)).toMatchObject({ status: 'ok', items_indexed: 2, embedding_model: null, embedding_tokens: null });
      expect(embedCalls).toEqual([]);
    } finally {
      embeddingKey = 'mistral-key';
      delete process.env.MISTRAL_API_KEY;
      await database.owner.query(`delete from index_scopes`);
    }
  });

  it('records a failed run with the reason', async () => {
    const id = await createScope({ scope: { projectId: 'p1', fileAreaId: 'fa1', folderId: 'f1', folderPath: '/x' } });
    expect(await run(id)).toMatchObject({ status: 'failed', error: 'Pass either folderId or folderPath, not both.' });
    expect(await ownerRow('select last_run_status from index_scopes where id = $1', [id])).toEqual({ last_run_status: 'failed' });
    await database.owner.query(`delete from index_scopes`);
  });
});

describe('Dalux user matching', () => {
  const account = (id: string, email: string | null, type: 'personal' | 'robot' = 'personal') => ({ id, type, email });

  it('links a single email match, case-insensitive and trimmed', () => {
    const users = [{ daluxUserId: 'u1', email: ' Alice@Example.COM', name: null }];
    expect(planLinks([account('a', 'alice@example.com ')], users, [])).toEqual({ link: [{ accountId: 'a', daluxUserId: 'u1' }], unlink: [] });
  });

  it('leaves accounts with several or no matches unlinked, and removes their old automatic link', () => {
    const users = [
      { daluxUserId: 'u2', email: 'dup@example.com', name: null },
      { daluxUserId: 'u3', email: 'DUP@example.com', name: null },
    ];
    const plan = planLinks(
      [account('a', 'dup@example.com'), account('b', 'nobody@example.com'), account('c', 'gone@example.com')],
      users,
      [{ accountId: 'a', daluxUserId: 'u2', source: 'auto' }],
    );
    expect(plan).toEqual({ link: [], unlink: ['a'] });
  });

  it('never changes manual links and never matches robots', () => {
    const users = [{ daluxUserId: 'u1', email: 'alice@example.com', name: null }];
    const plan = planLinks(
      [account('a', 'alice@example.com'), account('r', 'alice@example.com', 'robot')],
      users,
      [{ accountId: 'a', daluxUserId: 'u9', source: 'manual' }],
    );
    expect(plan).toEqual({ link: [], unlink: [] });
  });

  it('copies users of every project once, links accounts, and keeps manual links', async () => {
    const insertAccount = async (email: string) =>
      (await ownerRow<{ id: string }>(`insert into accounts (type, email, name) values ('personal', $1, $1) returning id`, [email])).id;
    const alice = await insertAccount('ALICE@example.com');
    const dup = await insertAccount('dup@example.com');
    const carol = await insertAccount('carol@example.com');
    const robot = (await ownerRow<{ id: string }>(
      `insert into accounts (type, email, name, owner_account_id) values ('robot', 'bot@example.com', 'bot', $1) returning id`,
      [alice],
    )).id;
    await database.owner.query(
      `insert into dalux_user_links (account_id, connection_id, dalux_user_id, source) values ($1, $2, 'u1', 'manual')`,
      [carol, connectionId],
    );

    await syncConnectionUsers(worker, connectionId, async () => fakeClient);

    const { rows: users } = await database.owner.query(`select dalux_user_id, email, name from dalux_users order by dalux_user_id`);
    expect(users).toEqual([
      { dalux_user_id: 'u1', email: 'Alice@Example.com', name: 'Alice A' },
      { dalux_user_id: 'u2', email: 'dup@example.com', name: null },
      { dalux_user_id: 'u3', email: 'DUP@example.com', name: null },
      { dalux_user_id: 'u4', email: 'carol@example.com', name: null },
      { dalux_user_id: 'u5', email: 'bot@example.com', name: null },
    ]);
    const links = async () =>
      (await database.owner.query(`select account_id, dalux_user_id, source from dalux_user_links order by source, dalux_user_id`)).rows;
    expect(await links()).toEqual([
      { account_id: alice, dalux_user_id: 'u1', source: 'auto' },
      { account_id: carol, dalux_user_id: 'u1', source: 'manual' },
    ]);
    expect((await links()).some((row) => row.account_id === dup || row.account_id === robot)).toBe(false);
    expect(await ownerRow('select dalux_users_sync_error from connections where id = $1', [connectionId])).toEqual({ dalux_users_sync_error: null });

    // An admin links Alice by hand: matching does not overwrite it.
    await database.owner.query(`update dalux_user_links set dalux_user_id = 'u4', source = 'manual' where account_id = $1`, [alice]);
    await matchConnection(worker, connectionId);
    expect(await ownerRow('select dalux_user_id, source from dalux_user_links where account_id = $1', [alice])).toEqual({ dalux_user_id: 'u4', source: 'manual' });

    failUsers = true;
    await syncConnectionUsers(worker, connectionId, async () => fakeClient);
    failUsers = false;
    expect(await ownerRow('select dalux_users_sync_error from connections where id = $1', [connectionId])).toEqual({ dalux_users_sync_error: 'Dalux is down' });
    expect(Number((await ownerRow<{ count: string }>('select count(*) from dalux_users')).count)).toBe(5);
  });
});

describe('tick', () => {
  it('queues due scopes and user syncs once per scope or connection', async () => {
    const id = await createScope();
    await database.owner.query(`update connections set dalux_users_synced_at = null`);
    const sent: [string, object, object?][] = [];
    await tick({ send: async (name: string, data?: object | null, options?: object) => { sent.push([name, data ?? {}, options]); return null; } } as never, worker);
    expect(sent).toEqual([
      ['index-scope', { id, trigger: 'schedule' }, { singletonKey: id }],
      ['dalux-users', { connectionId }, { singletonKey: connectionId }],
    ]);
    await database.owner.query(`delete from index_scopes`);
  });
});

describe('worker process', () => {
  it('runs a "Refresh now" and a user sync through pg-boss as the worker role', async () => {
    // A real `dalux-mcp worker` process (pg-boss is ESM-only, which jest cannot load), on a
    // connection whose base URL is refused before any request: both jobs run and record the failure.
    const { id: brokenId } = await ownerRow<{ id: string }>(
      `insert into connections (name, slug, base_url, api_key_encrypted, api_key_last4)
       values ('Broken', 'broken', 'http://localhost/service/api', $1, 'last') returning id`,
      [encryptSecret('dalux-key', ENCRYPTION_KEY)],
    );
    await database.owner.query(`update connections set dalux_users_synced_at = now() where id <> $1`, [brokenId]);
    const [{ id }] = await web
      .insert(indexScopes)
      .values({ connectionId: brokenId, kind: 'task', name: 'Tasks', scope: { projectId: 'p1' }, enabled: false, refreshRequestedAt: new Date() })
      .returning({ id: indexScopes.id });

    const child = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/cli.ts', 'worker'], {
      cwd: path.join(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL_WORKER: database.url('worker'), PLATFORM_ENCRYPTION_KEY: ENCRYPTION_KEY.toString('base64') },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    try {
      let run: { status: string; error: string | null; trigger: string } | undefined;
      let sync: { dalux_users_sync_error: string | null } | undefined;
      for (const deadline = Date.now() + 90_000; Date.now() < deadline && !(run && sync?.dalux_users_sync_error); ) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        run = await ownerRow(`select status, error, trigger from index_runs where scope_id = $1 and status <> 'running'`, [id]);
        sync = await ownerRow('select dalux_users_sync_error from connections where id = $1', [brokenId]);
      }
      const refused = 'Connection broken: base URL must be an https://*.dalux.com URL';
      expect({ run, stderr }).toMatchObject({ run: { status: 'failed', trigger: 'manual', error: refused } });
      expect(sync?.dalux_users_sync_error).toBe(refused);
      const { rows } = await database.owner.query(`select count(*) from pgboss.job`);
      expect(Number(rows[0].count)).toBeGreaterThan(0);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  });
});

describe('audit retention', () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const remaining = async () =>
    (await database.owner.query(`select action from audit_log where action like 'retention.%' order by action`)).rows.map((row) => row.action);

  it('deletes audit rows older than the retention setting, 180 days by default, as the worker role', async () => {
    for (const [action, age] of [['retention.old', 200], ['retention.mid', 100], ['retention.new', 1]] as const) {
      await database.owner.query(`insert into audit_log (at, kind, action) values ($1, 'admin', $2)`, [daysAgo(age), action]);
    }
    for (const [reason, age] of [['retention_old', 200], ['retention_new', 1]] as const) {
      await database.owner.query(`insert into auth_events (at, source, reason) values ($1, 'mcp', $2)`, [daysAgo(age), reason]);
    }
    expect(await purgeAuditLog(worker)).toBeGreaterThanOrEqual(2);
    expect(await remaining()).toEqual(['retention.mid', 'retention.new']);
    const events = async () => (await database.owner.query(`select reason from auth_events where reason like 'retention_%' order by reason`)).rows.map((row) => row.reason);
    expect(await events()).toEqual(['retention_new']);

    await database.owner.query('insert into settings (id, audit_retention_days) values (true, 30) on conflict (id) do update set audit_retention_days = 30');
    await purgeAuditLog(worker);
    expect(await remaining()).toEqual(['retention.new']);
  });
});
