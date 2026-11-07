/**
 * Index scopes (PRD 6.3): admins define them in the interface; the worker
 * builds and refreshes them with the same incremental builders the MCP tools
 * use, on the Postgres store, and records one `index_runs` row per run.
 */

import { eq, sql } from 'drizzle-orm';
import type { DaluxClient } from 'dalux-build-api';
import { indexRuns, indexScopes, type Db } from '@dalux-platform/db';
import { runWithContext } from '../access/requestScope';
import { buildIndex } from '../rag/build';
import { buildDocsIndex } from '../rag/docsBuild';
import type { DocsRepoScope } from '../rag/docsSource';
import { resolveScope, type ScopeArgs } from '../rag/scope';
import { buildTaskIndex } from '../rag/taskBuild';
import { EMBEDDING_MODEL, withEmbeddingKey } from '../search/rank';

export interface WorkerDeps {
  /** Connected as the `worker` database role. */
  db: Db;
  clientFor(connectionId: string): Promise<DaluxClient>;
  /** The admin's embedding key from the settings; null means lexical indexes only. */
  embeddingKey(): Promise<string | null>;
  /** GitHub token for private docs repos. */
  docsToken?: string | null;
}

export type RunTrigger = 'schedule' | 'manual';

/** File and docs builds work in time-budgeted passes; a run takes passes until the scope is complete. */
const PASS_SECONDS = 600;
const MAX_PASSES = 12;

interface RunSummary {
  indexExternalId: string;
  mode: 'embeddings' | 'lexical';
  itemsInScope: number;
  itemsIndexed: number;
  itemsReused: number;
  itemsRemoved: number;
  itemsPending: number;
  totalChunks: number;
  skipped: unknown[];
  failed: unknown[];
  warnings: string[];
}

/** The reason to show in the interface; for a failed query that is the database's error, not the SQL. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? error.cause.message : error.message;
}

/** Scopes to run now: a "Refresh now" newer than the last run, or an enabled scope whose interval has passed. */
export async function dueScopes(db: Db): Promise<{ id: string; trigger: RunTrigger }[]> {
  const { rows } = await db.execute<{ id: string; manual: boolean }>(sql`
    select id, refresh_requested_at > coalesce(last_run_at, '-infinity') as manual
    from index_scopes
    where refresh_requested_at > coalesce(last_run_at, '-infinity')
       or (enabled and (last_run_at is null or last_run_at + interval_minutes * interval '1 minute' <= now()))
    order by last_run_at nulls first`);
  return rows.map((row) => ({ id: row.id, trigger: row.manual ? 'manual' : 'schedule' }));
}

/**
 * Marks runs left "running" by a stopped worker as failed. Called at worker
 * start; compose runs a single worker, so no other run can be in progress.
 */
export async function failInterruptedRuns(db: Db): Promise<void> {
  await db.execute(sql`
    update index_runs set status = 'failed', finished_at = now(), error = 'The worker stopped during the run.'
    where status = 'running'`);
  await db.execute(sql`update index_scopes set last_run_status = 'failed' where last_run_status = 'running'`);
}

async function passes<R extends { complete: boolean }>(
  build: () => Promise<R>,
  progress: (report: R) => number,
): Promise<R[]> {
  const reports: R[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const report = await build();
    reports.push(report);
    if (report.complete || progress(report) === 0) break;
  }
  return reports;
}

function unique(warnings: string[][]): string[] {
  return [...new Set(warnings.flat())];
}

