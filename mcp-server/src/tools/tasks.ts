import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { downloadDaluxFile } from '../attachmentFetch';
import { collectAllDaluxItems } from '../daluxPagination';
import type { TextChunk } from '../extract';
import { extractAttachmentTextsByTaskId, groupAttachmentsByTaskId } from '../rag/taskAttachments';
import { groupChangesByTaskId, renderTaskLines, str, unwrapTask, type AttachmentText } from '../rag/taskText';
import { searchChunks } from '../search/documentSearch';
import { fullListForLlm, paginateForLlm, type PaginatedForLlm } from '../serialize';

const taskConditionOps = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'contains'] as const;

/**
 * A single field/op/value filter, matched against a task's own JSON shape —
 * the schema-driven alternative to hand-written OData. Dalux's tasks $filter
 * only ever validates one exact expression server-side (`data/type/typeId eq
 * '<id>'` — no `and`/`or`, no other operators, no other fields), so anything
 * else (dates, status, custom fields, ...) has to be expressed as a
 * `conditions` entry and applied here, client-side, after fetching.
 */
export const taskFilterConditionSchema = z.object({
  field: z
    .string()
    .describe(
      'Dot path into the task JSON exactly as returned by get_task/list_project_tasks (the tool\'s own response ' +
        'shape, not Dalux\'s OData path syntax) — e.g. "type.typeId", "created", "workflow.name", "status", ' +
        '"userDefinedFields.Some Field".',
    ),
  op: z.enum(taskConditionOps).describe('Comparison operator. "contains" is a case-insensitive substring match (string fields only).'),
  value: z.union([z.string(), z.number(), z.boolean()]).describe('Value to compare the field against.'),
});
export type TaskFilterCondition = z.infer<typeof taskFilterConditionSchema>;

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function matchesCondition(actual: unknown, condition: TaskFilterCondition): boolean {
  const { op, value } = condition;
  if (op === 'contains') {
    return typeof actual === 'string' && typeof value === 'string' && actual.toLowerCase().includes(value.toLowerCase());
  }
  if (actual === null || actual === undefined) return false;

  let cmp: number;
  if (typeof actual === 'number' && typeof value === 'number') {
    cmp = actual - value;
  } else if (typeof actual === 'boolean' || typeof value === 'boolean') {
    if (op !== 'eq' && op !== 'ne') return false;
    cmp = actual === value ? 0 : 1;
  } else {
    // ISO 8601 timestamps and plain strings both sort correctly lexically.
    const a = String(actual);
    const b = String(value);
    cmp = a < b ? -1 : a > b ? 1 : 0;
  }
  switch (op) {
    case 'eq':
      return cmp === 0;
    case 'ne':
      return cmp !== 0;
    case 'gt':
      return cmp > 0;
    case 'ge':
      return cmp >= 0;
    case 'lt':
      return cmp < 0;
    case 'le':
      return cmp <= 0;
    default:
      return false;
  }
}

/** ANDs every condition together against each task's own (unwrapped) fields. */
function applyConditions<T>(items: readonly T[], conditions: TaskFilterCondition[] | undefined): T[] {
  if (!conditions || conditions.length === 0) return [...items];
  return items.filter((item) => {
    const data = unwrapTask(item);
    return conditions.every((condition) => matchesCondition(getByPath(data, condition.field), condition));
  });
}

// ---------- list_project_tasks ----------

