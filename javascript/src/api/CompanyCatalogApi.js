'use strict';

const { findByField } = require('../utils/search');
const { convertToModel } = require('../models/convert');
const { CompaniesListResponseSchema, CompanyResponseSchema } = require('../models/companies');

/**
 * API methods for the company catalog.
 */
class CompanyCatalogApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Get companies registered in the company catalog.
   * GET /2.2/companyCatalog
   * @param {object} [params]
   * @returns {Promise<object>} CompaniesListResponse ({ items: ProjectCompany[], metadata?, links? })
   */
  async getCompanies(params = {}) {
    const response = await this._client.get('/2.2/companyCatalog', params);
    return convertToModel(response, CompaniesListResponseSchema, 'CompaniesListResponse');
  }

  /**
   * Get a specific company from the catalog.
   * GET /1.2/companyCatalog/{catalogCompanyId}
   * @param {string} catalogCompanyId
   * @returns {Promise<object>} CompanyResponse ({ data: ProjectCompany, links? })
   */
  async getCompany(catalogCompanyId) {
    const response = await this._client.get(`/1.2/companyCatalog/${catalogCompanyId}`);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse');
  }

  /**
   * Add a company to the catalog.
   * POST /2.2/companyCatalog
   * @param {object} body
   * @returns {Promise<object>} CompanyResponse
   */
  async createCompany(body) {
    const response = await this._client.post('/2.2/companyCatalog', body);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse');
  }

  /**
   * Update a company in the catalog.
   * PATCH /2.1/companyCatalog/{catalogCompanyId}
   * @param {string} catalogCompanyId
   * @param {object} body
   * @returns {Promise<object>} CompanyResponse
   */
  async updateCompany(catalogCompanyId, body) {
    const response = await this._client.patch(`/2.1/companyCatalog/${catalogCompanyId}`, body);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse');
  }

  /**
   * Get metadata of a specific company from the catalog.
   * GET /1.0/companyCatalog/{catalogCompanyId}/metadata
   * @param {string} catalogCompanyId
   * @returns {Promise<object>}
   */
  listCompanyMetadata(catalogCompanyId) {
    return this._client.get(`/1.0/companyCatalog/${catalogCompanyId}/metadata`);
  }

  /**
   * Get all metadata available for a PATCH company-catalog operation.
   * GET /1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings
   * @param {string} catalogCompanyId
   * @returns {Promise<object>}
   */
  listCompanyMetadataMappings(catalogCompanyId) {
    return this._client.get(`/1.0/companyCatalog/${catalogCompanyId}/metadata/1.0/mappings`);
  }

  /**
   * Get available values for metadata in a PATCH company-catalog operation.
   * GET /1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings/{key}/values
   * @param {string} catalogCompanyId
   * @param {string} key
   * @returns {Promise<object>}
   */
  listCompanyMetadataValues(catalogCompanyId, key) {
    return this._client.get(
      `/1.0/companyCatalog/${catalogCompanyId}/metadata/1.0/mappings/${key}/values`,
    );
  }

  /**
   * Get all metadata available for a POST company-catalog operation.
   * GET /1.0/companyCatalog/metadata/1.0/mappings
   * @returns {Promise<object>}
   */
  listMetadataMappingsForCompanies() {
    return this._client.get('/1.0/companyCatalog/metadata/1.0/mappings');
  }

  /**
   * Get available values for metadata in a POST company-catalog operation.
   * GET /1.0/companyCatalog/metadata/1.0/mappings/{key}/values
   * @param {string} key
   * @returns {Promise<object>}
   */
  listMetadataValuesForCompanies(key) {
    return this._client.get(`/1.0/companyCatalog/metadata/1.0/mappings/${key}/values`);
  }

  /**
   * Get a company ID by its name from the catalog.
   * @param {string} companyName
   * @returns {Promise<string|null>} The catalogCompanyId, or null if not found.
   */
  async getCompanyByName(companyName) {
    const response = await this.getCompanies();
    const items = (response && response.items) || [];
    const company = findByField(items, 'name', companyName);
    if (!company) return null;
    return company.catalogCompanyId || null;
  }
}

module.exports = CompanyCatalogApi;
