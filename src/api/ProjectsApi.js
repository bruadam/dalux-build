'use strict';

const { findByField } = require('../utils/search');
const { convertToModel } = require('../models/convert');
const { ProjectsListResponseSchema, ProjectResponseSchema } = require('../models/projects');

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
   * @returns {Promise<object>} ProjectsListResponse ({ items: Project[], metadata?, links? })
   */
  async listProjects(params = {}) {
    const response = await this._client.get('/5.1/projects', params);
    return convertToModel(response, ProjectsListResponseSchema, 'ProjectsListResponse');
  }

  /**
   * Get a specific project.
   * GET /5.0/projects/{projectId}
   * @param {string} projectId
   * @returns {Promise<object>} ProjectResponse ({ data: Project, links? })
   */
  async getProject(projectId) {
    const response = await this._client.get(`/5.0/projects/${projectId}`);
    return convertToModel(response, ProjectResponseSchema, 'ProjectResponse');
  }

  /**
   * Create a new project.
   * POST /5.0/projects
   * @param {object} body
   * @returns {Promise<object>} ProjectResponse
   */
  async createProject(body) {
    const response = await this._client.post('/5.0/projects', body);
    return convertToModel(response, ProjectResponseSchema, 'ProjectResponse');
  }

  /**
   * Update a project.
   * PATCH /5.0/projects/{projectId}
   * @param {string} projectId
   * @param {object} body
   * @returns {Promise<object>} ProjectResponse
   */
  async updateProject(projectId, body) {
    const response = await this._client.patch(`/5.0/projects/${projectId}`, body);
    return convertToModel(response, ProjectResponseSchema, 'ProjectResponse');
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
    const response = await this.listProjects();
    const items = (response && response.items) || [];
    const project = findByField(items, 'projectName', projectName);
    if (!project) return null;
    return project.projectId || null;
  }
}

module.exports = ProjectsApi;
