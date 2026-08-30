import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { paginateForLlm, type PaginatedForLlm } from '../serialize';

const paginationFields = {
  limit: z.number().int().min(1).max(200).optional().describe('Max items to return (default 50, max 200).'),
  offset: z.number().int().min(0).optional().describe('Number of items to skip (for paging through results).'),
};

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
  ...paginationFields,
});
export type ListProjectTasksInput = z.infer<typeof listProjectTasksInput>;

/**
 * Retrieves tasks, approvals, safety issues, safety observations and good
 * practices on a project, following bookmark pagination to completion
 * server-side before applying the LLM-safe page in paginateForLlm.
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
  const { projectId, limit, offset, filter, select, orderby, ...rest } = args;
  const params: Record<string, unknown> = { ...rest };
  if (filter !== undefined) params.$filter = filter;
  if (select !== undefined) params.$select = select;
  if (orderby !== undefined) params.$orderby = orderby;
  const tasks = await client.tasks.getAllProjectTasks(projectId, params);
  return paginateForLlm(tasks, args);
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
  ...paginationFields,
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
  const { projectId, limit, offset, ...params } = args;
  const changes = await client.tasks.getAllProjectTaskChanges(projectId, params);
  return paginateForLlm(changes, args);
}

// ---------- list_task_attachments ----------

export const listTaskAttachmentsInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  updatedAfter: z
    .string()
    .optional()
    .describe('ISO 8601 timestamp; only return task attachments updated after this time.'),
  ...paginationFields,
});
export type ListTaskAttachmentsInput = z.infer<typeof listTaskAttachmentsInput>;

/** Retrieves attachments on tasks on a project. */
export async function listTaskAttachments(
  client: DaluxClient,
  args: ListTaskAttachmentsInput,
): Promise<PaginatedForLlm<unknown>> {
  const { projectId, limit, offset, ...params } = args;
  const response = await client.tasks.getProjectTaskAttachments(projectId, params);
  return paginateForLlm(response?.items ?? [], args);
}
