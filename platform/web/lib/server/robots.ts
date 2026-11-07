import { and, eq } from 'drizzle-orm';
import { accounts, type Db } from '@dalux-platform/db';
import { assertAdmin, audit, type Actor, type DbOrTx } from './actor';
import { UserError } from './errors';

async function assertActivePersonal(tx: DbOrTx, accountId: string): Promise<void> {
  const [owner] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.type, 'personal'), eq(accounts.status, 'active')));
  if (!owner) throw new UserError('The owner must be an active personal account');
}

export async function createRobot(
  db: Db,
  actor: Actor,
  input: { name: string; description?: string; ownerAccountId: string },
): Promise<string> {
  assertAdmin(actor);
  const name = input.name.trim();
  if (!name) throw new UserError('Enter a name');
  return db.transaction(async (tx) => {
    await assertActivePersonal(tx, input.ownerAccountId);
    const [row] = await tx
      .insert(accounts)
      .values({ type: 'robot', name, description: input.description?.trim() || null, ownerAccountId: input.ownerAccountId })
      .returning({ id: accounts.id });
    await audit(tx, actor, 'robot.create', 'account', row.id);
    return row.id;
  });
}

export async function reassignRobotOwner(db: Db, actor: Actor, robotId: string, ownerAccountId: string): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    await assertActivePersonal(tx, ownerAccountId);
    const updated = await tx
      .update(accounts)
      .set({ ownerAccountId, updatedAt: new Date() })
      .where(and(eq(accounts.id, robotId), eq(accounts.type, 'robot')))
      .returning({ id: accounts.id });
    if (!updated.length) throw new UserError('Robot not found');
    await audit(tx, actor, 'robot.owner', 'account', robotId);
  });
}