export const listProjectTasksInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  typeId: z
    .string()
    .optional()
    .describe(
      'Shorthand filter: only return tasks of this task type ID. Expands to an OData $filter on data/type/typeId. Ignored if filter is also set.',
    ),
  filter: z
    .string()
    .optional()
    .describe(
      'Raw OData $filter expression, passed to Dalux as-is. Takes precedence over typeId. Dalux only validates ' +
        'a single `data/type/typeId eq \'<id>\'` expression here — no `and`/`or`, no other operators (`ge`, ' +
        '`le`, ...), and no other fields (e.g. data/created); anything beyond that exact shape fails with ' +
        '"Parameter validation failed for OData query". For any other filtering (dates, status, custom fields, ' +
        '...), use `conditions` instead.',
    ),
  select: z.string().optional().describe('OData $select expression to limit which fields are returned.'),
  orderby: z.string().optional().describe('OData $orderby expression.'),
  conditions: z
    .array(taskFilterConditionSchema)
    .optional()
    .describe(
      'Field-based filters applied client-side after fetching (ANDed together, and ANDed with typeId/filter) — ' +
        'the general-purpose replacement for hand-written OData, since Dalux\'s own $filter only supports typeId ' +
        'eq. `field` is a dot path into the same task JSON this tool returns, e.g. ' +
        '[{"field": "created", "op": "ge", "value": "2026-08-01T00:00:00Z"}].',
    ),
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
 *
 * `conditions` exists because Dalux's own $filter only accepts
 * `data/type/typeId eq '<id>'` — there is no server-side way to filter tasks
 * on anything else, so it's done here, client-side, after fetching.
 */
export async function listProjectTasks(
  client: DaluxClient,
  args: ListProjectTasksInput,
): Promise<PaginatedForLlm<unknown>> {
  const { projectId, filter, select, orderby, conditions, ...rest } = args;

  const params: Record<string, unknown> = { ...rest };
  if (filter !== undefined) params.$filter = filter;
  if (select !== undefined) params.$select = select;
  if (orderby !== undefined) params.$orderby = orderby;
  const items = await collectAllDaluxItems((pageParams) =>
    client.tasks.getProjectTasks(projectId, { ...params, ...pageParams }),
  );
  return fullListForLlm(applyConditions(items, conditions));
}

// ---------- search_tasks ----------

