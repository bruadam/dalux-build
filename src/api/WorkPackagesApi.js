'use strict';

const { convertToModel } = require('../models/convert');
const { WorkPackagesListResponseSchema } = require('../models/workPackages');

/**
 * API methods for work packages on a project.
 */
class WorkPackagesApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all work packages on the given project.
   * GET /1.0/projects/{projectId}/workpackages
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>} WorkPackagesListResponse ({ items: WorkPackage[], metadata?, links? })
   */
  async listWorkPackages(projectId, params = {}) {
    const response = await this._client.get(`/1.0/projects/${projectId}/workpackages`, params);
    return convertToModel(response, WorkPackagesListResponseSchema, 'WorkPackagesListResponse');
  }
}

module.exports = WorkPackagesApi;
