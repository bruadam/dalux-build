'use strict';

const { convertToModel } = require('../models/convert');
const { CompaniesListResponseSchema, CompanyResponseSchema } = require('../models/companies');

/**
 * API methods for managing companies on a project.
 */
class CompaniesApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Get companies on a project.
   * GET /3.1/projects/{projectId}/companies
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>} CompaniesListResponse ({ items: ProjectCompany[], metadata?, links? })
   */
  async listProjectCompanies(projectId, params = {}) {
    const response = await this._client.get(`/3.1/projects/${projectId}/companies`, params);
    return convertToModel(response, CompaniesListResponseSchema, 'CompaniesListResponse');
  }

  /**
   * Get a specific company on a project.
   * GET /3.0/projects/{projectId}/companies/{companyId}
   * @param {string} projectId
   * @param {string} companyId
   * @returns {Promise<object>} CompanyResponse ({ data: ProjectCompany, links? })
   */
  async getProjectCompany(projectId, companyId) {
    const response = await this._client.get(`/3.0/projects/${projectId}/companies/${companyId}`);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse');
  }

  /**
   * Add a company to a project.
   * POST /3.1/projects/{projectId}/companies
   * @param {string} projectId
   * @param {object} body
   * @returns {Promise<object>} CompanyResponse
   */
  async createProjectCompany(projectId, body) {
    const response = await this._client.post(`/3.1/projects/${projectId}/companies`, body);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse');
  }

  /**
   * Update a company on a project.
   * PATCH /3.0/projects/{projectId}/companies/{companyId}
   * @param {string} projectId
   * @param {string} companyId
   * @param {object} body
   * @returns {Promise<object>} CompanyResponse
   */
  async updateProjectCompany(projectId, companyId, body) {
    const response = await this._client.patch(`/3.0/projects/${projectId}/companies/${companyId}`, body);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse');
  }
}

module.exports = CompaniesApi;
