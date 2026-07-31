'use strict';

/**
 * API methods for file revision content.
 */
class FileRevisionsApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve content of a specific file revision.
   * GET /2.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId}/revisions/{fileRevisionId}/content
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} fileId
   * @param {string} fileRevisionId
   * @returns {Promise<Buffer>} Raw binary content
   */
  getFileRevisionContent(projectId, fileAreaId, fileId, fileRevisionId) {
    return this._client.get(
      `/2.0/projects/${projectId}/file_areas/${fileAreaId}/files/${fileId}/revisions/${fileRevisionId}/content`,
      {},
    );
  }
}

module.exports = FileRevisionsApi;
