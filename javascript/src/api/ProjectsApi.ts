import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { findByField } from '../utils/search';
import { convertToModel } from '../models/convert';
import { ProjectsListResponseSchema, ProjectResponseSchema } from '../models/projects';

type ProjectsListResponse = z.infer<typeof ProjectsListResponseSchema>;
type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

/**
 * API methods for project management.
 */
export class ProjectsApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Get all available projects.
   * GET /5.1/projects
   * Optional query parameters (e.g. updatedAfter)
   * Returns ProjectsListResponse ({ items: Project[], metadata?, links? })
   */
  async listProjects(params: Record<string, unknown> = {}): Promise<ProjectsListResponse | null> {
    const response = await this._client.get('/5.1/projects', params);
    return convertToModel(response, ProjectsListResponseSchema, 'ProjectsListResponse');
  }

  /**
   * Get a specific project.
   * GET /5.0/projects/{projectId}
   * Returns ProjectResponse ({ data: Project, links? })
   */
  async getProject(projectId: string): Promise<ProjectResponse | null> {
    const response = await this._client.get(`/5.0/projects/${projectId}`);
    return convertToModel(response, ProjectResponseSchema, 'ProjectResponse');
  }

  /**
   * Create a new project.
   * POST /5.0/projects
   * Returns ProjectResponse
   */
  async createProject(body: Record<string, unknown>): Promise<ProjectResponse | null> {
    const response = await this._client.post('/5.0/projects', body);
    return convertToModel(response, ProjectResponseSchema, 'ProjectResponse');
  }

  /**
   * Update a project.
   * PATCH /5.0/projects/{projectId}
   * Returns ProjectResponse
   */
  async updateProject(
    projectId: string,
    body: Record<string, unknown>,
  ): Promise<ProjectResponse | null> {
    const response = await this._client.patch(`/5.0/projects/${projectId}`, body);
    return convertToModel(response, ProjectResponseSchema, 'ProjectResponse');
  }

  /**
   * Get all metadata available for POST project operations.
   * GET /1.0/projects/metadata/1.0/mappings
   */
  listMetadataMappingsForProjects(): Promise<unknown> {
    return this._client.get('/1.0/projects/metadata/1.0/mappings');
  }

  /**
   * Get available values for a metadata key in POST project operations.
   * GET /1.0/projects/metadata/1.0/mappings/{key}/values
   */
  listMetadataValuesForProjects(key: string): Promise<unknown> {
    return this._client.get(`/1.0/projects/metadata/1.0/mappings/${key}/values`);
  }

  /**
   * Get metadata of a specific project.
   * GET /1.0/projects/{projectId}/metadata
   */
  listProjectMetadata(projectId: string): Promise<unknown> {
    return this._client.get(`/1.0/projects/${projectId}/metadata`);
  }

  /**
   * Get all metadata available for PATCH project operations.
   * GET /1.0/projects/{projectId}/metadata/1.0/mappings
   */
  listProjectMetadataMappings(projectId: string): Promise<unknown> {
    return this._client.get(`/1.0/projects/${projectId}/metadata/1.0/mappings`);
  }

  /**
   * Get available values for metadata in a PATCH project operation.
   * GET /1.0/projects/{projectId}/metadata/1.0/mappings/{key}/values
   */
  listProjectMetadataValues(projectId: string, key: string): Promise<unknown> {
    return this._client.get(`/1.0/projects/${projectId}/metadata/1.0/mappings/${key}/values`);
  }

  /**
   * Get a project ID by its name.
   * Returns the projectId, or null if not found.
   */
  async getProjectByName(projectName: string): Promise<string | null> {
    const response = await this.listProjects();
    const items = (response && (response as { items?: unknown[] }).items) || [];
    const project = findByField(items, 'projectName', projectName) as
      | { projectId?: string }
      | null;
    if (!project) return null;
    return project.projectId || null;
  }
}
