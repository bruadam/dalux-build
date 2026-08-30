import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { convertToModel } from '../models/convert';
import { VersionSetsListResponseSchema, VersionSetResponseSchema } from '../models/versionSets';
import { FilesListResponseSchema } from '../models/files';

/**
 * API methods for version sets.
 */
export class VersionSetsApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve the version sets on the given project.
   * GET /2.1/projects/{projectId}/version_sets
   */
  async getVersionSets(
    projectId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof VersionSetsListResponseSchema>> {
    const response = await this._client.get(`/2.1/projects/${projectId}/version_sets`, params);
    return convertToModel(response, VersionSetsListResponseSchema, 'VersionSetsListResponse') as z.infer<
      typeof VersionSetsListResponseSchema
    >;
  }

  /**
   * Retrieve a specific version set.
   * GET /2.0/projects/{projectId}/version_sets/{versionSetId}
   */
  async getVersionSet(
    projectId: string,
    versionSetId: string,
  ): Promise<z.infer<typeof VersionSetResponseSchema>> {
    const response = await this._client.get(`/2.0/projects/${projectId}/version_sets/${versionSetId}`);
    return convertToModel(response, VersionSetResponseSchema, 'VersionSetResponse') as z.infer<
      typeof VersionSetResponseSchema
    >;
  }

  /**
   * Browse all version sets on the given file area and project.
   * GET /2.1/projects/{projectId}/file_areas/{fileAreaId}/version_sets
   */
  async listFileAreaVersionSets(
    projectId: string,
    fileAreaId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof VersionSetsListResponseSchema>> {
    const response = await this._client.get(
      `/2.1/projects/${projectId}/file_areas/${fileAreaId}/version_sets`,
      params,
    );
    return convertToModel(response, VersionSetsListResponseSchema, 'VersionSetsListResponse') as z.infer<
      typeof VersionSetsListResponseSchema
    >;
  }

  /**
   * Browse all files on the given project and given version set.
   * GET /3.0/projects/{projectId}/version_sets/{versionSetId}/files
   */
  async listVersionSetFiles(
    projectId: string,
    versionSetId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof FilesListResponseSchema>> {
    const response = await this._client.get(
      `/3.0/projects/${projectId}/version_sets/${versionSetId}/files`,
      params,
    );
    return convertToModel(response, FilesListResponseSchema, 'FilesListResponse') as z.infer<
      typeof FilesListResponseSchema
    >;
  }
}
