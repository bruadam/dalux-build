'use strict';

/**
 * API methods for chunked file uploads.
 */
class FileUploadApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Create a new upload slot and return a GUID pointing to that slot.
   * POST /1.0/projects/{projectId}/file_areas/{fileAreaId}/upload
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {object} body
   * @returns {Promise<object>}
   */
  createUpload(projectId, fileAreaId, body) {
    return this._client.post(
      `/1.0/projects/${projectId}/file_areas/${fileAreaId}/upload`,
      body,
    );
  }

  /**
   * Upload a part of a file.
   * POST /1.0/projects/{projectId}/file_areas/{fileAreaId}/upload/{uploadGuid}
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} uploadGuid
   * @param {Buffer|Uint8Array} chunk - Binary file chunk
   * @returns {Promise<object>}
   */
  uploadFilePart(projectId, fileAreaId, uploadGuid, chunk) {
    return this._client.post(
      `/1.0/projects/${projectId}/file_areas/${fileAreaId}/upload/${uploadGuid}`,
      chunk,
      {},
      { headers: { 'Content-Type': 'application/octet-stream' } },
    );
  }

  /**
   * Finish uploading a file (finalize the upload).
   * POST /2.0/projects/{projectId}/file_areas/{fileAreaId}/upload/{uploadGuid}/finalize
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} uploadGuid
   * @param {object} body
   * @returns {Promise<object>}
   */
  finishUpload(projectId, fileAreaId, uploadGuid, body) {
    return this._client.post(
      `/2.0/projects/${projectId}/file_areas/${fileAreaId}/upload/${uploadGuid}/finalize`,
      body,
    );
  }
}

module.exports = FileUploadApi;
