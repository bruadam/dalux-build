import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { collectAllDaluxItems } from '../daluxPagination';
import type { TextChunk } from '../extract';
import { groupChangesByTaskId, renderTaskLines, str, unwrapTask } from '../rag/taskText';
import { searchChunks } from '../search/documentSearch';
import { fullListForLlm, type PaginatedForLlm } from '../serialize';

// ---------- list_project_tasks ----------

export const listProjectTasksInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  typeId: z
    .string()
    .optional()
    .describe(
      'Shorthand filter: only return tasks of this task type ID. Expands to an OData $filter on data/type/typeId. Ignored if filter is also set.',
    ),
  filter: z.string().optional().describe('Raw OData $filter expression. Takes precedence over typeId.'),
  select: z.string().optional().describe('OData $select expression to limit which fields are returned.'),
  orderby: z.string().optional().describe('OData $orderby expression.'),
});
export type ListProjectTasksInput = z.infer<typeof listProjectTasksInput>;

/**
 * Retrieves tasks, approvals, safety issues, safety observations and good
 * practices on a project.
 *
 * Uses Dalux-side bookmark pagination to completion via getAllProjectTasks,
 * so the MCP endpoint itself does not apply additional list pagination.
 *
 * The `filter`/`select`/`orderby` input properties are named without the `$`
 * that OData expects — a literal `$filter` property name fails Anthropic's
 * tool-schema validation (property names must match /^[a-zA-Z0-9_.-]{1,64}$/),
 * which silently drops the whole tool from the model's tool list. They're
 * translated back to `$filter`/`$select`/`$orderby` here before calling the
 * OData-speaking TasksApi.
 */
export async function listProjectTasks(
  client: DaluxClient,
  args: ListProjectTasksInput,
): Promise<PaginatedForLlm<unknown>> {
  const { projectId, filter, select, orderby, ...rest } = args;

  const params: Record<string, unknown> = { ...rest };
  if (filter !== undefined) params.$filter = filter;
  if (select !== undefined) params.$select = select;
  if (orderby !== undefined) params.$orderby = orderby;
  const items = await collectAllDaluxItems((pageParams) =>
    client.tasks.getProjectTasks(projectId, { ...params, ...pageParams }),
  );
  return fullListForLlm(items);
}

// ---------- search_tasks ----------

export const searchTasksInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  query: z
    .string()
    .describe(
      'Keywords or a natural-language description of what to find. Matched against each task\'s subject, ' +
        'description, custom fields, type, status and (optionally) change history — no OData syntax needed.',
    ),
  typeId: z
    .string()
    .optional()
    .describe('Only search tasks of this task type ID. Ignored if filter is also set.'),
  filter: z
    .string()
    .optional()
    .describe('Raw OData $filter expression narrowing which tasks are searched (same syntax as list_project_tasks).'),
  includeChanges: z
    .boolean()
    .optional()
    .describe(
      'Also match against each task\'s change history text (fetches every task change on the project — an extra ' +
        'API call). Default false. For repeated searches over the same project, build_task_index + ' +
        'search_task_index is cheaper.',
    ),
  topK: z.number().int().min(1).max(100).optional().describe('Max matching tasks to return (default 20).'),
});
export type SearchTasksInput = z.infer<typeof searchTasksInput>;

/**
 * Ranked keyword/semantic search across a project's tasks — the "find tasks
 * about X" complement to list_project_tasks' exact OData filtering. Ranks by
 * BM25, or by OpenAI embeddings when OPENAI_API_KEY is set (see search/rank.ts).
 *
 * Re-fetches and re-renders every task on each call, same trade-off as
 * search_file_content vs. build_file_area_index: cheap for one-off questions,
 * wasteful if called repeatedly against the same project — use
 * build_task_index + search_task_index for that.
 */
export async function searchTasks(client: DaluxClient, args: SearchTasksInput) {
  const { projectId, query, typeId, filter, includeChanges, topK } = args;

  const params: Record<string, unknown> = {};
  if (filter !== undefined) {
    params.$filter = filter;
  } else if (typeId !== undefined) {
    params.$filter = `data/type/typeId eq '${typeId.replace(/'/g, "''")}'`;
  }

  const rawTasks = await collectAllDaluxItems((pageParams) =>
    client.tasks.getProjectTasks(projectId, { ...params, ...pageParams }),
  );

  const changesByTaskId = includeChanges
    ? groupChangesByTaskId(
        (await collectAllDaluxItems((pageParams) =>
          client.tasks.getProjectTaskChanges(projectId, pageParams),
        )) as Record<string, unknown>[],
      )
    : new Map<string, Record<string, unknown>[]>();

  const byTaskId = new Map<string, { data: Record<string, unknown>; raw: unknown }>();
  const chunks: TextChunk[] = [];
  for (const raw of rawTasks) {
    const data = unwrapTask(raw);
    const taskId = data.taskId as string | undefined;
    if (!taskId) continue;
    byTaskId.set(taskId, { data, raw });
    chunks.push({
      page: null,
      location: taskId,
      text: renderTaskLines(data, changesByTaskId.get(taskId) ?? []).join('\n'),
    });
  }

  const { mode, matches } = await searchChunks(chunks, query, topK ?? 20);

  return {
    mode,
    query,
    totalTasks: byTaskId.size,
    returnedCount: matches.length,
    matches: matches.map((match) => {
      const entry = byTaskId.get(match.location)!;
      return {
        taskId: match.location,
        subject: str(entry.data.subject) ?? str(entry.data.title),
        number: str(entry.data.number),
        usage: str(entry.data.usage),
        score: Number(match.score.toFixed(4)),
        task: entry.raw,
      };
    }),
  };
}

// ---------- get_task ----------

export const getTaskInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  taskId: z.string().describe('The task ID.'),
});
export type GetTaskInput = z.infer<typeof getTaskInput>;

/**
 * Retrieves a specific task/approval/safety issue/safety observation/good
 * practice.
 */
export async function getTask(client: DaluxClient, args: GetTaskInput) {
  return client.tasks.getTask(args.projectId, args.taskId);
}

// ---------- list_task_changes ----------

export const listTaskChangesInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  updatedAfter: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp; only return task changes recorded after this time.'),
});
export type ListTaskChangesInput = z.infer<typeof listTaskChangesInput>;

/**
 * Retrieves task changes on a project in incremental updates, following
 * bookmark pagination to completion server-side before applying the
 * LLM-safe page in paginateForLlm.
 */
export async function listTaskChanges(
  client: DaluxClient,
  args: ListTaskChangesInput,
): Promise<PaginatedForLlm<unknown>> {
  const { projectId, ...params } = args;
  const items = await collectAllDaluxItems((pageParams) =>
    client.tasks.getProjectTaskChanges(projectId, { ...params, ...pageParams }),
  );
  return fullListForLlm(items);
}

// ---------- list_task_attachments ----------

export const listTaskAttachmentsInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  updatedAfter: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp; only return task attachments updated after this time.'),
});
export type ListTaskAttachmentsInput = z.infer<typeof listTaskAttachmentsInput>;

/** Retrieves attachments on tasks on a project. */
export async function listTaskAttachments(
  client: DaluxClient,
  args: ListTaskAttachmentsInput,
): Promise<PaginatedForLlm<unknown>> {
  const { projectId, ...params } = args;
  const items = await collectAllDaluxItems((pageParams) =>
    client.tasks.getProjectTaskAttachments(projectId, { ...params, ...pageParams }),
  );
  return fullListForLlm(items);
}
