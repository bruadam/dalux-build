import { eq } from 'drizzle-orm';
import { chunks, documents, indexes } from '../src/schema';
import { withAccount } from '../src/db';
import { createTestDatabase, type TestDatabase } from './testDatabase';

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

async function refresh(): Promise<void> {
  await t.owner.query('SELECT refresh_effective_access()');
}

async function addDocument(
  name: string,
  index: string,
  access: { kind: string; project_id: string | null; file_area_id: string | null; folder_ancestor_ids: string[] },
): Promise<void> {
  const { kind, project_id, file_area_id, folder_ancestor_ids } = access;
  const shared = { index_id: ids[index], connection_id: ids.conn, kind, project_id, file_area_id, folder_ancestor_ids };
  ids[name] = await insert('documents', {
    ...shared,
    dalux_id: name,
    folder_id: folder_ancestor_ids.at(-1) ?? null,
  });
  for (const ordinal of [0, 1]) {
    await insert('chunks', { ...shared, document_id: ids[name], ordinal, text: `${name} passage ${ordinal}` });
  }
}

/** The Postgres error message, unwrapped from drizzle's query error. */
async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const { cause } = error as { cause?: Error };
    return (cause ?? (error as Error)).message;
  }
  throw new Error('expected the query to fail');
}

/** Document names whose chunks `account` sees, querying as the mcp role. */
async function visibleChunkDocs(account: string): Promise<string[]> {
  const rows = await withAccount(t.as('mcp'), ids[account], (tx) =>
    tx.select({ dalux: documents.daluxId }).from(chunks).innerJoin(documents, eq(documents.id, chunks.documentId)),
  );
  return [...new Set(rows.map((r) => r.dalux))].sort();
}

async function visibleDocuments(account: string): Promise<string[]> {
  const rows = await withAccount(t.as('mcp'), ids[account], (tx) => tx.select({ dalux: documents.daluxId }).from(documents));
  return rows.map((r) => r.dalux).sort();
}

async function visibleIndexes(account: string): Promise<string[]> {
  const rows = await withAccount(t.as('mcp'), ids[account], (tx) => tx.select({ id: indexes.id }).from(indexes));
  const names = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return rows.map((r) => names[r.id]).sort();
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
  const personal = (name: string, status = 'active') =>
    insert('accounts', { type: 'personal', email: `${name}@example.com`, name, status });
  ids.alice = await personal('alice');
  ids.bob = await personal('bob');
  ids.carol = await personal('carol');
  ids.dave = await personal('dave');
  ids.erin = await personal('erin', 'disabled');
  ids.robot = await insert('accounts', { type: 'robot', name: 'triage', owner_account_id: ids.alice });

  ids.siteTeam = await insert('groups', { name: 'Site team' });
  await t.owner.query('INSERT INTO group_memberships (group_id, account_id) VALUES ($1, $2), ($1, $3)', [
    ids.siteTeam,
    ids.carol,
    ids.robot,
  ]);

  const grant = (principal: Record<string, string>, scope: Record<string, string>, capabilities: string[]) =>
    insert('grants', { ...principal, connection_id: ids.conn, ...scope, capabilities });
  await grant({ account_id: ids.alice }, { project_id: 'P1' }, ['files:read', 'projects:read']);
  await grant({ account_id: ids.bob }, { project_id: 'P1', file_area_id: 'FA1', folder_id: 'F2' }, ['files:read']);
  await grant({ group_id: ids.siteTeam }, { project_id: 'P1' }, ['tasks:read']);
  await grant({ account_id: ids.erin }, {}, ['files:read', 'tasks:read']);
  await refresh();

  const index = (kind: string, project_id: string | null, file_area_id: string | null) =>
    insert('indexes', { connection_id: ids.conn, kind, project_id, file_area_id, scope: {} });
  ids.filesP1 = await index('file', 'P1', 'FA1');
  ids.filesP2 = await index('file', 'P2', 'FA9');
  ids.tasksP1 = await index('task', 'P1', null);
  ids.docs = await index('docs', null, null);

  const file = (project_id: string, file_area_id: string, folder_ancestor_ids: string[]) => ({
    kind: 'file',
    project_id,
    file_area_id,
    folder_ancestor_ids,
  });
  await addDocument('root.pdf', 'filesP1', file('P1', 'FA1', ['F1']));
  await addDocument('f2.pdf', 'filesP1', file('P1', 'FA1', ['F1', 'F2']));
  await addDocument('f3.pdf', 'filesP1', file('P1', 'FA1', ['F1', 'F2', 'F3']));
  await addDocument('other.pdf', 'filesP2', file('P2', 'FA9', ['G1']));
  await addDocument('task-1', 'tasksP1', { kind: 'task', project_id: 'P1', file_area_id: null, folder_ancestor_ids: [] });
  await addDocument('law.pdf', 'docs', { kind: 'docs', project_id: null, file_area_id: null, folder_ancestor_ids: [] });
});

afterAll(async () => {
  await t?.drop();
});

