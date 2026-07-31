'use strict';

const { findByField } = require('../utils/search');
const { convertToModel } = require('../models/convert');
const { FileAreaSchema, FileAreasListResponseSchema } = require('../models/fileAreas');

/**
 * API methods for file areas on a project.
 */
class FileAreasApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve the file areas on the given project.
   * GET /5.1/projects/{projectId}/file_areas
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>} FileAreasListResponse ({ items: FileArea[], metadata?, links? })
   */
  async getFileAreas(projectId, params = {}) {
    const response = await this._client.get(`/5.1/projects/${projectId}/file_areas`, params);
    return convertToModel(response, FileAreasListResponseSchema, 'FileAreasListResponse');
  }

  /**
   * Retrieve a specific file area.
   * GET /1.0/projects/{projectId}/file_areas/{fileAreaId}
   * @param {string} projectId
   * @param {string} fileAreaId
   * @returns {Promise<object>} FileArea (not wrapped in a data envelope, matches Python)
   */
  async getFileArea(projectId, fileAreaId) {
    const response = await this._client.get(`/1.0/projects/${projectId}/file_areas/${fileAreaId}`);
    return convertToModel(response, FileAreaSchema, 'FileArea');
  }

  /**
   * Get a file area ID by its name for a project.
   * @param {string} projectId
   * @param {string} fileAreaName
   * @returns {Promise<string|null>} The fileAreaId, or null if not found.
   */
  async getFileAreaByName(projectId, fileAreaName) {
    const response = await this.getFileAreas(projectId);
    const items = (response && response.items) || [];
    const area = findByField(items, 'fileAreaName', fileAreaName);
    if (!area) return null;
    return area.fileAreaId || null;
  }
}

module.exports = FileAreasApi;
