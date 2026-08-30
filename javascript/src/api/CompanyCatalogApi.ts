import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { findByField } from '../utils/search';
import { convertToModel } from '../models/convert';
import { CompaniesListResponseSchema, CompanyResponseSchema } from '../models/companies';

type CompaniesListResponse = z.infer<typeof CompaniesListResponseSchema>;
type CompanyResponse = z.infer<typeof CompanyResponseSchema>;

/**
 * API methods for the company catalog.
 */
export class CompanyCatalogApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Get companies registered in the company catalog.
   * GET /2.2/companyCatalog
   * Returns CompaniesListResponse ({ items: ProjectCompany[], metadata?, links? })
   */
  async getCompanies(
    params: Record<string, unknown> = {},
  ): Promise<CompaniesListResponse | null> {
    const response = await this._client.get('/2.2/companyCatalog', params);
    return convertToModel(response, CompaniesListResponseSchema, 'CompaniesListResponse');
  }

  /**
   * Get a specific company from the catalog.
   * GET /1.2/companyCatalog/{catalogCompanyId}
   * Returns CompanyResponse ({ data: ProjectCompany, links? })
   */
  async getCompany(catalogCompanyId: string): Promise<CompanyResponse | null> {
    const response = await this._client.get(`/1.2/companyCatalog/${catalogCompanyId}`);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse');
  }

  /**
   * Add a company to the catalog.
   * POST /2.2/companyCatalog
   * Returns CompanyResponse
   */
  async createCompany(body: Record<string, unknown>): Promise<CompanyResponse | null> {
    const response = await this._client.post('/2.2/companyCatalog', body);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse');
  }

  /**
   * Update a company in the catalog.
   * PATCH /2.1/companyCatalog/{catalogCompanyId}
   * Returns CompanyResponse
   */
  async updateCompany(
    catalogCompanyId: string,
    body: Record<string, unknown>,
  ): Promise<CompanyResponse | null> {
    const response = await this._client.patch(`/2.1/companyCatalog/${catalogCompanyId}`, body);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse');
  }

  /**
   * Get metadata of a specific company from the catalog.
   * GET /1.0/companyCatalog/{catalogCompanyId}/metadata
   */
  listCompanyMetadata(catalogCompanyId: string): Promise<unknown> {
    return this._client.get(`/1.0/companyCatalog/${catalogCompanyId}/metadata`);
  }

  /**
   * Get all metadata available for a PATCH company-catalog operation.
   * GET /1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings
   */
  listCompanyMetadataMappings(catalogCompanyId: string): Promise<unknown> {
    return this._client.get(`/1.0/companyCatalog/${catalogCompanyId}/metadata/1.0/mappings`);
  }

  /**
   * Get available values for metadata in a PATCH company-catalog operation.
   * GET /1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings/{key}/values
   */
  listCompanyMetadataValues(catalogCompanyId: string, key: string): Promise<unknown> {
    return this._client.get(
      `/1.0/companyCatalog/${catalogCompanyId}/metadata/1.0/mappings/${key}/values`,
    );
  }

  /**
   * Get all metadata available for a POST company-catalog operation.
   * GET /1.0/companyCatalog/metadata/1.0/mappings
   */
  listMetadataMappingsForCompanies(): Promise<unknown> {
    return this._client.get('/1.0/companyCatalog/metadata/1.0/mappings');
  }

  /**
   * Get available values for metadata in a POST company-catalog operation.
   * GET /1.0/companyCatalog/metadata/1.0/mappings/{key}/values
   */
  listMetadataValuesForCompanies(key: string): Promise<unknown> {
    return this._client.get(`/1.0/companyCatalog/metadata/1.0/mappings/${key}/values`);
  }

  /**
   * Get a company ID by its name from the catalog.
   * Returns the catalogCompanyId, or null if not found.
   */
  async getCompanyByName(companyName: string): Promise<string | null> {
    const response = await this.getCompanies();
    const items = (response && (response as { items?: unknown[] }).items) || [];
    const company = findByField(items, 'name', companyName) as
      | { catalogCompanyId?: string }
      | null;
    if (!company) return null;
    return company.catalogCompanyId || null;
  }
}
