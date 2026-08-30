import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { findByField } from '../utils/search';
import { convertToModel } from '../models/convert';
import { FileAreaSchema, FileAreasListResponseSchema } from '../models/fileAreas';

/**
 * API methods for file areas on a project.
 */
export class FileAreasApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve the file areas on the given project.
   * GET /5.1/projects/{projectId}/file_areas
   */
  async getFileAreas(
    projectId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof FileAreasListResponseSchema>> {
    const response = await this._client.get(`/5.1/projects/${projectId}/file_areas`, params);
    return convertToModel(response, FileAreasListResponseSchema, 'FileAreasListResponse') as z.infer<
      typeof FileAreasListResponseSchema
    >;
  }

  /**
   * Retrieve a specific file area.
   * GET /1.0/projects/{projectId}/file_areas/{fileAreaId}
   */
  async getFileArea(
    projectId: string,
    fileAreaId: string,
  ): Promise<z.infer<typeof FileAreaSchema>> {
    const response = await this._client.get(`/1.0/projects/${projectId}/file_areas/${fileAreaId}`);
    return convertToModel(response, FileAreaSchema, 'FileArea') as z.infer<typeof FileAreaSchema>;
  }

  /**
   * Get a file area ID by its name for a project.
   */
  async getFileAreaByName(projectId: string, fileAreaName: string): Promise<string | null> {
    const response = await this.getFileAreas(projectId);
    const items = (response && (response as Record<string, unknown>).items as Record<string, unknown>[]) || [];
    const area = findByField(items, 'fileAreaName', fileAreaName);
    if (!area) return null;
    return (area.fileAreaId as string) || null;
  }
}
