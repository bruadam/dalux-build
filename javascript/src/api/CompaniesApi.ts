import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { convertToModel } from '../models/convert';
import { CompaniesListResponseSchema, CompanyResponseSchema } from '../models/companies';

/**
 * API methods for managing companies on a project.
 */
export class CompaniesApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Get companies on a project.
   * GET /3.1/projects/{projectId}/companies
   */
  async listProjectCompanies(
    projectId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof CompaniesListResponseSchema>> {
    const response = await this._client.get(`/3.1/projects/${projectId}/companies`, params);
    return convertToModel(response, CompaniesListResponseSchema, 'CompaniesListResponse') as z.infer<
      typeof CompaniesListResponseSchema
    >;
  }

  /**
   * Get a specific company on a project.
   * GET /3.0/projects/{projectId}/companies/{companyId}
   */
  async getProjectCompany(
    projectId: string,
    companyId: string,
  ): Promise<z.infer<typeof CompanyResponseSchema>> {
    const response = await this._client.get(`/3.0/projects/${projectId}/companies/${companyId}`);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse') as z.infer<
      typeof CompanyResponseSchema
    >;
  }

  /**
   * Add a company to a project.
   * POST /3.1/projects/{projectId}/companies
   */
  async createProjectCompany(
    projectId: string,
    body: Record<string, unknown>,
  ): Promise<z.infer<typeof CompanyResponseSchema>> {
    const response = await this._client.post(`/3.1/projects/${projectId}/companies`, body);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse') as z.infer<
      typeof CompanyResponseSchema
    >;
  }

  /**
   * Update a company on a project.
   * PATCH /3.0/projects/{projectId}/companies/{companyId}
   */
  async updateProjectCompany(
    projectId: string,
    companyId: string,
    body: Record<string, unknown>,
  ): Promise<z.infer<typeof CompanyResponseSchema>> {
    const response = await this._client.patch(`/3.0/projects/${projectId}/companies/${companyId}`, body);
    return convertToModel(response, CompanyResponseSchema, 'CompanyResponse') as z.infer<
      typeof CompanyResponseSchema
    >;
  }
}
