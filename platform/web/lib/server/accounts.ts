import { randomBytes } from 'node:crypto';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { accountInvites, accounts, authSessions, authUsers, hashApiToken, type Db } from '@dalux-platform/db';
import { assertAdmin, audit, refreshAccess, type Actor, type DbOrTx } from './actor';
import { UserError } from './errors';

const INVITE_DAYS = 7;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function listAccounts(db: Db) {
  const owner = alias(accounts, 'owner');
  return db
    .select({
      id: accounts.id,
      type: accounts.type,
      name: accounts.name,
      email: accounts.email,
      description: accounts.description,
      role: accounts.role,
      status: accounts.status,
      ownerAccountId: accounts.ownerAccountId,
      ownerName: owner.name,
      ownerStatus: owner.status,
    })
    .from(accounts)
    .leftJoin(owner, eq(owner.id, accounts.ownerAccountId))
    .orderBy(asc(accounts.type), asc(accounts.name));
}

async function issueInvite(tx: DbOrTx, actor: Actor, accountId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await tx.insert(accountInvites).values({
    accountId,
    tokenHash: hashApiToken(token),
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    createdByAccountId: actor.accountId,
  });
  return token;
}

/** Creates an invited personal account; returns the invite token for the link (shown once). */
export async function inviteAccount(
  db: Db,
  actor: Actor,
  input: { email: string; name: string; role: 'admin' | 'user' },
): Promise<{ accountId: string; inviteToken: string }> {
  assertAdmin(actor);
  const email = normalizeEmail(input.email);
  if (!email.includes('@')) throw new UserError('Enter a valid email');
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: accounts.id }).from(accounts).where(sql`lower(${accounts.email}) = ${email}`);
    if (existing) throw new UserError('An account with this email already exists');
    const [row] = await tx
      .insert(accounts)
      .values({ type: 'personal', email, name: input.name.trim() || email, role: input.role, status: 'invited' })
      .returning({ id: accounts.id });
    const inviteToken = await issueInvite(tx, actor, row.id);
    await audit(tx, actor, 'account.invite', 'account', row.id);
    return { accountId: row.id, inviteToken };
  });
}

/** A new invite link for an account that has not signed up yet. */
export async function reissueInvite(db: Db, actor: Actor, accountId: string): Promise<string> {
  assertAdmin(actor);
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
    if (account?.status !== 'invited') throw new UserError('Only invited accounts get a new link');
    const token = await issueInvite(tx, actor, accountId);
    await audit(tx, actor, 'account.reinvite', 'account', accountId);
    return token;
  });
}

/** Fails if the change would leave no active admin. Serialized by an advisory lock. */
async function assertAnotherActiveAdmin(tx: DbOrTx, accountId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_admins'))`);
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(and(eq(accounts.role, 'admin'), eq(accounts.status, 'active'), ne(accounts.id, accountId)));
  if (count === 0) throw new UserError('There must always be at least one active admin');
}

export async function setAccountStatus(db: Db, actor: Actor, accountId: string, status: 'active' | 'disabled'): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
    if (!account) throw new UserError('Account not found');
    if (account.status === 'invited') throw new UserError('This account has not accepted its invite yet');
    if (status === 'disabled' && account.role === 'admin') await assertAnotherActiveAdmin(tx, accountId);
    await tx.update(accounts).set({ status, updatedAt: new Date() }).where(eq(accounts.id, accountId));
    if (status === 'disabled') {
      const users = tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.platformAccountId, accountId));
      await tx.delete(authSessions).where(sql`${authSessions.userId} in ${users}`);
    }
    await audit(tx, actor, status === 'disabled' ? 'account.disable' : 'account.enable', 'account', accountId);
    await refreshAccess(tx);
  });
}

export async function setAccountRole(db: Db, actor: Actor, accountId: string, role: 'admin' | 'user'): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
    if (account?.type !== 'personal') throw new UserError('Only personal accounts have a role');
    if (role === 'user' && account.role === 'admin') await assertAnotherActiveAdmin(tx, accountId);
    await tx.update(accounts).set({ role, updatedAt: new Date() }).where(eq(accounts.id, accountId));
    await audit(tx, actor, `account.role.${role}`, 'account', accountId);
  });
}
