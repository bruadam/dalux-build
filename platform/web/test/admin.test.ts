import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  accountInvites,
  accounts,
  apiTokens,
  auditLog,
  authUsers,
  connections,
  decryptSecret,
  effectiveAccess,
  hashApiToken,
  loadEncryptionKey,
  settings,
  type Db,
} from '@dalux-platform/db';
import { createTestDatabase, type TestDatabase } from '../../db/test/testDatabase';
import { PRESETS } from '../lib/capabilities';
import { inviteAccount, setAccountRole, setAccountStatus } from '../lib/server/accounts';
import type { Actor } from '../lib/server/actor';
import { effectiveAccessFor } from '../lib/server/access';
import { addConnection, rotateConnectionKey } from '../lib/server/connections';
import { UserError } from '../lib/server/errors';
import { createGrant, deleteGrant, resolveGrant } from '../lib/server/grants';
import { addMember, createGroup, removeMember } from '../lib/server/groups';
import { createRobot } from '../lib/server/robots';
import { setEmbeddingKey, setHeaderMode } from '../lib/server/settings';
import { accountForNewLogin, signUp, type CreateLogin } from '../lib/server/signup';
import { createApiToken, revokeApiToken } from '../lib/server/tokens';

process.env.PLATFORM_ENCRYPTION_KEY = randomBytes(32).toString('base64');

let t: TestDatabase;
let db: Db;
let admin: Actor;
let user: Actor;
let connectionId: string;
const verified: string[] = [];
const verify = async (_baseUrl: string, apiKey: string) => {
  if (apiKey === 'bad-key') throw new UserError('Dalux did not accept the key');
  verified.push(apiKey);
};

/** Stands in for Better Auth: runs the same link hook, then inserts the user row. */
const createLogin: CreateLogin = async ({ email, name }) => {
  const platformAccountId = await accountForNewLogin(db, email);
  await db.insert(authUsers).values({ id: randomBytes(8).toString('hex'), platformAccountId, email, name });
};

const accessOf = async (accountId: string) =>
  (await effectiveAccessFor(db, accountId)).map((row) => `${row.capability}@${row.projectId ?? '*'}${row.viaGroup ? ` via ${row.viaGroup}` : ''}`);

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.as('web');
  const adminId = await signUp(db, createLogin, { email: 'Admin@Example.com', password: 'unused', name: 'Ada' });
  admin = { accountId: adminId, role: 'admin', name: 'Ada', email: 'admin@example.com' };
  connectionId = await addConnection(db, admin, { name: 'Main', slug: 'main', baseUrl: 'https://node1.field.dalux.com/service/api', apiKey: 'key-1234' }, verify);
  const { inviteToken } = await inviteAccount(db, admin, { email: 'user@example.com', name: 'Uma', role: 'user' });
  const userId = await signUp(db, createLogin, { email: 'ignored@example.com', password: 'unused', name: '', inviteToken });
  user = { accountId: userId, role: 'user', name: 'Uma', email: 'user@example.com' };
});

afterAll(() => t.drop());

