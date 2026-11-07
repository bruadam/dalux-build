import { and, eq, gt, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { accountInvites, accounts, auditLog, authUsers, hashApiToken, type Db } from '@dalux-platform/db';
import { normalizeEmail } from './accounts';
import { refreshAccess } from './actor';
import { UserError } from './errors';

/** Creates the login (Better Auth user) for an email; the user hook links it to the account. */
export type CreateLogin = (input: { email: string; password: string; name: string }) => Promise<void>;

export async function isEmptyInstall(db: Db): Promise<boolean> {
  const [row] = await db.select({ id: accounts.id }).from(accounts).limit(1);
  return !row;
}

/** The invited account behind a valid, unused invite token. */
export async function findInvite(db: Db, inviteToken: string) {
  const [row] = await db
    .select({ inviteId: accountInvites.id, accountId: accounts.id, email: accounts.email, name: accounts.name })
    .from(accountInvites)
    .innerJoin(accounts, eq(accounts.id, accountInvites.accountId))
    .where(
      and(
        eq(accountInvites.tokenHash, hashApiToken(inviteToken)),
        isNull(accountInvites.usedAt),
        gt(accountInvites.expiresAt, new Date()),
        eq(accounts.status, 'invited'),
      ),
    );
  return row;
}

/**
 * Called by Better Auth before it inserts a user: returns the personal account
 * the new login belongs to. Only `signUp` below creates logins, after it has
 * checked the invite or created the first admin.
 */
export async function accountForNewLogin(db: Db, email: string): Promise<string> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        sql`lower(${accounts.email}) = ${normalizeEmail(email)}`,
        eq(accounts.type, 'personal'),
        inArray(accounts.status, ['invited', 'active']),
        notExists(db.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.platformAccountId, accounts.id))),
      ),
    );
  if (!row) throw new UserError('Sign-up needs an invite link');
  return row.id;
}

/**
 * First sign-up on an empty install creates the admin; afterwards only an
 * invite link can create a login, for the email the admin invited.
 */
export async function signUp(
  db: Db,
  createLogin: CreateLogin,
  input: { email: string; password: string; name: string; inviteToken?: string },
): Promise<string> {
  if (input.inviteToken) {
    const invite = await findInvite(db, input.inviteToken);
    if (!invite?.email) throw new UserError('This invite link is invalid or has expired');
    await createLogin({ email: invite.email, password: input.password, name: input.name.trim() || invite.name });
    await db.transaction(async (tx) => {
      await tx.update(accountInvites).set({ usedAt: new Date() }).where(eq(accountInvites.id, invite.inviteId));
      await tx.update(accounts).set({ status: 'active', updatedAt: new Date() }).where(eq(accounts.id, invite.accountId));
      await tx.insert(auditLog).values({ kind: 'admin', accountId: invite.accountId, action: 'account.signup', targetType: 'account', targetId: invite.accountId });
      await refreshAccess(tx);
    });
    return invite.accountId;
  }

  const email = normalizeEmail(input.email);
  const accountId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_admins'))`);
    const [existing] = await tx.select({ id: accounts.id }).from(accounts).limit(1);
    if (existing) throw new UserError('Sign-up needs an invite link');
    const [row] = await tx
      .insert(accounts)
      .values({ type: 'personal', email, name: input.name.trim() || email, role: 'admin', status: 'active' })
      .returning({ id: accounts.id });
    await tx.insert(auditLog).values({ kind: 'admin', accountId: row.id, action: 'account.first_admin', targetType: 'account', targetId: row.id });
    return row.id;
  });
  try {
    await createLogin({ email, password: input.password, name: input.name.trim() || email });
  } catch (error) {
    await db.delete(accounts).where(eq(accounts.id, accountId));
    throw error;
  }
  return accountId;
}