async function buildScope(
  client: DaluxClient,
  kind: 'file' | 'task' | 'docs',
  scope: Record<string, unknown>,
  docsToken: string | null,
): Promise<RunSummary> {
  if (kind === 'file') {
    const resolved = await resolveScope(client, scope as unknown as ScopeArgs);
    const reports = await passes(
      () => buildIndex(client, resolved, { timeBudgetSeconds: PASS_SECONDS, maxFiles: 1000 }),
      (report) => report.filesIndexedThisPass,
    );
    const last = reports[reports.length - 1];
    return {
      indexExternalId: last.indexId,
      mode: last.mode,
      itemsInScope: last.filesInScope,
      itemsIndexed: reports.reduce((total, report) => total + report.filesIndexedThisPass, 0),
      itemsReused: reports[0].filesReused,
      itemsRemoved: reports.reduce((total, report) => total + report.filesRemoved, 0),
      itemsPending: last.filesPending,
      totalChunks: last.totalChunks,
      skipped: last.skipped,
      failed: last.failed,
      warnings: unique(reports.map((report) => report.warnings)),
    };
  }
  if (kind === 'task') {
    const report = await buildTaskIndex(client, {
      projectId: String(scope.projectId),
      typeId: (scope.typeId as string | undefined) ?? null,
      filter: (scope.filter as string | undefined) ?? null,
    });
    return {
      indexExternalId: report.indexId,
      mode: report.mode,
      itemsInScope: report.taskCount,
      itemsIndexed: report.tasksIndexed,
      itemsReused: report.tasksReused,
      itemsRemoved: report.tasksRemoved,
      itemsPending: 0,
      totalChunks: report.totalChunks,
      skipped: [],
      failed: [],
      warnings: report.warnings,
    };
  }
  const docsScope: DocsRepoScope = {
    owner: String(scope.owner),
    repo: String(scope.repo),
    ref: (scope.ref as string | undefined) ?? 'main',
    path: (scope.path as string | undefined) ?? 'docs',
  };
  const reports = await passes(
    () => buildDocsIndex(docsScope, docsToken, { timeBudgetSeconds: PASS_SECONDS, maxDocs: 1000 }),
    (report) => report.docsIndexedThisPass,
  );
  const last = reports[reports.length - 1];
  return {
    indexExternalId: last.indexId,
    mode: last.mode,
    itemsInScope: last.docsInScope,
    itemsIndexed: reports.reduce((total, report) => total + report.docsIndexedThisPass, 0),
    itemsReused: reports[0].docsReused,
    itemsRemoved: reports.reduce((total, report) => total + report.docsRemoved, 0),
    itemsPending: last.docsPending,
    totalChunks: last.totalChunks,
    skipped: [],
    failed: last.failed,
    warnings: unique(reports.map((report) => report.warnings)),
  };
}

/** Builds or refreshes one scope and records the run. Returns the run id. */
export async function runScope(deps: WorkerDeps, scopeId: string, trigger: RunTrigger): Promise<string> {
  const { db } = deps;
  const [scope] = await db
    .update(indexScopes)
    .set({ lastRunAt: new Date(), lastRunStatus: 'running' })
    .where(eq(indexScopes.id, scopeId))
    .returning();
  if (!scope) throw new Error(`Index scope ${scopeId} not found`);
  const [run] = await db.insert(indexRuns).values({ scopeId, trigger }).returning({ id: indexRuns.id, startedAt: indexRuns.startedAt });

  let values: Partial<typeof indexRuns.$inferInsert>;
  try {
    const [client, apiKey] = await Promise.all([deps.clientFor(scope.connectionId), deps.embeddingKey()]);
    const context = { access: 'unrestricted' as const, connection: { id: scope.connectionId } };
    const { result, usage } = await withEmbeddingKey(apiKey, () =>
      runWithContext(context, () => buildScope(client, scope.kind, scope.scope as Record<string, unknown>, deps.docsToken ?? null)),
    );
    const { mode, ...summary } = result;
    values = {
      ...summary,
      status: summary.failed.length || summary.itemsPending ? 'partial' : 'ok',
      embeddingModel: mode === 'embeddings' ? EMBEDDING_MODEL : null,
      embeddingTokens: mode === 'embeddings' ? usage.tokens : null,
      embeddingTokensEstimated: usage.estimated,
    };
  } catch (error) {
    values = { status: 'failed', error: errorMessage(error) };
  }

  const finishedAt = new Date();
  await db
    .update(indexRuns)
    .set({ ...values, finishedAt, durationMs: finishedAt.getTime() - run.startedAt.getTime() })
    .where(eq(indexRuns.id, run.id));
  await db.update(indexScopes).set({ lastRunStatus: values.status }).where(eq(indexScopes.id, scopeId));
  return run.id;
}
