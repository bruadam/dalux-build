'use strict';

/**
 * Build query params for GET /5.2/projects/.../tasks (OData).
 * If params contains typeId and no $filter, expands to
 *   $filter=data/type/typeId eq '<typeId>'
 * Single quotes in typeId are escaped as '' per OData. If $filter is set,
 * typeId is still omitted from the outgoing query (not merged).
 * @param {object} [params]
 * @returns {object}
 */
function normalizeTaskParams(params = {}) {
  const normalized = { ...params };
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
class TasksApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve tasks, approvals, safety issues, safety observations and good practices on a project.
   * GET /5.2/projects/{projectId}/tasks
   * @param {string} projectId
   * @param {object} [params] - Optional filters (e.g. updatedAfter). Pass typeId as shorthand for
   *   OData $filter on task type, or pass $filter (and other OData options) directly.
   * @returns {Promise<object>}
   */
  getProjectTasks(projectId, params = {}) {
    return this._client.get(`/5.2/projects/${projectId}/tasks`, normalizeTaskParams(params));
  }

  /**
   * Retrieve all tasks on a project by following bookmark pagination automatically.
   * Matches Python client behaviour: uses metadata.totalRemainingItems when present;
   * otherwise uses metadata.totalItems across pages as a ceiling so pagination cannot run forever.
   * @param {string} projectId
   * @param {object} [params] - Optional filters / OData (typeId shorthand supported).
   * @param {boolean} [verbose=false] - Log progress to console.
   * @returns {Promise<object[]>} All task items across all pages
   */
  async getAllProjectTasks(projectId, params = {}, verbose = false) {
    const allItems = [];
    const baseParams = normalizeTaskParams(params);
    let currentParams = { ...baseParams };
    let hasNextPage = true;
    /** @type {number|null} */
    let tasksItemsCeiling = null;

    while (hasNextPage) {
      const response = await this._client.get(`/5.2/projects/${projectId}/tasks`, currentParams);
      const items = Array.isArray(response.items) ? response.items : [];
      if (items.length) {
        allItems.push(...items);
      }
      const meta = (response && response.metadata) || {};
      let remaining;
      let useFilesRemainingStop;

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

      const nextLink = (response.links || []).find((l) => l.rel === 'nextPage');
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
      } else if (nextLink) {
        const bookmark = new URL(nextLink.href).searchParams.get('bookmark');
        currentParams = { ...baseParams, bookmark };
      } else {
        hasNextPage = false;
      }
    }

    if (verbose) {
      console.log(`Done. Total tasks retrieved: ${allItems.length}`);
    }
    return allItems;
  }

  /**
   * Retrieve a specific task/approval/safety issue/safety observation/good practice.
   * GET /3.3/projects/{projectId}/tasks/{taskId}
   * @param {string} projectId
   * @param {string} taskId
   * @returns {Promise<object>}
   */
  getTask(projectId, taskId) {
    return this._client.get(`/3.3/projects/${projectId}/tasks/${taskId}`);
  }

  /**
   * Retrieve task changes on a project in incremental updates.
   * GET /2.2/projects/{projectId}/tasks/changes
   * @param {string} projectId
   * @param {object} [params] - Optional filters (e.g. updatedAfter)
   * @returns {Promise<object>}
   */
  getProjectTaskChanges(projectId, params = {}) {
    return this._client.get(`/2.2/projects/${projectId}/tasks/changes`, params);
  }

  /**
   * Retrieve attachments on tasks on a project.
   * GET /1.1/projects/{projectId}/tasks/attachments
   * @param {string} projectId
   * @param {object} [params] - Optional filters (e.g. updatedAfter)
   * @returns {Promise<object>}
   */
  getProjectTaskAttachments(projectId, params = {}) {
    return this._client.get(`/1.1/projects/${projectId}/tasks/attachments`, params);
  }
}

TasksApi.normalizeTaskParams = normalizeTaskParams;

module.exports = TasksApi;
