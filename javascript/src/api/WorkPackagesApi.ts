import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { convertToModel } from '../models/convert';
import { WorkPackagesListResponseSchema } from '../models/workPackages';

/**
 * API methods for work packages on a project.
 */
export class WorkPackagesApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all work packages on the given project.
   * GET /1.0/projects/{projectId}/workpackages
   */
  async listWorkPackages(
    projectId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof WorkPackagesListResponseSchema>> {
    const response = await this._client.get(`/1.0/projects/${projectId}/workpackages`, params);
    return convertToModel(response, WorkPackagesListResponseSchema, 'WorkPackagesListResponse') as z.infer<
      typeof WorkPackagesListResponseSchema
    >;
  }
}
