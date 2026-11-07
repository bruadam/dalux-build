import { desc, eq } from 'drizzle-orm';
import { accounts, connections, grants, groups, type Db } from '@dalux-platform/db';
import { isCapability, PRESETS, type Preset } from '../capabilities';
import { assertAdmin, audit, refreshAccess, type Actor } from './actor';
import { UserError } from './errors';

export interface GrantInput {
  accountId?: string;
  groupId?: string;
  connectionId: string;
  projectId?: string;
  fileAreaId?: string;
  folderId?: string;
  preset?: Preset;
  capabilities?: string[];
}

const blankToNull = (value: string | undefined) => value?.trim() || null;

/**
 * Validates a grant and expands its preset. File area and folder scopes only
 * carry `files:*` capabilities, so a preset on such a scope keeps only those.
 */
export function resolveGrant(input: GrantInput) {
  const accountId = blankToNull(input.accountId);
  const groupId = blankToNull(input.groupId);
  if ((accountId === null) === (groupId === null)) throw new UserError('Choose exactly one account or group');

  const projectId = blankToNull(input.projectId);
  const fileAreaId = blankToNull(input.fileAreaId);
  const folderId = blankToNull(input.folderId);
  if (fileAreaId && !projectId) throw new UserError('A file area scope needs a project');
  if (folderId && !fileAreaId) throw new UserError('A folder scope needs a file area');

  const explicit = input.capabilities ?? [];
  const unknown = explicit.filter((capability) => !isCapability(capability));
  if (unknown.length) throw new UserError(`Unknown capabilities: ${unknown.join(', ')}`);

  const fileScope = fileAreaId !== null;
  if (fileScope && explicit.some((capability) => !capability.startsWith('files:'))) {
    throw new UserError('File area and folder scopes only take files:* capabilities');
  }
  const fromPreset = input.preset ? PRESETS[input.preset].filter((c) => !fileScope || c.startsWith('files:')) : [];
  const capabilities = [...new Set([...fromPreset, ...explicit])].sort();
  if (!capabilities.length) throw new UserError('Choose a preset or at least one capability');

  return { accountId, groupId, connectionId: input.connectionId, projectId, fileAreaId, folderId, capabilities };
}

export async function createGrant(db: Db, actor: Actor, input: GrantInput): Promise<string> {
  assertAdmin(actor);
  const values = resolveGrant(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(grants)
      .values({ ...values, createdByAccountId: actor.accountId })
      .returning({ id: grants.id });
    await audit(tx, actor, 'grant.create', 'grant', row.id);
    await refreshAccess(tx);
    return row.id;
  });
}

export async function deleteGrant(db: Db, actor: Actor, grantId: string): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    await tx.delete(grants).where(eq(grants.id, grantId));
    await audit(tx, actor, 'grant.delete', 'grant', grantId);
    await refreshAccess(tx);
  });
}

export function listGrants(db: Db) {
  return db
    .select({
      id: grants.id,
      accountName: accounts.name,
      groupName: groups.name,
      connectionName: connections.name,
      projectId: grants.projectId,
      fileAreaId: grants.fileAreaId,
      folderId: grants.folderId,
      capabilities: grants.capabilities,
      createdAt: grants.createdAt,
    })
    .from(grants)
    .innerJoin(connections, eq(connections.id, grants.connectionId))
    .leftJoin(accounts, eq(accounts.id, grants.accountId))
    .leftJoin(groups, eq(groups.id, grants.groupId))
    .orderBy(desc(grants.createdAt));
}
