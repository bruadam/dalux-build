import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { convertToModel } from '../models/convert';
import { FormsListResponseSchema, FormResponseSchema } from '../models/forms';

/**
 * API methods for forms on a project.
 */
export class FormsApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve forms on a project.
   * GET /2.1/projects/{projectId}/forms
   */
  async getProjectForms(
    projectId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof FormsListResponseSchema>> {
    const response = await this._client.get(`/2.1/projects/${projectId}/forms`, params);
    return convertToModel(response, FormsListResponseSchema, 'FormsListResponse') as z.infer<
      typeof FormsListResponseSchema
    >;
  }

  /**
   * Retrieve a specific form.
   * GET /1.2/projects/{projectId}/forms/{formId}
   */
  async getForm(projectId: string, formId: string): Promise<z.infer<typeof FormResponseSchema>> {
    const response = await this._client.get(`/1.2/projects/${projectId}/forms/${formId}`);
    return convertToModel(response, FormResponseSchema, 'FormResponse') as z.infer<
      typeof FormResponseSchema
    >;
  }

  /**
   * Retrieve attachments on forms on a project in incremental updates.
   * GET /2.1/projects/{projectId}/forms/attachments
   */
  getProjectFormAttachments(projectId: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this._client.get(`/2.1/projects/${projectId}/forms/attachments`, params);
  }
}
