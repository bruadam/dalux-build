import { eq } from 'drizzle-orm';
import { accounts, auditLog, connections, withAccount, type Db } from '@dalux-platform/db';
import type { Actor } from './actor';

/** One audit row with everything recorded about it. Row-level security hides other people's rows from non-admins. */
export async function getActivityRow(db: Db, actor: Actor, id: number) {
  const [row] = await withAccount(db, actor.accountId, (tx) =>
    tx
      .select({
        row: auditLog,
        accountName: accounts.name,
        accountEmail: accounts.email,
        accountType: accounts.type,
        connectionName: connections.name,
      })
      .from(auditLog)
      .leftJoin(accounts, eq(accounts.id, auditLog.accountId))
      .leftJoin(connections, eq(connections.id, auditLog.connectionId))
      .where(eq(auditLog.id, id)),
  );
  return row;
}

export type ActivityRow = NonNullable<Awaited<ReturnType<typeof getActivityRow>>>;
