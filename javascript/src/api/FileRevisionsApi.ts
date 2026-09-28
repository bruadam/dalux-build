import type { DaluxHttpClient } from '../http/client';

/**
 * API methods for file revision content.
 */
export class FileRevisionsApi {
  private _client: DaluxHttpClient;

  constructor(apiClient: DaluxHttpClient) {
    this._client = apiClient;
  }

  /**
   * Retrieve content of a specific file revision.
   * GET /2.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId}/revisions/{fileRevisionId}/content
   * Raw binary content
   */
  async getFileRevisionContent(
    projectId: string,
    fileAreaId: string,
    fileId: string,
    fileRevisionId: string,
  ): Promise<Buffer> {
    const data = await this._client.get<ArrayBuffer>(
      `/2.0/projects/${projectId}/file_areas/${fileAreaId}/files/${fileId}/revisions/${fileRevisionId}/content`,
      {},
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(data);
  }
}
