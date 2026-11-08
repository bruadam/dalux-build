import { and, asc, count, desc, eq, gte, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { withAccount, type Db, type Tx } from './db';
import { memoryEntries, memorySettings } from './schema';

/**
 * Per-person project memory (PRD 6.10). Every function runs in `withAccount`, so the row-level security
 * policies decide what the owner can see; the account in `MemoryScope` is only used to set that.
 */
export const MEMORY_KINDS = ['fact', 'decision', 'preference', 'open_question', 'summary'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_TEXT_MAX = 2000;
export const MEMORY_TAGS_MAX = 8;
/** Current entries per person and project; keeps the exact vector scan small. */
export const MEMORY_MAX_ENTRIES = 1000;

export interface MemoryCitation {
  fileId?: string;
  fileName?: string;
  fileAreaId?: string;
  location?: string;
  taskId?: string;
}

export interface MemoryScope {
  accountId: string;
  connectionId: string;
  projectId: string;
}

const entryColumns = {
  id: memoryEntries.id,
  kind: memoryEntries.kind,
  text: memoryEntries.text,
  citations: memoryEntries.citations,
  source: memoryEntries.source,
  tags: memoryEntries.tags,
  hasEmbedding: sql<boolean>`${memoryEntries.embedding} is not null`,
  createdAt: memoryEntries.createdAt,
  updatedAt: memoryEntries.updatedAt,
  supersededBy: memoryEntries.supersededBy,
};

export type MemoryEntry = Omit<typeof memoryEntries.$inferSelect, 'embedding' | 'tsv' | 'accountId' | 'connectionId' | 'projectId' | 'citations'> & {
  citations: MemoryCitation[];
  hasEmbedding: boolean;
};

export interface MemoryInput {
  kind: MemoryKind;
  text: string;
  citations?: MemoryCitation[];
  tags?: string[];
  source: string;
  /** Null or missing: the entry is found by full-text search only. */
  embedding?: readonly number[] | null;
}

export class MemoryError extends Error {}

const inScope = (scope: MemoryScope) =>
  and(
    eq(memoryEntries.accountId, scope.accountId),
    eq(memoryEntries.connectionId, scope.connectionId),
    eq(memoryEntries.projectId, scope.projectId),
  );

export const toVectorLiteral = (values: readonly number[]): string => `[${values.join(',')}]`;

export async function memoryEnabled(db: Db, scope: MemoryScope): Promise<boolean> {
  return withAccount(db, scope.accountId, async (tx) => {
    const [row] = await tx
      .select({ enabled: memorySettings.enabled })
      .from(memorySettings)
      .where(
        and(
          eq(memorySettings.accountId, scope.accountId),
          eq(memorySettings.connectionId, scope.connectionId),
          eq(memorySettings.projectId, scope.projectId),
        ),
      );
    return row?.enabled ?? false;
  });
}

export async function setMemoryEnabled(db: Db, scope: MemoryScope, enabled: boolean): Promise<void> {
  await withAccount(db, scope.accountId, (tx) =>
    tx
      .insert(memorySettings)
      .values({ ...scope, enabled })
      .onConflictDoUpdate({
        target: [memorySettings.accountId, memorySettings.connectionId, memorySettings.projectId],
        set: { enabled, updatedAt: new Date() },
      }),
  );
}

/** The projects the person has a switch for, with their number of current entries. Hidden rows (lost access) are not listed. */
export async function listMemoryProjects(db: Db, accountId: string) {
  return withAccount(db, accountId, async (tx) => {
    const settings = await tx
      .select({ connectionId: memorySettings.connectionId, projectId: memorySettings.projectId, enabled: memorySettings.enabled })
      .from(memorySettings);
    const counts = await tx
      .select({ connectionId: memoryEntries.connectionId, projectId: memoryEntries.projectId, entries: count() })
      .from(memoryEntries)
      .where(isNull(memoryEntries.supersededBy))
      .groupBy(memoryEntries.connectionId, memoryEntries.projectId);
    const key = (row: { connectionId: string; projectId: string }) => `${row.connectionId}/${row.projectId}`;
    const entries = new Map(counts.map((row) => [key(row), row.entries]));
    const rows = settings.map((row) => ({ ...row, entries: entries.get(key(row)) ?? 0 }));
    for (const row of counts) {
      if (!settings.some((s) => key(s) === key(row))) rows.push({ ...row, enabled: false, entries: row.entries });
    }
    return rows.sort((a, b) => key(a).localeCompare(key(b)));
  });
}

export interface MemoryFilter {
  kind?: MemoryKind;
  tag?: string;
  /** Only entries changed at or after this time. */
  since?: Date;
  ids?: string[];
  /** Plain substring match on the text, for the interface; hybrid search is in the MCP server. */
  contains?: string;
  includeSuperseded?: boolean;
  limit?: number;
  offset?: number;
}

export async function listMemory(
  db: Db,
  scope: MemoryScope,
  filter: MemoryFilter = {},
): Promise<{ total: number; entries: MemoryEntry[] }> {
  const conditions: (SQL | undefined)[] = [
    inScope(scope),
    filter.includeSuperseded ? undefined : isNull(memoryEntries.supersededBy),
    filter.kind ? eq(memoryEntries.kind, filter.kind) : undefined,
    filter.tag ? sql`${filter.tag} = any(${memoryEntries.tags})` : undefined,
    filter.since ? gte(memoryEntries.updatedAt, filter.since) : undefined,
    filter.ids ? inArray(memoryEntries.id, filter.ids) : undefined,
    filter.contains ? sql`position(lower(${filter.contains}) in lower(${memoryEntries.text})) > 0` : undefined,
  ];
  const where = and(...conditions);
  return withAccount(db, scope.accountId, async (tx) => {
    const [{ total }] = await tx.select({ total: count() }).from(memoryEntries).where(where);
    const entries = await tx
      .select(entryColumns)
      .from(memoryEntries)
      .where(where)
      .orderBy(desc(memoryEntries.updatedAt), asc(memoryEntries.id))
      .limit(filter.limit ?? 50)
      .offset(filter.offset ?? 0);
    return { total, entries: entries as MemoryEntry[] };
  });
}

async function lockScope(tx: Tx, scope: MemoryScope): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`memory/${scope.accountId}/${scope.connectionId}/${scope.projectId}`}))`,
  );
}

async function insertVersion(
  tx: Tx,
  scope: MemoryScope,
  previous: { id: string } | undefined,
  input: MemoryInput,
): Promise<MemoryEntry> {
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  const [created] = await tx
    .insert(memoryEntries)
    .values({
      ...scope,
      kind: input.kind,
      text: input.text,
      citations: input.citations ?? [],
      source: input.source,
      tags,
      embedding: input.embedding ? [...input.embedding] : null,
    })
    .returning(entryColumns);
  if (previous) await tx.update(memoryEntries).set({ supersededBy: created.id }).where(eq(memoryEntries.id, previous.id));
  return created as MemoryEntry;
}

/**
 * Adds an entry. A `summary` replaces the current summary as a new version, so there is one per project.
 * Fails when the project is at its limit of current entries.
 */
export async function addMemory(db: Db, scope: MemoryScope, input: MemoryInput): Promise<MemoryEntry> {
  return withAccount(db, scope.accountId, async (tx) => {
    await lockScope(tx, scope);
    const current = and(inScope(scope), isNull(memoryEntries.supersededBy));
    const [summary] =
      input.kind === 'summary'
        ? await tx.select({ id: memoryEntries.id }).from(memoryEntries).where(and(current, eq(memoryEntries.kind, 'summary')))
        : [];
    if (!summary) {
      const [{ total }] = await tx.select({ total: count() }).from(memoryEntries).where(current);
      if (total >= MEMORY_MAX_ENTRIES) {
        throw new MemoryError(`This project already has ${MEMORY_MAX_ENTRIES} memory entries. Update or forget some first.`);
      }
    }
    return insertVersion(tx, scope, summary, input);
  });
}

/** A new version of a current entry (kind stays); the old one is kept and points at it. Undefined when there is no such current entry. */
export async function reviseMemory(
  db: Db,
  scope: MemoryScope,
  id: string,
  changes: { text?: string; citations?: MemoryCitation[]; tags?: string[]; source: string; embedding?: readonly number[] | null },
): Promise<MemoryEntry | undefined> {
  return withAccount(db, scope.accountId, async (tx) => {
    await lockScope(tx, scope);
    const [old] = await tx
      .select()
      .from(memoryEntries)
      .where(and(inScope(scope), eq(memoryEntries.id, id), isNull(memoryEntries.supersededBy)));
    if (!old) return undefined;
    return insertVersion(tx, scope, old, {
      kind: old.kind,
      text: changes.text ?? old.text,
      citations: changes.citations ?? (old.citations as MemoryCitation[]),
      tags: changes.tags ?? old.tags,
      source: changes.source,
      embedding: changes.text === undefined ? (old.embedding as number[] | null) : changes.embedding,
    });
  });
}

/** Deletes a current entry and all its older versions. */
export async function forgetMemory(db: Db, scope: MemoryScope, id: string): Promise<boolean> {
  const deleted = await withAccount(db, scope.accountId, (tx) =>
    tx
      .delete(memoryEntries)
      .where(and(inScope(scope), eq(memoryEntries.id, id), isNull(memoryEntries.supersededBy)))
      .returning({ id: memoryEntries.id }),
  );
  return deleted.length > 0;
}

/** Deletes every entry, current and old, of one project. Returns how many current entries went. */
export async function forgetAllMemory(db: Db, scope: MemoryScope): Promise<number> {
  return withAccount(db, scope.accountId, async (tx) => {
    const deleted = await tx.delete(memoryEntries).where(inScope(scope)).returning({ superseded: memoryEntries.supersededBy });
    return deleted.filter((row) => row.superseded === null).length;
  });
}

/** Everything of one project, old versions included, oldest first. */
export async function exportMemory(db: Db, scope: MemoryScope): Promise<MemoryEntry[]> {
  const { entries } = await listMemory(db, scope, { includeSuperseded: true, limit: MEMORY_MAX_ENTRIES * 20 });
  return entries.reverse();
}
