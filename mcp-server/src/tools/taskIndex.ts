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
import { dropIndex, listIndexes, readManifest, type TaskIndexScope } from '../rag/taskStore';

const scopeShape = {
  projectId: z.string().describe('The Dalux project ID.'),
  typeId: z
    .string()
    .optional()
    .describe('Restrict the index to tasks of this task type ID. Ignored if filter is also set.'),
  filter: z
    .string()
    .optional()
    .describe(
      'Raw OData $filter expression narrowing which tasks are indexed (same syntax as list_project_tasks). Takes precedence over typeId.',
    ),
};

function scopeFrom(args: { projectId: string; typeId?: string; filter?: string }): TaskIndexScope {
  return { projectId: args.projectId, typeId: args.typeId ?? null, filter: args.filter ?? null };
}

// ---------- build_task_index ----------

export const buildTaskIndexInput = z.object({
  ...scopeShape,
  refresh: z.boolean().optional().describe('Re-render and re-embed every task, ignoring cached revisions.'),
});
export type BuildTaskIndexInput = z.infer<typeof buildTaskIndexInput>;

export async function buildTaskIndex(client: DaluxClient, args: BuildTaskIndexInput) {
  const report = await runBuildTaskIndex(client, scopeFrom(args), { refresh: args.refresh });
  return { ...report, nextStep: `Search it with search_task_index (indexId "${report.indexId}").` };
}

// ---------- search_task_index ----------

export const searchTaskIndexInput = z.object({
  query: z
    .string()
    .describe('What to look for, in natural language — matched against task fields and change history together.'),
  indexId: z
    .string()
    .optional()
    .describe('Index to search, as returned by build_task_index. Omit to address it by scope instead.'),
  projectId: z.string().optional().describe('With no indexId: address the index by scope instead.'),
  typeId: z.string().optional().describe('Must match the value the index was built with.'),
  filter: z.string().optional().describe('Must match the value the index was built with.'),
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
  const manifest = readManifest(indexId);

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
  return { indexes: listIndexes() };
}

// ---------- drop_task_index ----------

export const dropTaskIndexInput = z.object({
  indexId: z.string().describe('The index to delete, as reported by list_task_indexes.'),
});
export type DropTaskIndexInput = z.infer<typeof dropTaskIndexInput>;

export async function dropTaskIndex(_client: DaluxClient, args: DropTaskIndexInput) {
  const dropped = dropIndex(args.indexId);
  return {
    dropped,
    message: dropped
      ? `Deleted the local task index "${args.indexId}". Nothing in Dalux was changed.`
      : `No task index "${args.indexId}" on this server.`,
  };
}
