import { sql } from 'drizzle-orm';
import { auditLog, type Db, type Tx } from '@dalux-platform/db';
import { UserError } from './errors';

/** The signed-in account performing a change, loaded fresh for every request. */
export interface Actor {
  accountId: string;
  role: 'admin' | 'user';
  name: string;
  email: string | null;
}

export type DbOrTx = Db | Tx;

export function assertAdmin(actor: Actor): void {
  if (actor.role !== 'admin') throw new UserError('Only admins can do this');
}

export async function audit(tx: DbOrTx, actor: Actor, action: string, targetType: string, targetId: string): Promise<void> {
  await tx.insert(auditLog).values({ kind: 'admin', accountId: actor.accountId, action, targetType, targetId });
}

/** Rebuilds effective_access; call after any change to grants, groups, memberships, or account status. */
export async function refreshAccess(tx: DbOrTx): Promise<void> {
  await tx.execute(sql`select refresh_effective_access()`);
}
