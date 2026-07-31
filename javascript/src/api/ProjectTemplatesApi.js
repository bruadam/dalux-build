'use strict';

/**
 * API methods for project templates.
 */
class ProjectTemplatesApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Get all available project templates on the company profile.
   * GET /1.1/projectTemplates
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  listProjectTemplates(params = {}) {
    return this._client.get('/1.1/projectTemplates', params);
  }
}

module.exports = ProjectTemplatesApi;