const MAX_ATTACHMENTS_PER_TASK_ADHOC = 5;
const ATTACHMENT_CONCURRENCY_ADHOC = 4;

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
    .describe(
      'Raw OData $filter expression narrowing which tasks are searched. Dalux only validates a single ' +
        '`data/type/typeId eq \'<id>\'` expression here — no `and`/`or`, comparison operators, or other fields. ' +
        'For any other filtering (dates, status, custom fields, ...), use `conditions` instead.',
    ),
  conditions: z
    .array(taskFilterConditionSchema)
    .optional()
    .describe(
      'Field-based filters applied client-side before ranking (ANDed together, and ANDed with typeId/filter) — ' +
        'the general-purpose replacement for hand-written OData, since Dalux\'s own $filter only supports typeId ' +
        'eq. `field` is a dot path into the same task JSON get_task returns, e.g. ' +
        '[{"field": "created", "op": "ge", "value": "2026-08-01T00:00:00Z"}].',
    ),
  includeChanges: z
    .boolean()
    .optional()
    .describe(
      'Also match against each task\'s change history text (fetches every task change on the project — an extra ' +
        'API call). Default false. For repeated searches over the same project, build_task_index + ' +
        'search_task_index is cheaper.',
    ),
  includeAttachments: z
    .boolean()
    .optional()
    .describe(
      `Also match against the text of each matching task's attachments — pdf/docx/xlsx are supported (not .doc/` +
        `.xls, images, or drawings). Fetches every task attachment on the project, then downloads and extracts ` +
        `up to ${MAX_ATTACHMENTS_PER_TASK_ADHOC} per task (largest cost of any option here — network + parsing, ` +
        `not just an extra API call). Default false. For repeated searches, build_task_index + search_task_index ` +
        'does this once and caches it instead of on every call.',
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
  const { projectId, query, typeId, filter, conditions, includeChanges, includeAttachments, topK } = args;

  const params: Record<string, unknown> = {};
  if (filter !== undefined) {
    params.$filter = filter;
  } else if (typeId !== undefined) {
    params.$filter = `data/type/typeId eq '${typeId.replace(/'/g, "''")}'`;
  }

  const rawTasks = applyConditions(
    await collectAllDaluxItems((pageParams) => client.tasks.getProjectTasks(projectId, { ...params, ...pageParams })),
    conditions,
  );

  const changesByTaskId = includeChanges
    ? groupChangesByTaskId(
        (await collectAllDaluxItems((pageParams) =>
          client.tasks.getProjectTaskChanges(projectId, pageParams),
        )) as Record<string, unknown>[],
      )
    : new Map<string, Record<string, unknown>[]>();

  const taskIds = rawTasks
    .map((raw) => unwrapTask(raw).taskId as string | undefined)
    .filter((taskId): taskId is string => Boolean(taskId));

  const attachmentTextsByTaskId = includeAttachments
    ? await extractAttachmentTextsByTaskId(
        client,
        groupAttachmentsByTaskId(
          await collectAllDaluxItems((pageParams) => client.tasks.getProjectTaskAttachments(projectId, pageParams)),
        ),
        taskIds,
        { maxPerTask: MAX_ATTACHMENTS_PER_TASK_ADHOC, concurrency: ATTACHMENT_CONCURRENCY_ADHOC },
      )
    : new Map<string, AttachmentText[]>();

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
      text: renderTaskLines(data, changesByTaskId.get(taskId) ?? [], attachmentTextsByTaskId.get(taskId) ?? []).join('\n'),
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

/**
 * The Dalux task-changes and task-attachments endpoints have no per-task
 * filter (they only take a project-wide `updatedAfter` window) — every item
 * carries its own `taskId`, so scoping to one task means fetching the whole
 * window and filtering here.
 */
function filterByTaskId<T>(items: readonly T[], taskId: string | undefined): T[] {
  if (!taskId) return [...items];
  return items.filter((item) => (item as Record<string, unknown>).taskId === taskId);
}

// ---------- get_task ----------

export const getTaskInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  taskId: z.string().describe('The task ID.'),
  includeChanges: z
    .boolean()
    .optional()
    .describe(
      'Also fetch this task\'s change history (field edits, status transitions, and comments recorded as ' +
        'changes) and return it as `changes`. There is no per-task filter on the Dalux side, so this fetches ' +
        'every change on the whole project (bookmark-paginated to completion) and filters to this task ' +
        'client-side — can be slow/expensive on projects with a long change history. Default false.',
    ),
  includeAttachments: z
    .boolean()
    .optional()
    .describe(
      'Also fetch this task\'s attachments and return them as `attachments`. Same caveat as includeChanges: no ' +
        'per-task filter exists server-side, so this fetches every attachment on the whole project and filters ' +
        'client-side. Default false.',
    ),
});
export type GetTaskInput = z.infer<typeof getTaskInput>;

/**
 * Retrieves a specific task/approval/safety issue/safety observation/good
 * practice. get_task alone only returns the task's own structured fields
 * (subject, type, custom fields, etc.) — it does not include the comment
 * thread or attachments, which live in separate project-wide endpoints.
 * includeChanges/includeAttachments opt into fetching and filtering those
 * here so a single call can answer "what's the full history of this task".
 */
export async function getTask(client: DaluxClient, args: GetTaskInput) {
  const { projectId, taskId, includeChanges, includeAttachments } = args;
  const task = await client.tasks.getTask(projectId, taskId);
  if (!includeChanges && !includeAttachments) return task;

  const result: Record<string, unknown> = { ...task };
  if (includeChanges) {
    const allChanges = await collectAllDaluxItems((pageParams) =>
      client.tasks.getProjectTaskChanges(projectId, pageParams),
    );
    result.changes = filterByTaskId(allChanges, taskId);
  }
  if (includeAttachments) {
    const allAttachments = await collectAllDaluxItems((pageParams) =>
      client.tasks.getProjectTaskAttachments(projectId, pageParams),
    );
    result.attachments = filterByTaskId(allAttachments, taskId);
  }
  return result;
}

// ---------- list_task_changes ----------

