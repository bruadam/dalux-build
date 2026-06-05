'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * API methods for files within a file area.
 */
class FilesApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all files on the given project and file area.
   * GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {object} [params] - Optional params (e.g. folderId, updatedAfter, includeProperties). The files endpoint does not support OData $filter.
   * @returns {Promise<object>}
   */
  listFiles(projectId, fileAreaId, params = {}) {
    return this._client.get(
      `/6.1/projects/${projectId}/file_areas/${fileAreaId}/files`,
      params,
    );
  }

  /**
   * Retrieve all files by following bookmark pagination (metadata.totalRemainingItems).
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {object} [params]
   * @param {boolean} [verbose=false]
   * @returns {Promise<object[]>}
   */
  async getAllFiles(projectId, fileAreaId, params = {}, verbose = false) {
    const allItems = [];
    let currentParams = { ...params };
    let hasNextPage = true;
    const urlPath = `/6.1/projects/${projectId}/file_areas/${fileAreaId}/files`;

    while (hasNextPage) {
      const response = await this._client.get(urlPath, currentParams);
      const items = response && response.items;
      if (items && items.length) {
        allItems.push(...items);
      }
      const remaining = ((response && response.metadata) || {}).totalRemainingItems ?? 0;
      if (verbose) {
        console.log(`Retrieved ${allItems.length} files so far, ${remaining} remaining...`);
      }
      if (!items || !items.length || remaining === 0) {
        hasNextPage = false;
      } else {
        const nextLink = (response.links || []).find((l) => l.rel === 'nextPage');
        if (nextLink) {
          const bookmark = new URL(nextLink.href).searchParams.get('bookmark');
          currentParams = { ...params, bookmark };
        } else {
          hasNextPage = false;
        }
      }
    }
    if (verbose) {
      console.log(`Done. Total files retrieved: ${allItems.length}`);
    }
    return allItems;
  }

  /**
   * All files in a folder (filters getAllFiles by data.folderId).
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} folderId
   * @param {object} [params]
   * @param {boolean} [verbose=false]
   * @returns {Promise<object[]>}
   */
  async getAllFilesInFolder(projectId, fileAreaId, folderId, params = {}, verbose = false) {
    const allFiles = await this.getAllFiles(projectId, fileAreaId, params, verbose);
    const filtered = allFiles.filter((f) => ((f.data) || {}).folderId === folderId);
    if (verbose) {
      console.log(`Files matching folder '${folderId}': ${filtered.length}`);
    }
    return filtered;
  }

  /**
   * Download a file from a direct download URL using X-API-KEY (same as Python client).
   * @param {string} downloadLink
   * @param {string} fileName
   * @param {string} [savePath] - Directory to save into (default: current working directory)
   * @returns {Promise<string>} Absolute path to saved file
   */
  async downloadFileFromLink(downloadLink, fileName, savePath) {
    const apiKey = this._client.configuration.apiKey;
    const dir = savePath || '.';
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, fileName);

    const response = await axios.get(downloadLink, {
      headers: { 'X-API-KEY': apiKey },
      responseType: 'stream',
      validateStatus: () => true,
    });
    if (response.status !== 200) {
      throw new Error(`Failed to download file. Status code: ${response.status}`);
    }
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(filePath);
      response.data.pipe(ws);
      response.data.on('error', reject);
      ws.on('finish', () => resolve());
      ws.on('error', reject);
    });
    return path.resolve(filePath);
  }

  /**
   * GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId}
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} fileId
   * @param {{ download?: boolean, savePath?: string }} [options] - If download is true, saves file and sets downloadedFilePath on the returned object
   * @returns {Promise<object>}
   */
  async getFile(projectId, fileAreaId, fileId, options = {}) {
    const fileInfo = await this._client.get(
      `/5.0/projects/${projectId}/file_areas/${fileAreaId}/files/${fileId}`,
    );
    if (options.download && fileInfo && fileInfo.data && fileInfo.data.downloadLink) {
      const name = fileInfo.data.fileName || fileId;
      const downloadedPath = await this.downloadFileFromLink(
        fileInfo.data.downloadLink,
        name,
        options.savePath,
      );
      fileInfo.downloadedFilePath = downloadedPath;
    }
    return fileInfo;
  }

  /**
   * Download all files in a folder, with optional keyword / extension filters (Python parity).
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} folderId
   * @param {string} [savePath]
   * @param {object} [opts] - filenameKeywords, filenameKeywordsMatch ('any'|'all'), filenameExtensions, params, verbose
   * @returns {Promise<Array<{ fileName: string, downloadedFilePath: string }>>}
   */
  async bulkDownloadFolder(projectId, fileAreaId, folderId, savePath, opts = {}) {
    if (typeof savePath === 'object' && savePath !== null && !Array.isArray(savePath)) {
      opts = savePath;
      savePath = undefined;
    }
    const {
      filenameKeywords = null,
      filenameKeywordsMatch = 'any',
      filenameExtensions = null,
      params = {},
      verbose = false,
    } = opts;

    let files = await this.getAllFilesInFolder(projectId, fileAreaId, folderId, params, verbose);

    if (filenameKeywords && filenameKeywords.length) {
      const kws = filenameKeywords.map((kw) => String(kw).toLowerCase());
      const matchFn =
        filenameKeywordsMatch === 'all'
          ? (name) => kws.every((kw) => name.includes(kw))
          : (name) => kws.some((kw) => name.includes(kw));
      files = files.filter((f) => {
        const name = (((f.data) || {}).fileName) || '';
        return matchFn(name.toLowerCase());
      });
      if (verbose) {
        console.log(
          `Files matching fileName keywords ${JSON.stringify(filenameKeywords)} (${filenameKeywordsMatch}): ${files.length}`,
        );
      }
    }

    if (filenameExtensions && filenameExtensions.length) {
      const normExts = filenameExtensions.map((ext) =>
        (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase(),
      );
      const before = files.length;
      files = files.filter((f) => {
        const n = (((f.data) || {}).fileName) || ''.toLowerCase();
        return normExts.some((ext) => n.endsWith(ext));
      });
      if (verbose) {
        console.log(`Files matching fileName extensions ${JSON.stringify(normExts)}: ${files.length} / ${before}`);
      }
    }

    const results = [];
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      const data = f.data || {};
      const fileName = data.fileName || data.fileId || `file_${i + 1}`;
      const downloadLink = data.downloadLink;
      if (!downloadLink) {
        if (verbose) {
          console.log(`  [${i + 1}/${files.length}] Skipping '${fileName}' (no downloadLink)`);
        }
        continue;
      }
      if (verbose) {
        console.log(`  [${i + 1}/${files.length}] Downloading '${fileName}'...`);
      }
      const downloadedFilePath = await this.downloadFileFromLink(downloadLink, fileName, savePath);
      results.push({ fileName, downloadedFilePath });
    }
    if (verbose) {
      console.log(`Bulk download complete. ${results.length} file(s) downloaded.`);
    }
    return results;
  }

  /**
   * Download files by id (fetches metadata per id then streams from downloadLink).
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string[]} fileIds
   * @param {string} [savePath]
   * @param {{ verbose?: boolean }} [options]
   * @returns {Promise<Array<{ fileId: string, fileName: string, downloadedFilePath: string }>>}
   */
  async bulkDownloadByIds(projectId, fileAreaId, fileIds, savePath, options = {}) {
    if (typeof savePath === 'object' && savePath !== null) {
      options = savePath;
      savePath = undefined;
    }
    const { verbose = false } = options;
    const results = [];
    const total = fileIds.length;
    for (let i = 0; i < fileIds.length; i += 1) {
      const fileId = fileIds[i];
      const fileInfo = await this.getFile(projectId, fileAreaId, fileId);
      const data = (fileInfo && fileInfo.data) || {};
      const fileName = data.fileName || fileId;
      const downloadLink = data.downloadLink;
      if (!downloadLink) {
        if (verbose) {
          console.log(`  [${i + 1}/${total}] Skipping '${fileName}' (no downloadLink)`);
        }
        continue;
      }
      if (verbose) {
        console.log(`  [${i + 1}/${total}] Downloading '${fileName}'...`);
      }
      const downloadedFilePath = await this.downloadFileFromLink(downloadLink, fileName, savePath);
      results.push({ fileId, fileName, downloadedFilePath });
    }
    if (verbose) {
      console.log(`Done. ${results.length}/${total} file(s) downloaded.`);
    }
    return results;
  }

  /**
   * Retrieve properties mapping for a specific file.
   * GET /1.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId}/properties/1.0/mappings
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} fileId
   * @returns {Promise<object>}
   */
  getFilePropertiesMapping(projectId, fileAreaId, fileId) {
    return this._client.get(
      `/1.0/projects/${projectId}/file_areas/${fileAreaId}/files/${fileId}/properties/1.0/mappings`,
    );
  }

  /**
   * Retrieve valid property values for a specific file property mapping.
   * GET /1.0/projects/{projectId}/file_areas/{fileAreaId}/files/properties/1.0/mappings/{filePropertyId}/values
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} filePropertyId
   * @returns {Promise<object>}
   */
  getFilePropertyMappingValues(projectId, fileAreaId, filePropertyId) {
    return this._client.get(
      `/1.0/projects/${projectId}/file_areas/${fileAreaId}/files/properties/1.0/mappings/${filePropertyId}/values`,
    );
  }
}

module.exports = FilesApi;
