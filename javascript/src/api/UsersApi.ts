import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { convertToModel } from '../models/convert';
import { UserResponseSchema, UsersListResponseSchema } from '../models/users';

type UserResponse = z.infer<typeof UserResponseSchema>;
type UsersListResponse = z.infer<typeof UsersListResponseSchema>;

/**
 * API methods for users.
 */
export class UsersApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Get a specific user.
   * GET /1.1/users/{userId}
   * Returns UserResponse ({ data: User, links? })
   */
  async getUser(userId: string): Promise<UserResponse | null> {
    const response = await this._client.get(`/1.1/users/${userId}`);
    return convertToModel(response, UserResponseSchema, 'UserResponse');
  }

  /**
   * Get users on a project.
   * GET /1.2/projects/{projectId}/users
   * Returns UsersListResponse ({ items: ProjectUser[], metadata?, links? })
   */
  async listProjectUsers(
    projectId: string,
    params: Record<string, unknown> = {},
  ): Promise<UsersListResponse | null> {
    const response = await this._client.get(`/1.2/projects/${projectId}/users`, params);
    return convertToModel(response, UsersListResponseSchema, 'UsersListResponse');
  }

  /**
   * Get a specific user on a project.
   * GET /1.1/projects/{projectId}/users/{userId}
   */
  getProjectUser(projectId: string, userId: string): Promise<unknown> {
    return this._client.get(`/1.1/projects/${projectId}/users/${userId}`);
  }
}
