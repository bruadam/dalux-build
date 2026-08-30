import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { convertToModel, convertToModelList } from '../models/convert';
import { paginate } from '../utils/pagination';
import {
  TaskSchema,
  TaskChangeSchema,
  TasksListResponseSchema,
  TaskResponseSchema,
  TaskChangesSchema,
  TaskAttachmentsListResponseSchema,
} from '../models/tasks';

/**
 * Build query params for GET /5.2/projects/.../tasks (OData).
 * If params contains typeId and no $filter, expands to
 *   $filter=data/type/typeId eq '<typeId>'
 * Single quotes in typeId are escaped as '' per OData. If $filter is set,
 * typeId is still omitted from the outgoing query (not merged).
 */
function normalizeTaskParams(params: Record<string, unknown> = {}): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...params };
  const typeId = normalized.typeId;
  delete normalized.typeId;
  if (typeId != null && normalized.$filter === undefined) {
    const escaped = String(typeId).replace(/'/g, "''");
    normalized.$filter = `data/type/typeId eq '${escaped}'`;
  }
  return normalized;
}

/**
 * API methods for tasks, approvals, safety issues, observations and good practices.
 */
export class TasksApi {
  private _client: ApiClient;

  static normalizeTaskParams = normalizeTaskParams;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve tasks, approvals, safety issues, safety observations and good practices on a project.
   * GET /5.2/projects/{projectId}/tasks
   * Optional filters (e.g. updatedAfter). Pass typeId as shorthand for
   * OData $filter on task type, or pass $filter (and other OData options) directly.
   */
  async getProjectTasks(
    projectId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof TasksListResponseSchema>> {
    const response = await this._client.get(`/5.2/projects/${projectId}/tasks`, normalizeTaskParams(params));
    return convertToModel(response, TasksListResponseSchema, 'TasksListResponse') as z.infer<
      typeof TasksListResponseSchema
    >;
  }

  /**
   * Retrieve all tasks on a project by following bookmark pagination automatically.
   * Matches Python client behaviour: uses metadata.totalRemainingItems when present;
   * otherwise uses metadata.totalItems across pages as a ceiling so pagination cannot run forever.
   * Optional filters / OData (typeId shorthand supported). Logs progress to console when verbose.
   * Returns all task items across all pages.
   */
  async getAllProjectTasks(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof TaskSchema>[]> {
    const allItems: unknown[] = [];
    const baseParams = normalizeTaskParams(params);
    let currentParams: Record<string, unknown> = { ...baseParams };
    let hasNextPage = true;
    let tasksItemsCeiling: number | null = null;

    while (hasNextPage) {
      const response = (await this._client.get(`/5.2/projects/${projectId}/tasks`, currentParams)) as Record<
        string,
        unknown
      >;
      const items = Array.isArray(response.items) ? (response.items as unknown[]) : [];
      if (items.length) {
        allItems.push(...items);
      }
      const meta = (response && (response.metadata as Record<string, unknown>)) || {};
      let remaining: number;
      let useFilesRemainingStop: boolean;

      if (Object.prototype.hasOwnProperty.call(meta, 'totalRemainingItems')) {
        remaining = Number(meta.totalRemainingItems);
        useFilesRemainingStop = true;
      } else if (Object.prototype.hasOwnProperty.call(meta, 'totalItems')) {
        const ti = Number(meta.totalItems);
        tasksItemsCeiling = Math.max(tasksItemsCeiling || 0, ti);
        remaining = ti;
        useFilesRemainingStop = false;
      } else {
        remaining = 0;
        useFilesRemainingStop = true;
      }

      const links = (response.links as Array<{ rel: string; href: string }> | undefined) || [];
      const nextLink = links.find((l) => l.rel === 'nextPage');
      const nextHref = nextLink ? nextLink.href : null;

      if (verbose) {
        const nextPart = nextHref ? ` next: ${nextHref}` : ' next: (none)';
        if (useFilesRemainingStop) {
          console.log(`Retrieved ${allItems.length} tasks so far, ${remaining} remaining...${nextPart}`);
        } else if (tasksItemsCeiling != null) {
          const remV = Math.max(0, tasksItemsCeiling - allItems.length);
          console.log(`Retrieved ${allItems.length} tasks so far, ${remV} remaining...${nextPart}`);
        } else {
          console.log(`Retrieved ${allItems.length} tasks so far, ${remaining} remaining...${nextPart}`);
        }
      }

      if (!items.length) {
        hasNextPage = false;
      } else if (useFilesRemainingStop && remaining === 0) {
        hasNextPage = false;
      } else if (
        !useFilesRemainingStop &&
        tasksItemsCeiling != null &&
        allItems.length >= tasksItemsCeiling
      ) {
        hasNextPage = false;
      } else if (nextLink && nextLink.href) {
        const bookmark = new URL(nextLink.href).searchParams.get('bookmark');
        currentParams = { ...baseParams, bookmark };
      } else {
        hasNextPage = false;
      }
    }

    if (verbose) {
      console.log(`Done. Total tasks retrieved: ${allItems.length}`);
    }
    return convertToModelList(allItems, TaskSchema, 'Task');
  }

  /**
   * Retrieve a specific task/approval/safety issue/safety observation/good practice.
   * GET /3.3/projects/{projectId}/tasks/{taskId}
   */
  async getTask(
    projectId: string,
    taskId: string,
  ): Promise<z.infer<typeof TaskResponseSchema>> {
    const response = await this._client.get(`/3.3/projects/${projectId}/tasks/${taskId}`);
    return convertToModel(response, TaskResponseSchema, 'TaskResponse') as z.infer<typeof TaskResponseSchema>;
  }

  /**
   * Retrieve task changes on a project in incremental updates.
   * GET /2.2/projects/{projectId}/tasks/changes
   * Optional filters (e.g. updatedAfter)
   */
  async getProjectTaskChanges(
    projectId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof TaskChangesSchema>> {
    const response = await this._client.get(`/2.2/projects/${projectId}/tasks/changes`, params);
    return convertToModel(response, TaskChangesSchema, 'TaskChanges') as z.infer<typeof TaskChangesSchema>;
  }

  /**
   * Retrieve attachments on tasks on a project.
   * GET /1.1/projects/{projectId}/tasks/attachments
   * Optional filters (e.g. updatedAfter)
   */
  async getProjectTaskAttachments(
    projectId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof TaskAttachmentsListResponseSchema>> {
    const response = await this._client.get(`/1.1/projects/${projectId}/tasks/attachments`, params);
    return convertToModel(
      response,
      TaskAttachmentsListResponseSchema,
      'TaskAttachmentsListResponse',
    ) as z.infer<typeof TaskAttachmentsListResponseSchema>;
  }

  /**
   * Retrieve all task changes by following bookmark pagination automatically.
   * Optional query parameters (e.g. updatedAfter).
   * Returns all task change items across all pages.
   */
  async getAllProjectTaskChanges(
    projectId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof TaskChangeSchema>[]> {
    const raw = await paginate(
      `/2.2/projects/${projectId}/tasks/changes`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(raw, TaskChangeSchema, 'TaskChange');
  }
}