describe('migrations', () => {
  it('create the schema on an empty database and are idempotent', async () => {
    const { rows } = await t.owner.query(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
      [['accounts', 'grants', 'effective_access', 'indexes', 'documents', 'chunks', 'audit_log']],
    );
    expect(rows[0].n).toBe(7);
    const { runMigrations } = await import('../src/migrate');
    await expect(runMigrations(t.url('migrator'))).resolves.toBeUndefined();
  });

  it('create the HNSW and GIN indexes', async () => {
    const { rows } = await t.owner.query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'chunks'`);
    const defs = rows.map((r) => r.indexdef).join('\n');
    expect(defs).toContain('USING hnsw (embedding vector_cosine_ops)');
    expect(defs).toContain('USING gin (folder_ancestor_ids)');
    expect(defs).toContain('USING gin (tsv)');
  });
});

describe('row-level security on index data (mcp role)', () => {
  it('project grant: all file chunks of that project, none of other projects', async () => {
    expect(await visibleChunkDocs('alice')).toEqual(['f2.pdf', 'f3.pdf', 'law.pdf', 'root.pdf']);
    expect(await visibleIndexes('alice')).toEqual(['docs', 'filesP1']);
  });

  it('folder grant: only that folder and its subfolders (success criterion 3)', async () => {
    expect(await visibleChunkDocs('bob')).toEqual(['f2.pdf', 'f3.pdf', 'law.pdf']);
    expect(await visibleDocuments('bob')).toEqual(['f2.pdf', 'f3.pdf', 'law.pdf']);
    expect(await visibleIndexes('bob')).toEqual(['docs', 'filesP1']);
  });

  it('group grant gives access to members, including robots', async () => {
    expect(await visibleChunkDocs('carol')).toEqual(['law.pdf', 'task-1']);
    expect(await visibleChunkDocs('robot')).toEqual(['law.pdf', 'task-1']);
  });

  it('docs corpus is visible to every active account, nothing to disabled accounts', async () => {
    expect(await visibleChunkDocs('dave')).toEqual(['law.pdf']);
    expect(await visibleChunkDocs('erin')).toEqual([]);
  });

  it('without app.account_id no rows are visible', async () => {
    const mcp = t.as('mcp');
    expect(await mcp.select().from(chunks)).toEqual([]);
    expect(await mcp.select().from(documents)).toEqual([]);
    expect(await mcp.select().from(indexes)).toEqual([]);
  });

  it('only the worker role writes index data', async () => {
    const mcp = t.as('mcp');
    expect(await pgError(withAccount(mcp, ids.alice, (tx) => tx.delete(chunks)))).toMatch(/permission denied/);
    expect(
      await pgError(withAccount(mcp, ids.alice, (tx) => tx.update(documents).set({ folderAncestorIds: ['F2'] }))),
    ).toMatch(/permission denied/);
    expect(await pgError(mcp.insert(indexes).values({ connectionId: ids.conn, kind: 'docs', scope: {} }))).toMatch(
      /permission denied/,
    );
    expect(await pgError(t.as('web').select().from(chunks))).toMatch(/permission denied/);
  });

  it('moving a document out of the granted folder hides it after the move (criterion 4)', async () => {
    const moved = ['F1', 'F4'];
    const worker = t.as('worker');
    await worker.transaction(async (tx) => {
      await tx.update(documents).set({ folderId: 'F4', folderAncestorIds: moved }).where(eq(documents.id, ids['f3.pdf']));
      await tx.update(chunks).set({ folderAncestorIds: moved }).where(eq(chunks.documentId, ids['f3.pdf']));
    });
    expect(await visibleChunkDocs('bob')).toEqual(['f2.pdf', 'law.pdf']);
    expect(await visibleChunkDocs('alice')).toEqual(['f2.pdf', 'f3.pdf', 'law.pdf', 'root.pdf']);
  });

  it('removing a group member hides rows after refresh_effective_access()', async () => {
    await t.owner.query('DELETE FROM group_memberships WHERE account_id = $1', [ids.carol]);
    expect(await visibleChunkDocs('carol')).toEqual(['law.pdf', 'task-1']);
    await refresh();
    expect(await visibleChunkDocs('carol')).toEqual(['law.pdf']);
    expect(await visibleChunkDocs('robot')).toEqual(['law.pdf', 'task-1']);
  });

  it('web and worker can refresh effective access; mcp cannot', async () => {
    await expect(t.as('web').$client.query('SELECT refresh_effective_access()')).resolves.toBeDefined();
    await expect(t.as('worker').$client.query('SELECT refresh_effective_access()')).resolves.toBeDefined();
    await expect(t.as('mcp').$client.query('SELECT refresh_effective_access()')).rejects.toThrow(/permission denied/);
  });
});

describe('grant constraints', () => {
  it('reject non-file capabilities below project level', async () => {
    await expect(
      insert('grants', {
        account_id: ids.dave,
        connection_id: ids.conn,
        project_id: 'P1',
        file_area_id: 'FA1',
        capabilities: ['tasks:read'],
      }),
    ).rejects.toThrow(/grants_file_scope_capabilities/);
  });
});
