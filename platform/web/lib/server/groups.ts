import { and, asc, eq } from 'drizzle-orm';
import { accounts, groupMemberships, groups, type Db } from '@dalux-platform/db';
import { assertAdmin, audit, refreshAccess, type Actor } from './actor';
import { UserError } from './errors';

export async function listGroups(db: Db) {
  const [rows, members] = await Promise.all([
    db.select().from(groups).orderBy(asc(groups.name)),
    db
      .select({ groupId: groupMemberships.groupId, accountId: accounts.id, name: accounts.name, type: accounts.type })
      .from(groupMemberships)
      .innerJoin(accounts, eq(accounts.id, groupMemberships.accountId))
      .orderBy(asc(accounts.name)),
  ]);
  return rows.map((group) => ({ ...group, members: members.filter((m) => m.groupId === group.id) }));
}

export async function createGroup(db: Db, actor: Actor, input: { name: string; description?: string }): Promise<string> {
  assertAdmin(actor);
  const name = input.name.trim();
  if (!name) throw new UserError('Enter a name');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(groups)
      .values({ name, description: input.description?.trim() || null })
      .returning({ id: groups.id });
    await audit(tx, actor, 'group.create', 'group', row.id);
    return row.id;
  });
}

export async function deleteGroup(db: Db, actor: Actor, groupId: string): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    await tx.delete(groups).where(eq(groups.id, groupId));
    await audit(tx, actor, 'group.delete', 'group', groupId);
    await refreshAccess(tx);
  });
}

export async function addMember(db: Db, actor: Actor, groupId: string, accountId: string): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    await tx.insert(groupMemberships).values({ groupId, accountId }).onConflictDoNothing();
    await audit(tx, actor, 'group.member.add', 'group', groupId);
    await refreshAccess(tx);
  });
}

export async function removeMember(db: Db, actor: Actor, groupId: string, accountId: string): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    await tx
      .delete(groupMemberships)
      .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.accountId, accountId)));
    await audit(tx, actor, 'group.member.remove', 'group', groupId);
    await refreshAccess(tx);
  });
}
