'use strict';

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
   * @returns {Promise<object>}
   */
  getFileAreas(projectId, params = {}) {
    return this._client.get(`/5.1/projects/${projectId}/file_areas`, params);
  }

  /**
   * Retrieve a specific file area.
   * GET /1.0/projects/{projectId}/file_areas/{fileAreaId}
   * @param {string} projectId
   * @param {string} fileAreaId
   * @returns {Promise<object>}
   */
  getFileArea(projectId, fileAreaId) {
    return this._client.get(`/1.0/projects/${projectId}/file_areas/${fileAreaId}`);
  }

  /**
   * Get a file area ID by its name for a project.
   * @param {string} projectId
   * @param {string} fileAreaName
   * @returns {Promise<string|null>} The fileAreaId, or null if not found.
   */
  async getFileAreaByName(projectId, fileAreaName) {
    const { findByField } = require('../utils/search');
    const response = await this.getFileAreas(projectId);
    const items = (response && response.items) || [];
    const area =
      findByField(items, 'fileAreaName', fileAreaName, (x) => x.data || x) ||
      findByField(items, 'name', fileAreaName, (x) => x.data || x);
    if (!area) return null;
    const data = area.data || area;
    return data.fileAreaId || data.id || null;
  }
}

module.exports = FileAreasApi;
