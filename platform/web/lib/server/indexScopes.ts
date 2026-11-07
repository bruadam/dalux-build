import { desc, eq } from 'drizzle-orm';
import { connections, indexRuns, indexScopes, type Db } from '@dalux-platform/db';
import { assertAdmin, audit, type Actor } from './actor';
import { UserError } from './errors';

export const INDEX_KINDS = ['file', 'task', 'docs'] as const;
export type IndexKind = (typeof INDEX_KINDS)[number];

/** Form fields of a scope; the ones that do not belong to the kind are ignored. */
export interface ScopeInput {
  projectId?: string;
  fileAreaId?: string;
  folderId?: string;
  folderPath?: string;
  recursive?: boolean;
  extensions?: string;
  includeDrawings?: boolean;
  typeId?: string;
  filter?: string;
  owner?: string;
  repo?: string;
  ref?: string;
  path?: string;
}

/**
 * The scope JSON the worker passes to the builders: the same arguments as
 * `build_file_area_index`, `build_task_index`, and the docs index build.
 */
export function scopeFor(kind: IndexKind, input: ScopeInput): Record<string, unknown> {
  const clean = (value?: string) => value?.trim() || undefined;
  const required = (value: string | undefined, label: string) => {
    if (!clean(value)) throw new UserError(`Enter the ${label}`);
    return clean(value);
  };
  const scope =
    kind === 'file'
      ? {
          projectId: required(input.projectId, 'project ID'),
          fileAreaId: required(input.fileAreaId, 'file area ID'),
          folderId: clean(input.folderId),
          folderPath: clean(input.folderPath),
          recursive: input.recursive ?? true,
          extensions: clean(input.extensions)?.split(/[\s,]+/).filter(Boolean),
          includeDrawings: input.includeDrawings ?? true,
        }
      : kind === 'task'
        ? { projectId: required(input.projectId, 'project ID'), typeId: clean(input.typeId), filter: clean(input.filter) }
        : { owner: required(input.owner, 'repository owner'), repo: required(input.repo, 'repository'), ref: clean(input.ref), path: clean(input.path) };
  if ('folderId' in scope && scope.folderId && scope.folderPath) throw new UserError('Enter either a folder ID or a folder path, not both');
  return Object.fromEntries(Object.entries(scope).filter(([, value]) => value !== undefined));
}

function checkedInterval(hours: number): number {
  if (!Number.isFinite(hours) || hours < 0.25) throw new UserError('The schedule must be at least every 15 minutes (0.25 hours)');
  return Math.round(hours * 60);
}

function selectScopes(db: Db) {
  return db
    .select({
      id: indexScopes.id,
      name: indexScopes.name,
      kind: indexScopes.kind,
      scope: indexScopes.scope,
      intervalMinutes: indexScopes.intervalMinutes,
      enabled: indexScopes.enabled,
      refreshRequestedAt: indexScopes.refreshRequestedAt,
      lastRunAt: indexScopes.lastRunAt,
      lastRunStatus: indexScopes.lastRunStatus,
      connectionId: indexScopes.connectionId,
      connectionName: connections.name,
    })
    .from(indexScopes)
    .innerJoin(connections, eq(connections.id, indexScopes.connectionId));
}

export function listIndexScopes(db: Db) {
  return selectScopes(db).orderBy(connections.name, indexScopes.name);
}

export async function getIndexScope(db: Db, id: string) {
  const [row] = await selectScopes(db).where(eq(indexScopes.id, id));
  return row;
}

/** Newest first. Skipped and failed hold `{ fileName, reason }`-like objects from the builders. */
export function listIndexRuns(db: Db, scopeId: string, limit = 20) {
  return db.select().from(indexRuns).where(eq(indexRuns.scopeId, scopeId)).orderBy(desc(indexRuns.startedAt)).limit(limit);
}

export async function createIndexScope(
  db: Db,
  actor: Actor,
  input: { connectionId: string; kind: string; name: string; intervalHours: number; scope: ScopeInput },
): Promise<string> {
  assertAdmin(actor);
  const kind = INDEX_KINDS.find((k) => k === input.kind);
  if (!kind) throw new UserError('Choose files, tasks, or docs');
  const name = input.name.trim();
  if (!name) throw new UserError('Enter a name');
  const values = { connectionId: input.connectionId, kind, name, scope: scopeFor(kind, input.scope), intervalMinutes: checkedInterval(input.intervalHours) };
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(indexScopes).values(values).returning({ id: indexScopes.id });
    await audit(tx, actor, 'index_scope.create', 'index_scope', row.id);
    return row.id;
  });
}

async function changeScope(db: Db, actor: Actor, id: string, action: string, values: Partial<typeof indexScopes.$inferInsert>) {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    const changed = await tx
      .update(indexScopes)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(indexScopes.id, id))
      .returning({ id: indexScopes.id });
    if (!changed.length) throw new UserError('Index scope not found');
    await audit(tx, actor, action, 'index_scope', id);
  });
}

export function updateIndexScope(db: Db, actor: Actor, id: string, input: { enabled: boolean; intervalHours: number }) {
  return changeScope(db, actor, id, 'index_scope.update', { enabled: input.enabled, intervalMinutes: checkedInterval(input.intervalHours) });
}

/** "Refresh now": the worker picks it up within a minute, even when the schedule is off. */
export function requestIndexRefresh(db: Db, actor: Actor, id: string) {
  return changeScope(db, actor, id, 'index_scope.refresh', { refreshRequestedAt: new Date() });
}

/** Removes the definition and its run history; the built index stays until dropped with the admin MCP tools. */
export async function deleteIndexScope(db: Db, actor: Actor, id: string): Promise<void> {
  assertAdmin(actor);
  await db.transaction(async (tx) => {
    await tx.delete(indexScopes).where(eq(indexScopes.id, id));
    await audit(tx, actor, 'index_scope.delete', 'index_scope', id);
  });
}
