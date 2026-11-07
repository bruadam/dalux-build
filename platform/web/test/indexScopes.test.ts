import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { accounts, auditLog, connections, daluxUserLinks, indexScopes, type Db } from '@dalux-platform/db';
import { createTestDatabase, type TestDatabase } from '../../db/test/testDatabase';
import type { Actor } from '../lib/server/actor';
import { daluxUserLinksFor, linkDaluxUser, requestDaluxUserMatch, unlinkDaluxUser } from '../lib/server/daluxUsers';
import {
  createIndexScope,
  deleteIndexScope,
  getIndexScope,
  listIndexScopes,
  requestIndexRefresh,
  scopeFor,
  updateIndexScope,
} from '../lib/server/indexScopes';

process.env.PLATFORM_ENCRYPTION_KEY = randomBytes(32).toString('base64');

let t: TestDatabase;
let db: Db;
let admin: Actor;
let user: Actor;
let connectionId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.as('web');
  const [a] = await db.insert(accounts).values({ type: 'personal', email: 'ada@example.com', name: 'Ada', role: 'admin' }).returning();
  const [u] = await db.insert(accounts).values({ type: 'personal', email: 'uma@example.com', name: 'Uma' }).returning();
  admin = { accountId: a.id, role: 'admin', name: 'Ada', email: a.email };
  user = { accountId: u.id, role: 'user', name: 'Uma', email: u.email };
  const [c] = await db
    .insert(connections)
    .values({ name: 'Main', slug: 'main', baseUrl: 'https://node1.field.dalux.com/service/api', apiKeyEncrypted: 'x', apiKeyLast4: 'last' })
    .returning();
  connectionId = c.id;
});

afterAll(() => t.drop());

describe('index scopes', () => {
  it('keeps only the fields of the kind, and checks the required ones', () => {
    expect(scopeFor('file', { projectId: ' p1 ', fileAreaId: 'fa1', extensions: '.pdf, .docx', typeId: 'ignored', recursive: false })).toEqual({
      projectId: 'p1',
      fileAreaId: 'fa1',
      extensions: ['.pdf', '.docx'],
      recursive: false,
      includeDrawings: true,
    });
    expect(scopeFor('task', { projectId: 'p1', filter: '' })).toEqual({ projectId: 'p1' });
    expect(scopeFor('docs', { owner: 'acme', repo: 'docs', ref: 'v2' })).toEqual({ owner: 'acme', repo: 'docs', ref: 'v2' });
    expect(() => scopeFor('file', { projectId: 'p1' })).toThrow('Enter the file area ID');
    expect(() => scopeFor('file', { projectId: 'p1', fileAreaId: 'fa1', folderId: 'f', folderPath: '/a' })).toThrow(/either a folder ID/);
  });

  it('lets admins create, change, refresh, and delete scopes, with audit rows', async () => {
    const input = { connectionId, kind: 'task', name: 'Tasks', intervalHours: 6, scope: { projectId: 'p1' } };
    await expect(createIndexScope(db, user, input)).rejects.toThrow('Only admins can do this');
    await expect(createIndexScope(db, admin, { ...input, intervalHours: 0.1 })).rejects.toThrow(/at least every 15 minutes/);

    const id = await createIndexScope(db, admin, input);
    expect(await getIndexScope(db, id)).toMatchObject({ kind: 'task', intervalMinutes: 360, enabled: true, scope: { projectId: 'p1' }, connectionName: 'Main' });

    await updateIndexScope(db, admin, id, { enabled: false, intervalHours: 24 });
    await requestIndexRefresh(db, admin, id);
    expect(await getIndexScope(db, id)).toMatchObject({ enabled: false, intervalMinutes: 1440, refreshRequestedAt: expect.any(Date) });
    await expect(requestIndexRefresh(db, user, id)).rejects.toThrow('Only admins can do this');

    await deleteIndexScope(db, admin, id);
    expect(await listIndexScopes(db)).toEqual([]);
    const actions = (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.targetId, id))).map((row) => row.action);
    expect(actions).toEqual(['index_scope.create', 'index_scope.update', 'index_scope.refresh', 'index_scope.delete']);
  });
});

describe('Dalux user links', () => {
  it('links by hand only to a Dalux user of the connection, and requests a new match', async () => {
    await t.owner.query(`insert into dalux_users (connection_id, dalux_user_id, email, name) values ($1, 'u1', 'ada@example.com', 'Ada L')`, [connectionId]);
    await t.owner.query(
      `insert into dalux_user_links (account_id, connection_id, dalux_user_id, source) values ($1, $2, 'u1', 'auto')`,
      [admin.accountId, connectionId],
    );

    await expect(linkDaluxUser(db, admin, { accountId: user.accountId, connectionId, daluxUserId: 'u9' })).rejects.toThrow(/not on this connection/);
    await expect(linkDaluxUser(db, user, { accountId: user.accountId, connectionId, daluxUserId: 'u1' })).rejects.toThrow('Only admins can do this');
    await linkDaluxUser(db, admin, { accountId: user.accountId, connectionId, daluxUserId: 'u1' });

    const data = await daluxUserLinksFor(db, connectionId);
    expect(data?.accounts).toEqual([
      expect.objectContaining({ name: 'Ada', daluxUserId: 'u1', source: 'auto', daluxEmail: 'ada@example.com' }),
      expect.objectContaining({ name: 'Uma', daluxUserId: 'u1', source: 'manual', daluxName: 'Ada L' }),
    ]);
    expect(data?.daluxUsers).toEqual([{ daluxUserId: 'u1', email: 'ada@example.com', name: 'Ada L' }]);

    await unlinkDaluxUser(db, admin, { accountId: user.accountId, connectionId });
    expect(await db.select().from(daluxUserLinks).where(eq(daluxUserLinks.accountId, user.accountId))).toEqual([]);

    await requestDaluxUserMatch(db, admin, connectionId);
    const [row] = await db.select({ requestedAt: connections.daluxUsersRequestedAt }).from(connections);
    expect(row.requestedAt).toEqual(expect.any(Date));
  });

  it('gives the web role no write access to the copied Dalux users or runs', async () => {
    await expect(db.execute(sql`delete from dalux_users`)).rejects.toHaveProperty('cause.code', '42501');
    expect(await db.select().from(indexScopes)).toEqual([]);
  });
});
