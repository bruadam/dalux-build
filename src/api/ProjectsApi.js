'use strict';

/**
 * API methods for project management.
 */
class ProjectsApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Get all available projects.
   * GET /5.1/projects
   * @param {object} [params] - Optional query parameters (e.g. updatedAfter)
   * @returns {Promise<object>}
   */
  listProjects(params = {}) {
    return this._client.get('/5.1/projects', params);
  }

  /**
   * Get a specific project.
   * GET /5.0/projects/{projectId}
   * @param {string} projectId
   * @returns {Promise<object>}
   */
  getProject(projectId) {
    return this._client.get(`/5.0/projects/${projectId}`);
  }

  /**
   * Create a new project.
   * POST /5.0/projects
   * @param {object} body
   * @returns {Promise<object>}
   */
  createProject(body) {
    return this._client.post('/5.0/projects', body);
  }

  /**
   * Update a project.
   * PATCH /5.0/projects/{projectId}
   * @param {string} projectId
   * @param {object} body
   * @returns {Promise<object>}
   */
  updateProject(projectId, body) {
    return this._client.patch(`/5.0/projects/${projectId}`, body);
  }

  /**
   * Get all metadata available for POST project operations.
   * GET /1.0/projects/metadata/1.0/mappings
   * @returns {Promise<object>}
   */
  listMetadataMappingsForProjects() {
    return this._client.get('/1.0/projects/metadata/1.0/mappings');
  }

  /**
   * Get available values for a metadata key in POST project operations.
   * GET /1.0/projects/metadata/1.0/mappings/{key}/values
   * @param {string} key
   * @returns {Promise<object>}
   */
  listMetadataValuesForProjects(key) {
    return this._client.get(`/1.0/projects/metadata/1.0/mappings/${key}/values`);
  }

  /**
   * Get metadata of a specific project.
   * GET /1.0/projects/{projectId}/metadata
   * @param {string} projectId
   * @returns {Promise<object>}
   */
  listProjectMetadata(projectId) {
    return this._client.get(`/1.0/projects/${projectId}/metadata`);
  }

  /**
   * Get all metadata available for PATCH project operations.
   * GET /1.0/projects/{projectId}/metadata/1.0/mappings
   * @param {string} projectId
   * @returns {Promise<object>}
   */
  listProjectMetadataMappings(projectId) {
    return this._client.get(`/1.0/projects/${projectId}/metadata/1.0/mappings`);
  }

  /**
   * Get available values for metadata in a PATCH project operation.
   * GET /1.0/projects/{projectId}/metadata/1.0/mappings/{key}/values
   * @param {string} projectId
   * @param {string} key
   * @returns {Promise<object>}
   */
  listProjectMetadataValues(projectId, key) {
    return this._client.get(`/1.0/projects/${projectId}/metadata/1.0/mappings/${key}/values`);
  }

  /**
   * Get a project ID by its name.
   * @param {string} projectName
   * @returns {Promise<string|null>} The projectId, or null if not found.
   */
  async getProjectByName(projectName) {
    const { findByField } = require('../utils/search');
    const response = await this.listProjects();
    const items = (response && response.items) || [];
    const project =
      findByField(items, 'projectName', projectName, (x) => x.data || x) ||
      findByField(items, 'name', projectName, (x) => x.data || x);
    if (!project) return null;
    const data = project.data || project;
    return data.projectId || data.id || null;
  }
}

module.exports = ProjectsApi;
