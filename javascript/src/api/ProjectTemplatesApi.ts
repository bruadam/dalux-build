import { z } from 'zod';
import type { DaluxHttpClient } from '../http/client';
import { ProjectTemplateSchema } from '../models/projectTemplates';

/**
 * API methods for project templates.
 */
export class ProjectTemplatesApi {
  private _client: DaluxHttpClient;

  constructor(apiClient: DaluxHttpClient) {
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