describe('sign-up', () => {
  it('makes the first account an active admin with a linked login', async () => {
    const [row] = await db.select().from(accounts).where(eq(accounts.id, admin.accountId));
    expect(row).toMatchObject({ role: 'admin', status: 'active', email: 'admin@example.com' });
    const [login] = await db.select().from(authUsers).where(eq(authUsers.platformAccountId, admin.accountId));
    expect(login.email).toBe('admin@example.com');
  });

  it('requires an invite once an account exists', async () => {
    await expect(signUp(db, createLogin, { email: 'x@example.com', password: 'p', name: 'X' })).rejects.toThrow('invite');
    await expect(accountForNewLogin(db, 'x@example.com')).rejects.toThrow('invite');
  });

  it('activates the invited account for the invited email and uses the link up once', async () => {
    const [row] = await db.select().from(accounts).where(eq(accounts.id, user.accountId));
    expect(row).toMatchObject({ status: 'active', email: 'user@example.com', role: 'user' });
    const invites = await db.select().from(accountInvites).where(eq(accountInvites.accountId, user.accountId));
    expect(invites[0].usedAt).not.toBeNull();
    expect(invites[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a used or unknown invite token', async () => {
    const { inviteToken } = await inviteAccount(db, admin, { email: 'v@example.com', name: 'V', role: 'user' });
    await signUp(db, createLogin, { email: '', password: 'p', name: 'V', inviteToken });
    await expect(signUp(db, createLogin, { email: '', password: 'p', name: 'V', inviteToken })).rejects.toThrow('invalid');
    await expect(signUp(db, createLogin, { email: '', password: 'p', name: 'V', inviteToken: 'nope' })).rejects.toThrow('invalid');
  });

  it('removes the first admin again when creating the login fails', async () => {
    const other = await createTestDatabase();
    try {
      const failing: CreateLogin = async () => {
        throw new Error('password too short');
      };
      await expect(signUp(other.as('web'), failing, { email: 'a@b.c', password: 'x', name: 'A' })).rejects.toThrow('too short');
      expect(await other.as('web').select().from(accounts)).toHaveLength(0);
    } finally {
      await other.drop();
    }
  });
});

describe('tokens', () => {
  it('stores only the sha256 hash of the full dxm_ token and a display prefix', async () => {
    const { id, token } = await createApiToken(db, user, { accountId: user.accountId, name: 'laptop' });
    expect(token).toMatch(/^dxm_[A-Za-z0-9_-]{43}$/);
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, id));
    expect(row.tokenHash).toBe(hashApiToken(token));
    expect(row.prefix).toBe(token.slice(0, 12));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('lets admins manage robot tokens but nobody manage another person\'s tokens', async () => {
    const robotId = await createRobot(db, admin, { name: 'Triage bot', ownerAccountId: user.accountId });
    const { id } = await createApiToken(db, admin, { accountId: robotId, name: 'ci' });
    await revokeApiToken(db, admin, id);
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, id));
    expect(row.revokedAt).not.toBeNull();
    await expect(createApiToken(db, user, { accountId: robotId, name: 'x' })).rejects.toThrow(UserError);
    await expect(createApiToken(db, admin, { accountId: user.accountId, name: 'x' })).rejects.toThrow(UserError);
    const { id: own } = await createApiToken(db, user, { accountId: user.accountId, name: 'own' });
    await expect(revokeApiToken(db, admin, own)).rejects.toThrow(UserError);
  });
});

describe('grants', () => {
  it('expands the Reader preset to every read capability', () => {
    const grant = resolveGrant({ accountId: 'a', connectionId: 'c', preset: 'reader' });
    expect(grant.capabilities).toEqual([...PRESETS.reader].sort());
    expect(grant.capabilities).toContain('files:read');
    expect(grant.capabilities.every((c) => c.endsWith(':read'))).toBe(true);
  });

  it('keeps only files:* on file area and folder scopes', () => {
    const grant = resolveGrant({ groupId: 'g', connectionId: 'c', projectId: 'p', fileAreaId: 'fa', folderId: 'f', preset: 'reader' });
    expect(grant.capabilities).toEqual(['files:read']);
    expect(() => resolveGrant({ groupId: 'g', connectionId: 'c', projectId: 'p', fileAreaId: 'fa', capabilities: ['tasks:read'] })).toThrow('files:*');
  });

  it('rejects bad principals, scope chains, and capability names', () => {
    expect(() => resolveGrant({ connectionId: 'c', preset: 'reader' })).toThrow('exactly one');
    expect(() => resolveGrant({ accountId: 'a', groupId: 'g', connectionId: 'c', preset: 'reader' })).toThrow('exactly one');
    expect(() => resolveGrant({ accountId: 'a', connectionId: 'c', fileAreaId: 'fa', preset: 'reader' })).toThrow('project');
    expect(() => resolveGrant({ accountId: 'a', connectionId: 'c', projectId: 'p', folderId: 'f', preset: 'reader' })).toThrow('file area');
    expect(() => resolveGrant({ accountId: 'a', connectionId: 'c', capabilities: ['files:write2'] })).toThrow('Unknown');
    expect(() => resolveGrant({ accountId: 'a', connectionId: 'c' })).toThrow('at least one');
  });

  it('refreshes effective access and audits on create and delete', async () => {
    const grantId = await createGrant(db, admin, { accountId: user.accountId, connectionId, projectId: 'P1', capabilities: ['tasks:read'] });
    expect(await accessOf(user.accountId)).toEqual(['tasks:read@P1']);
    await deleteGrant(db, admin, grantId);
    expect(await accessOf(user.accountId)).toEqual([]);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.targetId, grantId))).map((row) => row.action);
    expect(actions).toEqual(['grant.create', 'grant.delete']);
  });

  it('is admin-only', async () => {
    await expect(createGrant(db, user, { accountId: user.accountId, connectionId, preset: 'reader' })).rejects.toThrow('Only admins');
  });
});

