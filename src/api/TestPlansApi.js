'use strict';

const { convertToModel } = require('../models/convert');
const { TestPlansListResponseSchema } = require('../models/testPlans');

/**
 * API methods for test plans.
 */
class TestPlansApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all test plans on the given project.
   * GET /1.2/projects/{projectId}/testPlans
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>} TestPlansListResponse ({ items, metadata?, links? })
   */
  async listTestPlans(projectId, params = {}) {
    const response = await this._client.get(`/1.2/projects/${projectId}/testPlans`, params);
    return convertToModel(response, TestPlansListResponseSchema, 'TestPlansListResponse');
  }

  /**
   * Browse all test plan items on the given project.
   * GET /1.1/projects/{projectId}/testPlanItems
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  listTestPlanItems(projectId, params = {}) {
    return this._client.get(`/1.1/projects/${projectId}/testPlanItems`, params);
  }

  /**
   * Browse all test plan item zones on the given project.
   * GET /1.1/projects/{projectId}/testPlanItemZones
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  listTestPlanItemZones(projectId, params = {}) {
    return this._client.get(`/1.1/projects/${projectId}/testPlanItemZones`, params);
  }

  /**
   * Browse all test plan registrations on the given project.
   * GET /1.1/projects/{projectId}/testPlanRegistrations
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  listTestPlanRegistrations(projectId, params = {}) {
    return this._client.get(`/1.1/projects/${projectId}/testPlanRegistrations`, params);
  }
}

module.exports = TestPlansApi;
