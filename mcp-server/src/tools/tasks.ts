import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { paginateForLlm, type PaginatedForLlm } from '../serialize';

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
 * Fetches bookmark pages incrementally and stops once enough items have
 * been gathered for the first MCP page (50 items), which keeps calls
 * responsive on large projects.
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
  const requiredCount = 50;

  const params: Record<string, unknown> = { ...rest };
  if (filter !== undefined) params.$filter = filter;
  if (select !== undefined) params.$select = select;
  if (orderby !== undefined) params.$orderby = orderby;

  const items: unknown[] = [];
  const seenBookmarks = new Set<string>();
  let bookmark: string | undefined;
  let totalItemsFromMetadata: number | undefined;
  let hasMore = false;

  while (items.length < requiredCount) {
    const pageParams = bookmark ? { ...params, bookmark } : params;
    const response = await client.tasks.getProjectTasks(projectId, pageParams);
    const pageItems = response?.items ?? [];
    items.push(...pageItems);

    if (typeof response?.metadata?.totalItems === 'number') {
      totalItemsFromMetadata = response.metadata.totalItems;
    }

    const nextHref = response?.links?.find((link) => link.rel === 'nextPage')?.href;
    const nextBookmark = nextHref ? new URL(nextHref).searchParams.get('bookmark') ?? undefined : undefined;
    const remaining = response?.metadata?.totalRemainingItems;
    const noMore =
      pageItems.length === 0 ||
      !nextBookmark ||
      (typeof remaining === 'number' && remaining <= 0) ||
      seenBookmarks.has(nextBookmark);

    if (noMore) {
      hasMore = false;
      break;
    }

    hasMore = true;
    seenBookmarks.add(nextBookmark);
    bookmark = nextBookmark;
  }

  const page = items.slice(0, requiredCount);
  const totalCount = totalItemsFromMetadata ?? (hasMore ? Math.max(items.length, page.length + 1) : items.length);
  return {
    items: page,
    totalCount,
    returnedCount: page.length,
    truncated: page.length < totalCount,
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
  const changes = await client.tasks.getAllProjectTaskChanges(projectId, params);
  return paginateForLlm(changes);
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
  const response = await client.tasks.getProjectTaskAttachments(projectId, params);
  return paginateForLlm(response?.items ?? []);
}