describe('groups and account status', () => {
  it('gives access through group membership and shows the group as the source', async () => {
    const groupId = await createGroup(db, admin, { name: 'Site team' });
    const grantId = await createGrant(db, admin, { groupId, connectionId, projectId: 'P2', capabilities: ['files:read'] });
    await addMember(db, admin, groupId, user.accountId);
    expect(await accessOf(user.accountId)).toEqual(['files:read@P2 via Site team']);
    await removeMember(db, admin, groupId, user.accountId);
    expect(await accessOf(user.accountId)).toEqual([]);
    await deleteGrant(db, admin, grantId);
  });

  it('drops access and sessions of a disabled account and restores access on enable', async () => {
    const grantId = await createGrant(db, admin, { accountId: user.accountId, connectionId, preset: 'reader' });
    await setAccountStatus(db, admin, user.accountId, 'disabled');
    expect(await db.select().from(effectiveAccess).where(eq(effectiveAccess.accountId, user.accountId))).toHaveLength(0);
    await setAccountStatus(db, admin, user.accountId, 'active');
    expect((await accessOf(user.accountId)).length).toBe(PRESETS.reader.length);
    await deleteGrant(db, admin, grantId);
  });

  it('always keeps one active admin', async () => {
    await expect(setAccountStatus(db, admin, admin.accountId, 'disabled')).rejects.toThrow('at least one active admin');
    await expect(setAccountRole(db, admin, admin.accountId, 'user')).rejects.toThrow('at least one active admin');
    await setAccountRole(db, admin, user.accountId, 'admin');
    await setAccountRole(db, admin, user.accountId, 'user');
  });
});

describe('connections and settings', () => {
  it('verifies the key, then stores it encrypted with its last 4 characters', async () => {
    const [row] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(verified).toContain('key-1234');
    expect(row.apiKeyLast4).toBe('1234');
    expect(row.apiKeyEncrypted).not.toContain('key-1234');
    expect(decryptSecret(row.apiKeyEncrypted, loadEncryptionKey())).toBe('key-1234');
  });

  it('rejects non-Dalux URLs and keys Dalux refuses, without saving', async () => {
    const add = (baseUrl: string, apiKey: string) => addConnection(db, admin, { name: 'X', slug: 'x', baseUrl, apiKey }, verify);
    await expect(add('https://evil.example.com', 'k')).rejects.toThrow('dalux.com');
    await expect(add('https://x.dalux.com', 'bad-key')).rejects.toThrow('did not accept');
    expect(await db.select().from(connections).where(eq(connections.slug, 'x'))).toHaveLength(0);
  });

  it('rotates the key after verifying the new one', async () => {
    await expect(rotateConnectionKey(db, admin, connectionId, 'bad-key', verify)).rejects.toThrow('did not accept');
    await rotateConnectionKey(db, admin, connectionId, 'key-5678', verify);
    const [row] = await db.select().from(connections).where(eq(connections.id, connectionId));
    expect(row.apiKeyLast4).toBe('5678');
    expect(decryptSecret(row.apiKeyEncrypted, loadEncryptionKey())).toBe('key-5678');
  });

  it('stores the embedding key encrypted and switches header mode', async () => {
    await setEmbeddingKey(db, admin, 'mistral-secret');
    await setHeaderMode(db, admin, true);
    const [row] = await db.select().from(settings);
    expect(decryptSecret(row.embeddingKeyEncrypted!, loadEncryptionKey())).toBe('mistral-secret');
    expect(row.headerModeEnabled).toBe(true);
    await setEmbeddingKey(db, admin, null);
    const [cleared] = await db.select().from(settings);
    expect(cleared.embeddingKeyEncrypted).toBeNull();
  });
});
