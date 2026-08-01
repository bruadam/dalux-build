'use strict';

const { convertToModel, convertToModelList } = require('../models/convert');
const { paginate } = require('../utils/pagination');
const {
  InspectionPlanSchema,
  InspectionPlanItemSchema,
  InspectionPlanItemZoneSchema,
  InspectionPlanRegistrationSchema,
  InspectionPlansListResponseSchema,
  InspectionPlanItemsListResponseSchema,
  InspectionPlanItemZonesListResponseSchema,
  InspectionPlanRegistrationsListResponseSchema,
} = require('../models/inspectionPlans');

/**
 * API methods for inspection plans.
 */
class InspectionPlansApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all inspection plans on the given project.
   * GET /1.2/projects/{projectId}/inspectionPlans
   * @param {string} projectId
   * @param {object} [params]
   * @param {boolean} [fullResponse=false]
   * @returns {Promise<object[]|object>}
   */
  async listInspectionPlans(projectId, params = {}, fullResponse = false) {
    const response = await this._client.get(`/1.2/projects/${projectId}/inspectionPlans`, params);
    const result = convertToModel(
      response,
      InspectionPlansListResponseSchema,
      'InspectionPlansListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllInspectionPlans(projectId, params = {}, verbose = false) {
    const items = await paginate(
      `/1.2/projects/${projectId}/inspectionPlans`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, InspectionPlanSchema, 'InspectionPlan');
  }

  /**
   * Browse all inspection plan items on the given project.
   * GET /1.1/projects/{projectId}/inspectionPlanItems
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  async listInspectionPlanItems(projectId, params = {}, fullResponse = false) {
    const response = await this._client.get(`/1.1/projects/${projectId}/inspectionPlanItems`, params);
    const result = convertToModel(
      response,
      InspectionPlanItemsListResponseSchema,
      'InspectionPlanItemsListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllInspectionPlanItems(projectId, params = {}, verbose = false) {
    const items = await paginate(
      `/1.1/projects/${projectId}/inspectionPlanItems`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, InspectionPlanItemSchema, 'InspectionPlanItem');
  }

  /**
   * Browse all inspection plan item zones on the given project.
   * GET /1.1/projects/{projectId}/inspectionPlanItemZones
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  async listInspectionPlanItemZones(projectId, params = {}, fullResponse = false) {
    const response = await this._client.get(`/1.1/projects/${projectId}/inspectionPlanItemZones`, params);
    const result = convertToModel(
      response,
      InspectionPlanItemZonesListResponseSchema,
      'InspectionPlanItemZonesListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllInspectionPlanItemZones(projectId, params = {}, verbose = false) {
    const items = await paginate(
      `/1.1/projects/${projectId}/inspectionPlanItemZones`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, InspectionPlanItemZoneSchema, 'InspectionPlanItemZone');
  }

  /**
   * Browse all inspection plan registrations on the given project.
   * GET /2.1/projects/{projectId}/inspectionPlanRegistrations
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  async listInspectionPlanRegistrations(projectId, params = {}, fullResponse = false) {
    const response = await this._client.get(
      `/2.1/projects/${projectId}/inspectionPlanRegistrations`,
      params,
    );
    const result = convertToModel(
      response,
      InspectionPlanRegistrationsListResponseSchema,
      'InspectionPlanRegistrationsListResponse',
    );
    return fullResponse ? result : (result?.items || []);
  }

  async getAllInspectionPlanRegistrations(projectId, params = {}, verbose = false) {
    const items = await paginate(
      `/2.1/projects/${projectId}/inspectionPlanRegistrations`,
      this._client,
      params,
      verbose,
    );
    return convertToModelList(items, InspectionPlanRegistrationSchema, 'InspectionPlanRegistration');
  }
}

module.exports = InspectionPlansApi;
