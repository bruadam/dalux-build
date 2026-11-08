import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withAccount } from '../src/db';
import { createTestDatabase, type TestDatabase } from './testDatabase';

/**
 * Attempts to get around the database roles and row-level security, as the roles
 * the services use. Complements rls.test.ts, which tests the policies themselves.
 */
let t: TestDatabase;
const ids: Record<string, string> = {};

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await t.owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(row),
  );
  return rows[0].id;
}

/** The Postgres error message of a failed statement, as `role`. */
async function failure(role: 'web' | 'mcp' | 'worker', statement: string): Promise<string> {
  const client = await t.as(role).$client.connect();
  try {
    await client.query(statement);
  } catch (error) {
    return (error as Error).message;
  } finally {
    client.release(true);
  }
  throw new Error(`expected "${statement}" to fail`);
}

async function privilege(role: string, table: string, kind: string): Promise<boolean> {
  const { rows } = await t.owner.query('SELECT has_table_privilege($1, $2, $3) AS granted', [role, `public.${table}`, kind]);
  return rows[0].granted;
}

beforeAll(async () => {
  t = await createTestDatabase();
  ids.conn = await insert('connections', {
    name: 'Acme',
    slug: 'acme',
    base_url: 'https://acme.dalux.com',
    api_key_encrypted: 'v1.x.y',
    api_key_last4: '1234',
  });
  ids.alice = await insert('accounts', { type: 'personal', email: 'alice@example.com', name: 'alice' });
  ids.nobody = await insert('accounts', { type: 'personal', email: 'nobody@example.com', name: 'nobody' });
  await insert('grants', { account_id: ids.alice, connection_id: ids.conn, project_id: 'P1', capabilities: ['files:read'] });
  await t.owner.query('SELECT refresh_effective_access()');
  const index = await insert('indexes', { connection_id: ids.conn, kind: 'file', external_id: 'i1', project_id: 'P1', file_area_id: 'FA1', scope: {} });
  const shared = { index_id: index, connection_id: ids.conn, kind: 'file', project_id: 'P1', file_area_id: 'FA1', folder_ancestor_ids: ['F1'] };
  const document = await insert('documents', { ...shared, dalux_id: 'd1', folder_id: 'F1' });
  await insert('chunks', { ...shared, document_id: document, ordinal: 0, text: 'passage' });
});

afterAll(async () => {
  await t?.drop();
});

describe('service roles', () => {
  it.each(['web', 'mcp', 'worker'])('%s is not a superuser, does not bypass RLS, and cannot create roles or databases', async (role) => {
    const { rows } = await t.owner.query(
      'SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication FROM pg_roles WHERE rolname = $1',
      [role],
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false });
    const members = await t.owner.query('SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1', [role]);
    expect(members.rowCount).toBe(0);
  });

  it.each([
    ['mcp', 'worker'],
    ['mcp', 'migrator'],
    ['web', 'worker'],
    ['worker', 'migrator'],
  ] as const)('%s cannot switch to %s', async (role, target) => {
    expect(await failure(role, `SET ROLE ${target}`)).toMatch(/permission denied/);
    expect(await failure(role, `SET SESSION AUTHORIZATION ${target}`)).toMatch(/permission denied/);
  });

  it.each(['web', 'mcp', 'worker'] as const)('%s cannot create objects in the public schema', async (role) => {
    expect(await failure(role, 'CREATE TABLE public.planted (x int)')).toMatch(/permission denied/);
    expect(await failure(role, 'CREATE FUNCTION public.current_setting(text, boolean) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$')).toMatch(
      /permission denied/,
    );
  });

  it('mcp cannot turn row security off to read index data', async () => {
    const client = await t.as('mcp').$client.connect();
    try {
      await client.query('SET row_security = off');
      await expect(client.query('SELECT * FROM documents')).rejects.toThrow(/row-level security/);
    } finally {
      client.release(true);
    }
  });
});

