import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { ProjectTemplateSchema } from '../models/projectTemplates';

/**
 * API methods for project templates.
 */
export class ProjectTemplatesApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Get all available project templates on the company profile.
   * GET /1.1/projectTemplates
   */
  listProjectTemplates(
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof ProjectTemplateSchema>[]> {
    return this._client.get<z.infer<typeof ProjectTemplateSchema>[]>('/1.1/projectTemplates', params);
  }
}
