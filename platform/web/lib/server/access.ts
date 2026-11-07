import { asc, eq } from 'drizzle-orm';
import { connections, effectiveAccess, grants, groups, type Db } from '@dalux-platform/db';

/** What an account can do where, and which grant (direct or via a group) gives it. */
export function effectiveAccessFor(db: Db, accountId: string) {
  return db
    .select({
      connectionName: connections.name,
      capability: effectiveAccess.capability,
      projectId: effectiveAccess.projectId,
      fileAreaId: effectiveAccess.fileAreaId,
      folderId: effectiveAccess.folderId,
      grantId: effectiveAccess.grantId,
      viaGroup: groups.name,
    })
    .from(effectiveAccess)
    .innerJoin(connections, eq(connections.id, effectiveAccess.connectionId))
    .innerJoin(grants, eq(grants.id, effectiveAccess.grantId))
    .leftJoin(groups, eq(groups.id, grants.groupId))
    .where(eq(effectiveAccess.accountId, accountId))
    .orderBy(
      asc(connections.name),
      asc(effectiveAccess.projectId),
      asc(effectiveAccess.fileAreaId),
      asc(effectiveAccess.folderId),
      asc(effectiveAccess.capability),
    );
}
