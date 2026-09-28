import type { DaluxHttpClient } from '../http/client';

/**
 * API methods for chunked file uploads.
 */
export class FileUploadApi {
  private _client: DaluxHttpClient;

  constructor(apiClient: DaluxHttpClient) {
    this._client = apiClient;
  }

  /**
   * Create a new upload slot and return a GUID pointing to that slot.
   * POST /1.0/projects/{projectId}/file_areas/{fileAreaId}/upload
   */
  createUpload(
    projectId: string,
    fileAreaId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this._client.post(
      `/1.0/projects/${projectId}/file_areas/${fileAreaId}/upload`,
      body,
    );
  }

  /**
   * Upload a part of a file.
   * POST /1.0/projects/{projectId}/file_areas/{fileAreaId}/upload/{uploadGuid}
   * chunk - Binary file chunk
   */
  uploadFilePart(
    projectId: string,
    fileAreaId: string,
    uploadGuid: string,
    chunk: Buffer | Uint8Array,
  ): Promise<Record<string, unknown>> {
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
   */
  finishUpload(
    projectId: string,
    fileAreaId: string,
    uploadGuid: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this._client.post(
      `/2.0/projects/${projectId}/file_areas/${fileAreaId}/upload/${uploadGuid}/finalize`,
      body,
    );
  }
}
