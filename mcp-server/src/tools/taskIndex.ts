/**
 * Cross-task search: a temporary RAG index over a project's tasks and their
 * change history, combined.
 *
 * `build_task_index` renders every task (subject, type, status, custom
 * fields) plus its change history into one document per task and embeds them
 * into a disposable index in the OS temp directory; `search_task_index` then
 * answers "which tasks mention X" — including in a comment left on a status
 * change, not just the task's current fields — across all of them at once.
 * For a one-off question that does not warrant building an index, see
 * search_tasks in tools/tasks.ts instead.
 */

import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { buildTaskIndex as runBuildTaskIndex, taskIndexIdFor } from '../rag/taskBuild';
import { searchTaskIndex as runSearchTaskIndex } from '../rag/taskSearch';
import { indexStores } from '../store';
import type { TaskIndexScope } from '../store/types';

const scopeShape = {
  projectId: z.string(),
  typeId: z
    .string()
    .optional().describe('Only tasks of this type. Ignored if filter is set.'),
  filter: z
    .string()
    .optional().describe('OData $filter (see list_project_tasks). Overrides typeId.'),
};

function scopeFrom(args: { projectId: string; typeId?: string; filter?: string }): TaskIndexScope {
  return { projectId: args.projectId, typeId: args.typeId ?? null, filter: args.filter ?? null };
}

// ---------- build_task_index ----------

export const buildTaskIndexInput = z.object({
  ...scopeShape,
  refresh: z.boolean().optional().describe('Rebuild everything.'),
});
export type BuildTaskIndexInput = z.infer<typeof buildTaskIndexInput>;

export async function buildTaskIndex(client: DaluxClient, args: BuildTaskIndexInput) {
  const report = await runBuildTaskIndex(client, scopeFrom(args), { refresh: args.refresh });
  return { ...report, nextStep: `Search it with search_task_index (indexId "${report.indexId}").` };
}

// ---------- search_task_index ----------

export const searchTaskIndexInput = z.object({
  query: z
    .string().describe('Natural-language query.'),
  indexId: z
    .string()
    .optional().describe('From build_task_index; or give the scope instead.'),
  projectId: z.string().optional().describe('Or address the index by scope.'),
  typeId: z.string().optional().describe('As at build time.'),
  filter: z.string().optional().describe('As at build time.'),
  topK: z.number().int().min(1).max(50).optional().describe('Max passages to return (default 10).'),
  perTaskLimit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .nullable()
    .optional()
    .describe('Max passages from any one task (default 3; null for no cap).'),
});
export type SearchTaskIndexInput = z.infer<typeof searchTaskIndexInput>;

export async function searchTaskIndex(_client: DaluxClient, args: SearchTaskIndexInput) {
  let indexId = args.indexId;
  if (!indexId) {
    if (!args.projectId) throw new Error('Pass either indexId, or projectId to address the index by scope.');
    indexId = taskIndexIdFor(scopeFrom({ projectId: args.projectId, typeId: args.typeId, filter: args.filter }));
  }

  const result = await runSearchTaskIndex(indexId, args.query, { topK: args.topK, perTaskLimit: args.perTaskLimit });
  const manifest = await indexStores().tasks.readManifest(indexId);

  return {
    ...result,
    matches: result.matches.map((match) => ({ ...match, score: Number(match.score.toFixed(4)) })),
    indexedTasks: manifest ? Object.keys(manifest.tasks).length : 0,
    indexUpdatedAt: manifest?.updatedAt,
  };
}

// ---------- list_task_indexes ----------

export const listTaskIndexesInput = z.object({});
export type ListTaskIndexesInput = z.infer<typeof listTaskIndexesInput>;

export async function listTaskIndexes() {
  return { indexes: await indexStores().tasks.listIndexes() };
}

// ---------- drop_task_index ----------

export const dropTaskIndexInput = z.object({
  indexId: z.string(),
});
export type DropTaskIndexInput = z.infer<typeof dropTaskIndexInput>;

export async function dropTaskIndex(_client: DaluxClient, args: DropTaskIndexInput) {
  const dropped = await indexStores().tasks.dropIndex(args.indexId);
  return {
    dropped,
    message: dropped
      ? `Deleted the local task index "${args.indexId}". Nothing in Dalux was changed.`
      : `No task index "${args.indexId}" on this server.`,
  };
}
