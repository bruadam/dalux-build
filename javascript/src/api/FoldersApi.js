'use strict';

const { paginate } = require('../utils/pagination');
const { findByField } = require('../utils/search');
const { validateProjectId, validateFileAreaId } = require('../utils/validation');
const { resolveFolderIdFromNamedPath } = require('../utils/pathResolver');
const { convertToModel, convertToModelList } = require('../models/convert');
const { FolderSchema, FolderResponseSchema, FoldersListResponseSchema } = require('../models/folders');

/**
 * API methods for folders within a file area.
 */
class FoldersApi {
  /**
   * @param {import('../apiClient')} apiClient
   */
  constructor(apiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all folders on the given project and file area (single page).
   * GET /5.1/projects/{projectId}/file_areas/{fileAreaId}/folders
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {object} [params]
   * @returns {Promise<object>}
   */
  async listFolders(projectId, fileAreaId, params = {}) {
    const response = await this._client.get(
      `/5.1/projects/${projectId}/file_areas/${fileAreaId}/folders`,
      params,
    );
    return convertToModel(response, FoldersListResponseSchema, 'FoldersListResponse');
  }

  /**
   * Retrieve all folders by following bookmark pagination automatically.
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {object} [params]
   * @param {boolean} [verbose=false]
   * @returns {Promise<object[]>} All folder items across all pages.
   */
  async getAllFolders(projectId, fileAreaId, params = {}, verbose = false) {
    validateProjectId(projectId);
    validateFileAreaId(fileAreaId);
    const endpoint = `/5.1/projects/${projectId}/file_areas/${fileAreaId}/folders`;
    const raw = await paginate(endpoint, this._client, params, verbose);
    return convertToModelList(raw, FolderSchema, 'Folder');
  }

  /**
   * Retrieve a specific folder.
   * GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/folders/{folderId}
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} folderId
   * @returns {Promise<object>}
   */
  async getFolder(projectId, fileAreaId, folderId) {
    const response = await this._client.get(
      `/5.0/projects/${projectId}/file_areas/${fileAreaId}/folders/${folderId}`,
    );
    return convertToModel(response, FolderResponseSchema, 'FolderResponse');
  }

  /**
   * Get a folder using a full path starting with the file area name.
   * e.g. "Files/4_Design/C07_Geometry"
   * @param {string} projectId
   * @param {string} path - Full path starting with file area name.
   * @param {boolean} [verbose=false]
   * @returns {Promise<object|null>} Folder response or null if not found.
   */
  async getFolderByPath(projectId, path, verbose = false) {
    validateProjectId(projectId);
    const { fileAreaId, folderId } = await resolveFolderIdFromNamedPath(
      this._client, projectId, path, { verbose },
    );
    if (!fileAreaId || !folderId) return null;
    return this.getFolder(projectId, fileAreaId, folderId);
  }

  /**
   * Retrieve all properties for each file type in a specific folder.
   * GET /1.0/projects/{projectId}/file_areas/{fileAreaId}/folders/{folderId}/files/properties/1.0/mappings
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} folderId
   * @returns {Promise<object>}
   */
  getFolderFilesProperties(projectId, fileAreaId, folderId) {
    return this._client.get(
      `/1.0/projects/${projectId}/file_areas/${fileAreaId}/folders/${folderId}/files/properties/1.0/mappings`,
    );
  }

  /**
   * Get a folder by name within a file area, optionally filtered by parent folder.
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} folderName
   * @param {string|null} [parentFolderId=null]
   * @returns {Promise<object|null>} Folder item or null if not found.
   */
  async getFolderByName(projectId, fileAreaId, folderName, parentFolderId = null) {
    validateProjectId(projectId);
    validateFileAreaId(fileAreaId);
    const allFolders = await this.getAllFolders(projectId, fileAreaId);
    const folder = findByField(allFolders, 'folderName', folderName);
    if (!folder) return null;
    if (parentFolderId != null && folder.parentFolderId !== parentFolderId) {
      return null;
    }
    return convertToModel({ data: folder }, FolderResponseSchema, 'FolderResponse');
  }

  /**
   * Resolve a folder path (e.g. "Folder1/Folder2") to a folder ID.
   * Supports wildcard matching with * in path segments.
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {string} folderPath - e.g. "Folder1/SubFolder" or a wildcard path ("*" matches any single segment)
   * @param {boolean} [verbose=false]
   * @returns {Promise<string|null>} Folder ID or null if not found.
   */
  async getFileAreaTreeByPath(projectId, fileAreaId, folderPath, verbose = false) {
    const allFolders = await this.getAllFolders(projectId, fileAreaId);

    const cleanPath = folderPath.replace(/^\/|\/$/g, '');
    const pathParts = cleanPath.split('/').map((p) => p.trim()).filter(Boolean);
    if (!pathParts.length) return null;

    function getData(item) {
      return item.data || item;
    }
    function getFid(item) {
      const d = getData(item);
      return d.folderId || d.id || null;
    }
    function getPid(item) {
      const d = getData(item);
      return d.parentFolderId || d.parentId || '';
    }
    function getName(item) {
      const d = getData(item);
      return d.folderName || d.name || '';
    }

    // Collect valid folder IDs
    const validFolderIds = new Set(allFolders.map(getFid).filter(Boolean));
    const fileAreaRootId = fileAreaId;

    let candidateParentIds = new Set([fileAreaRootId, null, '']);

    for (const segment of pathParts) {
      const pattern = segment.toLowerCase();
      const nextCandidates = new Set();
      for (const item of allFolders) {
        const fid = getFid(item);
        const pid = getPid(item);
        const name = getName(item).toLowerCase();
        // The folder's effective parent: if pid is not in validFolderIds, treat as root
        const effectivePid = validFolderIds.has(pid) ? pid : fileAreaRootId;
        if (candidateParentIds.has(effectivePid) && _fnmatch(name, pattern)) {
          if (fid) nextCandidates.add(fid);
        }
      }
      if (!nextCandidates.size) {
        if (verbose) console.log(`Folder segment '${segment}' not found`);
        return null;
      }
      candidateParentIds = nextCandidates;
    }

    const result = [...candidateParentIds];
    if (result.length === 1) return result[0];
    if (result.length > 1) {
      if (verbose) console.log(`Multiple folders match path '${folderPath}'`);
      return result[0];
    }
    return null;
  }

  /**
   * Build the complete folder+file tree for a file area.
   * Fetches all folders (and optionally all files) and assembles them into a nested tree.
   * When *filesApi* is provided, folders and files are fetched concurrently.
   *
   * Each node has the shape:
   * ```
   * { id, name, path, raw, children: [...], files: [...] }
   * ```
   * The returned root node represents the file-area root (id=null).
   *
   * @param {string} projectId
   * @param {string} fileAreaId
   * @param {object|null} [filesApi] - Optional FilesApi instance; when provided files are
   *   fetched in parallel and attached to their folder nodes.
   * @param {boolean} [verbose=false]
   * @returns {Promise<object>} Root tree node.
   */
  async getFileAreaTree(projectId, fileAreaId, filesApi = null, verbose = false) {
    let allFolders, allFiles;

    if (filesApi) {
      [allFolders, allFiles] = await Promise.all([
        this.getAllFolders(projectId, fileAreaId, {}, verbose),
        filesApi.getAllFiles(projectId, fileAreaId, {}, verbose),
      ]);
    } else {
      allFolders = await this.getAllFolders(projectId, fileAreaId, {}, verbose);
      allFiles = [];
    }

    if (verbose) {
      console.log(`Building tree: ${allFolders.length} folder(s), ${allFiles.length} file(s)`);
    }

    function fid(item) {
      const d = item.data || item;
      return d.folderId || d.id || null;
    }
    function pid(item) {
      const d = item.data || item;
      return d.parentFolderId || d.parentId || null;
    }
    function name(item) {
      const d = item.data || item;
      return d.folderName || d.name || fid(item) || '?';
    }

    // Build node map
    const nodes = {};
    for (const folder of allFolders) {
      const id = fid(folder);
      if (!id) continue;
      nodes[id] = { id, name: name(folder), path: '', raw: folder, children: [], files: [] };
    }

    // Wire parent→child
    const root = { id: null, name: fileAreaId, path: '', raw: null, children: [], files: [] };
    const validIds = new Set(Object.keys(nodes));
    for (const folder of allFolders) {
      const id = fid(folder);
      if (!id) continue;
      const parentId = pid(folder);
      const parent = (parentId && validIds.has(parentId)) ? nodes[parentId] : root;
      parent.children.push(nodes[id]);
    }

    // Compute paths
    function setPaths(node, parentPath) {
      node.path = parentPath ? `${parentPath}/${node.name}` : node.name;
      for (const child of node.children) setPaths(child, node.path);
    }
    for (const child of root.children) setPaths(child, '');

    // Attach files to their folder nodes
    for (const f of allFiles) {
      const folderIdVal = (f.data || {}).folderId || f.folderId || null;
      const target = (folderIdVal && nodes[folderIdVal]) ? nodes[folderIdVal] : root;
      target.files.push(f);
    }

    return root;
  }
}

/**
 * Simple fnmatch-style wildcard matching (only * is supported).
 * @param {string} str
 * @param {string} pattern
 * @returns {boolean}
 */
function _fnmatch(str, pattern) {
  if (!pattern.includes('*')) return str === pattern;
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(str);
}

module.exports = FoldersApi;
