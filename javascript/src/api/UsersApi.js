'use strict';

const { convertToModel } = require('../models/convert');
const { UserResponseSchema, UsersListResponseSchema } = require('../models/users');

/**
 * API methods for users.
 */
class UsersApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Get a specific user.
   * GET /1.1/users/{userId}
   * @param {string} userId
   * @returns {Promise<object>} UserResponse ({ data: User, links? })
   */
  async getUser(userId) {
    const response = await this._client.get(`/1.1/users/${userId}`);
    return convertToModel(response, UserResponseSchema, 'UserResponse');
  }

  /**
   * Get users on a project.
   * GET /1.2/projects/{projectId}/users
   * @param {string} projectId
   * @param {object} [params]
   * @returns {Promise<object>} UsersListResponse ({ items: ProjectUser[], metadata?, links? })
   */
  async listProjectUsers(projectId, params = {}) {
    const response = await this._client.get(`/1.2/projects/${projectId}/users`, params);
    return convertToModel(response, UsersListResponseSchema, 'UsersListResponse');
  }

  /**
   * Get a specific user on a project.
   * GET /1.1/projects/{projectId}/users/{userId}
   * @param {string} projectId
   * @param {string} userId
   * @returns {Promise<object>}
   */
  getProjectUser(projectId, userId) {
    return this._client.get(`/1.1/projects/${projectId}/users/${userId}`);
  }
}

module.exports = UsersApi;
