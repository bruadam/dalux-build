'use strict';

const { convertToModel } = require('../models/convert');
const { VersionSetsListResponseSchema, VersionSetResponseSchema } = require('../models/versionSets');
const { FilesListResponseSchema } = require('../models/files');

/**
 * API methods for version sets.
 */
class VersionSetsApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve the version sets on the given project.
   * GET /2.1/projects/{projectId}/version_sets
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>} VersionSetsListResponse ({ items: VersionSet[], metadata?, links? })
   */
  async getVersionSets(projectId, params = {}) {
    const response = await this._client.get(`/2.1/projects/${projectId}/version_sets`, params);
    return convertToModel(response, VersionSetsListResponseSchema, 'VersionSetsListResponse');
  }

  /**
   * Retrieve a specific version set.
   * GET /2.0/projects/{projectId}/version_sets/{versionSetId}
   * @param {string} projectId
   * @param {string} versionSetId
   * @returns {Promise<object>} VersionSetResponse ({ data: VersionSet, links? })
   */
  async getVersionSet(projectId, versionSetId) {
    const response = await this._client.get(`/2.0/projects/${projectId}/version_sets/${versionSetId}`);
    return convertToModel(response, VersionSetResponseSchema, 'VersionSetResponse');
  }

  /**
   * Browse all version sets on the given file area and project.
   * GET /2.1/projects/{projectId}/file_areas/{fileAreaId}/version_sets
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {object} [params]
   * @returns {Promise<object>} VersionSetsListResponse
   */
  async listFileAreaVersionSets(projectId, fileAreaId, params = {}) {
    const response = await this._client.get(
      `/2.1/projects/${projectId}/file_areas/${fileAreaId}/version_sets`,
      params,
    );
    return convertToModel(response, VersionSetsListResponseSchema, 'VersionSetsListResponse');
  }

  /**
   * Browse all files on the given project and given version set.
   * GET /3.0/projects/{projectId}/version_sets/{versionSetId}/files
   * @param {string} projectId
   * @param {string} versionSetId
   * @param {object} [params]
   * @returns {Promise<object>} FilesListResponse (cross-endpoint reuse of the Files model, matches Python)
   */
  async listVersionSetFiles(projectId, versionSetId, params = {}) {
    const response = await this._client.get(
      `/3.0/projects/${projectId}/version_sets/${versionSetId}/files`,
      params,
    );
    return convertToModel(response, FilesListResponseSchema, 'FilesListResponse');
  }
}

module.exports = VersionSetsApi;
