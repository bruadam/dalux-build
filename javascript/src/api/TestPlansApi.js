'use strict';

const { convertToModel, convertToModelList } = require('../models/convert');
const { paginate } = require('../utils/pagination');
const {
  TestPlanSchema,
  TestPlanItemSchema,
  TestPlanItemZoneSchema,
  TestPlanRegistrationSchema,
  TestPlansListResponseSchema,
  TestPlanItemsListResponseSchema,
  TestPlanItemZonesListResponseSchema,
  TestPlanRegistrationsListResponseSchema,
} = require('../models/testPlans');

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
   * @param {boolean} [fullResponse=false]
   * @returns {Promise<object[]|object>}
   */
  async listTestPlans(projectId, params = {}, fullResponse = false) {
    const response = await this._client.get(`/1.2/projects/${projectId}/testPlans`, params);
    const result = convertToModel(
      response,
      TestPlansListResponseSchema,
      'TestPlansListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllTestPlans(projectId, params = {}, verbose = false) {
    const items = await paginate(
      `/1.2/projects/${projectId}/testPlans`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, TestPlanSchema, 'TestPlan');
  }

  /**
   * Browse all test plan items on the given project.
   * GET /1.1/projects/{projectId}/testPlanItems
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  async listTestPlanItems(projectId, params = {}, fullResponse = false) {
    const response = await this._client.get(`/1.1/projects/${projectId}/testPlanItems`, params);
    const result = convertToModel(
      response,
      TestPlanItemsListResponseSchema,
      'TestPlanItemsListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllTestPlanItems(projectId, params = {}, verbose = false) {
    const items = await paginate(
      `/1.1/projects/${projectId}/testPlanItems`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, TestPlanItemSchema, 'TestPlanItem');
  }

  /**
   * Browse all test plan item zones on the given project.
   * GET /1.1/projects/{projectId}/testPlanItemZones
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  async listTestPlanItemZones(projectId, params = {}, fullResponse = false) {
    const response = await this._client.get(`/1.1/projects/${projectId}/testPlanItemZones`, params);
    const result = convertToModel(
      response,
      TestPlanItemZonesListResponseSchema,
      'TestPlanItemZonesListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllTestPlanItemZones(projectId, params = {}, verbose = false) {
    const items = await paginate(
      `/1.1/projects/${projectId}/testPlanItemZones`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, TestPlanItemZoneSchema, 'TestPlanItemZone');
  }

  /**
   * Browse all test plan registrations on the given project.
   * GET /1.1/projects/{projectId}/testPlanRegistrations
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  async listTestPlanRegistrations(projectId, params = {}, fullResponse = false) {
    const response = await this._client.get(`/1.1/projects/${projectId}/testPlanRegistrations`, params);
    const result = convertToModel(
      response,
      TestPlanRegistrationsListResponseSchema,
      'TestPlanRegistrationsListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllTestPlanRegistrations(projectId, params = {}, verbose = false) {
    const items = await paginate(
      `/1.1/projects/${projectId}/testPlanRegistrations`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, TestPlanRegistrationSchema, 'TestPlanRegistration');
  }
}

module.exports = TestPlansApi;