export const listTaskChangesInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  taskId: z
    .string()
    .optional()
    .describe(
      'Only return changes for this task. No server-side filter exists for this — the full updatedAfter window ' +
        'is still fetched from Dalux, then filtered to this task client-side before returning.',
    ),
  updatedAfter: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp; only return task changes recorded after this time.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Max changes to return (default 50). Without a taskId, a project-wide change log can be huge — narrow with ' +
        'taskId and/or updatedAfter rather than raising this.',
    ),
});
export type ListTaskChangesInput = z.infer<typeof listTaskChangesInput>;

/**
 * Retrieves task changes on a project in incremental updates, following
 * bookmark pagination to completion server-side, filtering to `taskId` when
 * given, then truncating to an LLM-safe page via paginateForLlm — a
 * project's full change history can otherwise run to millions of characters
 * and blow the response straight past the model's context limit.
 */
export async function listTaskChanges(
  client: DaluxClient,
  args: ListTaskChangesInput,
): Promise<PaginatedForLlm<unknown>> {
  const { projectId, taskId, limit, ...params } = args;
  const items = await collectAllDaluxItems((pageParams) =>
    client.tasks.getProjectTaskChanges(projectId, { ...params, ...pageParams }),
  );
  return paginateForLlm(filterByTaskId(items, taskId), { limit });
}

// ---------- list_task_attachments ----------

export const listTaskAttachmentsInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  taskId: z
    .string()
    .optional()
    .describe(
      'Only return attachments for this task. No server-side filter exists for this — the full updatedAfter ' +
        'window is still fetched from Dalux, then filtered to this task client-side before returning.',
    ),
  updatedAfter: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp; only return task attachments updated after this time.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Max attachments to return (default 50). Without a taskId, a project-wide attachment list can be huge — ' +
        'narrow with taskId and/or updatedAfter rather than raising this.',
    ),
});
export type ListTaskAttachmentsInput = z.infer<typeof listTaskAttachmentsInput>;

/**
 * Retrieves attachments on tasks on a project, truncating to an LLM-safe
 * page via paginateForLlm — a project's full attachment list otherwise
 * includes every file's name and download URL with no cap, which on a
 * real project runs well past the model's context limit.
 */
export async function listTaskAttachments(
  client: DaluxClient,
  args: ListTaskAttachmentsInput,
): Promise<PaginatedForLlm<unknown>> {
  const { projectId, taskId, limit, ...params } = args;
  const items = await collectAllDaluxItems((pageParams) =>
    client.tasks.getProjectTaskAttachments(projectId, { ...params, ...pageParams }),
  );
  return paginateForLlm(filterByTaskId(items, taskId), { limit });
}

// ---------- download_task_attachment ----------

export const downloadTaskAttachmentInput = z.object({
  fileDownload: z
    .string()
    .describe(
      'The attachment\'s `mediaFile.fileDownload` URL, exactly as returned by list_task_attachments or ' +
        'get_task (includeAttachments: true).',
    ),
  fileName: z
    .string()
    .optional()
    .describe(
      'The attachment\'s `mediaFile.name`, used to name the cached file (and, for search_file_content, to infer ' +
        'its format from the extension). Defaults to the URL\'s last path segment if omitted.',
    ),
});
export type DownloadTaskAttachmentInput = z.infer<typeof downloadTaskAttachmentInput>;

/**
 * Downloads a task attachment's file content into a local cache directory
 * (never returns raw bytes — same contract as download_file). Task
 * attachments have no fileId/fileArea to look up like ordinary project
 * files: the API hands back a direct `mediaFile.fileDownload` URL instead,
 * signed with the same X-API-KEY as every other Dalux request — that's what
 * FilesApi.downloadFileFromLink does under the hood.
 */
export async function downloadTaskAttachment(client: DaluxClient, args: DownloadTaskAttachmentInput) {
  let fileName = args.fileName;
  if (!fileName) {
    try {
      fileName = decodeURIComponent(new URL(args.fileDownload).pathname.split('/').filter(Boolean).pop() ?? '');
    } catch {
      fileName = '';
    }
    if (!fileName) fileName = 'attachment';
  }

  const filePath = await downloadDaluxFile(client, args.fileDownload, fileName);
  return { found: true, filePath, fileName };
}
