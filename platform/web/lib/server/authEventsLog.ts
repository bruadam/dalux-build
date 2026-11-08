import { desc, eq } from 'drizzle-orm';
import { accounts, authEvents, withAccount, type Db } from '@dalux-platform/db';
import type { Actor } from './actor';

const LIMIT = 50;

/**
 * The latest failed or unauthenticated attempts. Row-level security shows admins every event and everyone
 * else the events that name their own account; `own` narrows an admin to their own too.
 */
export function listAuthEvents(db: Db, actor: Actor, own = false) {
  return withAccount(db, actor.accountId, (tx) =>
    tx
      .select({
        id: authEvents.id,
        at: authEvents.at,
        source: authEvents.source,
        reason: authEvents.reason,
        accountName: accounts.name,
        tokenPrefix: authEvents.tokenPrefix,
        connectionSlug: authEvents.connectionSlug,
        clientIp: authEvents.clientIp,
        userAgent: authEvents.userAgent,
        requestId: authEvents.requestId,
      })
      .from(authEvents)
      .leftJoin(accounts, eq(accounts.id, authEvents.accountId))
      .where(own ? eq(authEvents.accountId, actor.accountId) : undefined)
      .orderBy(desc(authEvents.at), desc(authEvents.id))
      .limit(LIMIT),
  );
}

export type AuthEventRow = Awaited<ReturnType<typeof listAuthEvents>>[number];