describe('row-level security under search_path tricks (mcp role)', () => {
  /** Chunks visible to `account` on a session whose search_path and temp objects an attacker controls. */
  async function chunksSeenWithShadows(account: string): Promise<number> {
    const client = await t.as('mcp').$client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.account_id', $1, true)`, [account]);
      await client.query('CREATE TEMP TABLE effective_access (account_id uuid, connection_id uuid, capability text, project_id text, file_area_id text, folder_id text)');
      await client.query(`INSERT INTO pg_temp.effective_access SELECT $1::uuid, $2::uuid, 'files:read', NULL, NULL, NULL`, [account, ids.conn]);
      await client.query('CREATE TEMP TABLE accounts (id uuid, status text)');
      await client.query(`INSERT INTO pg_temp.accounts VALUES ($1::uuid, 'active')`, [account]);
      await client.query(`CREATE FUNCTION pg_temp.app_account_id() RETURNS uuid LANGUAGE sql AS $$ SELECT '${account}'::uuid $$`);
      await client.query('SET LOCAL search_path = pg_temp, public');
      const { rows } = await client.query('SELECT count(*)::int AS n FROM public.chunks');
      await client.query('ROLLBACK');
      return rows[0].n;
    } finally {
      client.release(true);
    }
  }

  it('does not let temporary tables or functions stand in for the policy inputs', async () => {
    expect(await chunksSeenWithShadows(ids.nobody)).toBe(0);
    expect(await chunksSeenWithShadows(ids.alice)).toBe(1);
  });

  it('shows nothing under a forged or malformed account id', async () => {
    const count = (account: string) =>
      withAccount(t.as('mcp'), account, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM chunks`)).then((result) => result.rows[0].n);
    expect(await count('00000000-0000-0000-0000-000000000000')).toBe(0);
    await expect(count("x'; SELECT 1 --")).rejects.toThrow();
  });
});

describe('memory (PRD 6.10): private to its owner, also against admins and the mcp role', () => {
  const read = (role: 'mcp' | 'web', account: string) =>
    withAccount(t.as(role), account, (tx) => tx.execute(sql`SELECT text FROM memory_entries ORDER BY text`)).then((result) => result.rows.map((row) => row.text));

  beforeAll(async () => {
    ids.boss = await insert('accounts', { type: 'personal', email: 'boss@example.com', name: 'boss', role: 'admin' });
    const everything = ['projects:read', 'files:read', 'memory:read', 'memory:write'];
    await insert('grants', { account_id: ids.boss, connection_id: ids.conn, capabilities: everything });
    await insert('grants', { account_id: ids.alice, connection_id: ids.conn, project_id: 'P1', capabilities: ['memory:read', 'memory:write'] });
    await t.owner.query('SELECT refresh_effective_access()');
    await t.owner.query(
      `INSERT INTO memory_entries (account_id, connection_id, project_id, kind, text, source) VALUES ($1, $2, 'P1', 'fact', $3, 'test')`,
      [ids.alice, ids.conn, "alice's private note"],
    );
  });

  it.each(['mcp', 'web'] as const)('shows an entry to its owner only, as %s, even to an admin holding every capability', async (role) => {
    expect(await read(role, ids.alice)).toEqual(["alice's private note"]);
    expect(await read(role, ids.boss)).toEqual([]);
    expect(await read(role, ids.nobody)).toEqual([]);
  });

  it('shows nothing without an account id, and refuses writes in another account\'s name', async () => {
    const client = await t.as('mcp').$client.connect();
    try {
      expect((await client.query('SELECT count(*)::int AS n FROM memory_entries')).rows[0].n).toBe(0);
    } finally {
      client.release(true);
    }
    await expect(
      withAccount(t.as('mcp'), ids.boss, (tx) =>
        tx.execute(sql`INSERT INTO memory_entries (account_id, connection_id, project_id, kind, text, source) VALUES (${ids.alice}, ${ids.conn}, 'P1', 'fact', 'planted', 'test')`),
      ),
    ).rejects.toThrow();
  });

  it('stops showing entries when the owner loses the capability, after the access refresh', async () => {
    await t.owner.query(`UPDATE grants SET capabilities = '{projects:read}' WHERE account_id = $1`, [ids.alice]);
    await t.owner.query('SELECT refresh_effective_access()');
    expect(await read('mcp', ids.alice)).toEqual([]);
  });
});

describe('SECURITY DEFINER functions', () => {
  it('are only refresh_effective_access and admin_stop_agent, with a fixed search_path and no PUBLIC execute', async () => {
    const { rows } = await t.owner.query(
      `SELECT p.proname, p.proconfig, has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
              has_function_privilege('mcp', p.oid, 'EXECUTE') AS mcp_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef ORDER BY p.proname`,
    );
    expect(rows.map((row) => row.proname)).toEqual(['admin_stop_agent', 'refresh_effective_access']);
    for (const row of rows) {
      expect(row.proconfig).toEqual(['search_path=public, pg_temp']);
      expect(row.public_exec).toBe(false);
      expect(row.mcp_exec).toBe(false);
    }
    expect(await failure('mcp', 'SELECT refresh_effective_access()')).toMatch(/permission denied/);
    expect(await failure('mcp', `SELECT admin_stop_agent('${randomUUID()}', true)`)).toMatch(/permission denied/);
  });

  it('admin_stop_agent refuses an account that is not an admin', async () => {
    expect(await failure('web', `SELECT admin_stop_agent('${randomUUID()}', true)`)).toMatch(/only admins/);
  });
});

describe('privileges', () => {
  it('web has no access to index data', async () => {
    for (const table of ['indexes', 'documents', 'chunks']) {
      for (const kind of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await privilege('web', table, kind)).toBe(false);
    }
  });

  it('mcp only writes audit rows, OAuth clients, sessions and tokens, memory, and a few columns', async () => {
    const { rows } = await t.owner.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    for (const { tablename } of rows) {
      for (const kind of ['INSERT', 'UPDATE', 'DELETE']) {
        const allowed = {
          INSERT: ['audit_log', 'auth_events', 'oauth_clients', 'oauth_sessions', 'oauth_tokens', 'memory_entries', 'memory_settings'],
          UPDATE: ['memory_settings'],
          DELETE: ['memory_entries'],
        }[kind]!.includes(tablename);
        expect([tablename, kind, await privilege('mcp', tablename, kind)]).toEqual([tablename, kind, allowed]);
      }
    }
    for (const table of ['grants', 'groups', 'group_memberships', 'auth_users', 'auth_sessions', 'auth_accounts', 'account_invites']) {
      expect(await privilege('mcp', table, 'SELECT')).toBe(false);
    }
  });

  it('mcp has no access to hosted agents or their runs', async () => {
    for (const table of ['hosted_agents', 'agent_runs', 'agent_run_files']) {
      for (const kind of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await privilege('mcp', table, kind)).toBe(false);
    }
  });

  it('worker has no access to memory, and nobody edits memory text in place', async () => {
    for (const table of ['memory_entries', 'memory_settings']) {
      for (const kind of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(await privilege('worker', table, kind)).toBe(false);
    }
    for (const role of ['web', 'mcp']) {
      expect(await privilege(role, 'memory_entries', 'UPDATE')).toBe(false);
      const { rows } = await t.owner.query(
        `SELECT column_name FROM information_schema.column_privileges WHERE grantee = $1 AND table_name = 'memory_entries' AND privilege_type = 'UPDATE'`,
        [role],
      );
      expect(rows).toEqual([{ column_name: 'superseded_by' }]);
    }
  });

  it('worker reads no credentials, tokens, grants, or login data and changes no account or connection', async () => {
    for (const table of ['api_tokens', 'oauth_clients', 'oauth_codes', 'oauth_sessions', 'oauth_tokens', 'grants', 'groups', 'group_memberships', 'auth_users', 'auth_sessions', 'auth_accounts', 'auth_verifications', 'account_invites']) {
      expect(await privilege('worker', table, 'SELECT')).toBe(false);
    }
    for (const table of ['accounts', 'connections', 'settings', 'grants']) {
      for (const kind of ['INSERT', 'UPDATE', 'DELETE']) expect(await privilege('worker', table, kind)).toBe(false);
    }
  });

  it('audit rows cannot be changed by anyone; only the worker deletes them (retention)', async () => {
    for (const role of ['web', 'mcp', 'worker']) expect(await privilege(role, 'audit_log', 'UPDATE')).toBe(false);
    expect(await privilege('worker', 'audit_log', 'DELETE')).toBe(true);
    expect(await privilege('web', 'audit_log', 'DELETE')).toBe(false);
    expect(await privilege('mcp', 'audit_log', 'DELETE')).toBe(false);
  });
});

describe('audit retention setting', () => {
  it('defaults to 180 days and rejects less than one day', async () => {
    await t.owner.query('INSERT INTO settings (id) VALUES (true) ON CONFLICT DO NOTHING');
    const { rows } = await t.owner.query('SELECT audit_retention_days FROM settings');
    expect(rows[0].audit_retention_days).toBe(180);
    await expect(t.owner.query('UPDATE settings SET audit_retention_days = 0')).rejects.toThrow(/settings_audit_retention/);
  });
});
