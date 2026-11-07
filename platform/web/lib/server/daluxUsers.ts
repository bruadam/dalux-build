import { and, asc, eq, sql } from 'drizzle-orm';
import { accounts, connections, daluxUserLinks, daluxUsers, type Db } from '@dalux-platform/db';
import { assertAdmin, audit, type Actor } from './actor';
import { UserError } from './errors';

/**
 * Dalux user links of one connection (PRD 6.8). The worker copies the
 * connection's Dalux users and links personal accounts by email; an admin
 * links the rest by hand. Manual links are never changed by the worker.
 */
export async function daluxUserLinksFor(db: Db, connectionId: string) {
  const [connection] = await db
    .select({
      id: connections.id,
      name: connections.name,
      syncedAt: connections.daluxUsersSyncedAt,
      requestedAt: connections.daluxUsersRequestedAt,
      syncError: connections.daluxUsersSyncError,
    })
    .from(connections)
    .where(eq(connections.id, connectionId));
  if (!connection) return undefined;
  const [rows, users] = await Promise.all([
    db
      .select({
        accountId: accounts.id,
        name: accounts.name,
        email: accounts.email,
        type: accounts.type,
        daluxUserId: daluxUserLinks.daluxUserId,
        source: daluxUserLinks.source,
        daluxEmail: daluxUsers.email,
        daluxName: daluxUsers.name,
      })
      .from(accounts)
      .leftJoin(daluxUserLinks, and(eq(daluxUserLinks.accountId, accounts.id), eq(daluxUserLinks.connectionId, connectionId)))
      .leftJoin(daluxUsers, and(eq(daluxUsers.connectionId, connectionId), eq(daluxUsers.daluxUserId, daluxUserLinks.daluxUserId)))
      .orderBy(accounts.type, asc(accounts.name)),
    db
      .select({ daluxUserId: daluxUsers.daluxUserId, email: daluxUsers.email, name: daluxUsers.name })
      .from(daluxUsers)
      .where(eq(daluxUsers.connectionId, connectionId))
      .orderBy(sql`lower(${daluxUsers.email})`),
  ]);
  return { connection, accounts: rows, daluxUsers: users };
}

/** Links an account (personal or robot) to a Dalux user by hand; automatic matching then leaves it alone. */
export async function linkDaluxUser(db: Db, actor: Actor, input: { accountId: string; connectionId: string; daluxUserId: string }): Promise<void> {
  assertAdmin(actor);
  const daluxUserId = input.daluxUserId.trim();
  if (!daluxUserId) throw new UserError('Choose a Dalux user');
  const [known] = await db
    .select({ id: daluxUsers.daluxUserId })
    .from(daluxUsers)
    .where(and(eq(daluxUsers.connectionId, input.connectionId), eq(daluxUsers.daluxUserId, daluxUserId)));
  if (!known) throw new UserError('That Dalux user is not on this connection');
  await db.transaction(async (tx) => {
    const set = { daluxUserId, source: 'manual' as const, updatedAt: new Date() };
    await tx
      .insert(daluxUserLinks)
      .values({ accountId: input.accountId, connectionId: input.connectionId, ...set })
      .onConflictDoUpdate({ target: [daluxUserLinks.accountId, daluxUserLinks.connectionId], set });
    await audit(tx, actor, 'dalux_user_link.set', 'account', input.accountId);
  });
}

/** Removes a link; for a personal account the worker may link it again by email. */
export async function unlinkDaluxUser(db: Db, actor: Actor, input: { accountId: string; connectionId: string }): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    await tx
      .delete(daluxUserLinks)
      .where(and(eq(daluxUserLinks.accountId, input.accountId), eq(daluxUserLinks.connectionId, input.connectionId)));
    await audit(tx, actor, 'dalux_user_link.clear', 'account', input.accountId);
  });
}

/** "Match now": the worker reloads the connection's Dalux users and matches within a minute. */
export async function requestDaluxUserMatch(db: Db, actor: Actor, connectionId: string): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    await tx.update(connections).set({ daluxUsersRequestedAt: new Date() }).where(eq(connections.id, connectionId));
    await audit(tx, actor, 'dalux_users.match', 'connection', connectionId);
  });
}
