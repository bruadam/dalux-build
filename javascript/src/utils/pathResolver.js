'use strict';

const { findByField } = require('./search');

/**
 * Resolve a file area by its displayed name for a project.
 *
 * @param {object} apiClient - ApiClient instance.
 * @param {string} projectId
 * @param {string} fileAreaName
 * @param {object} [fileAreasCache] - Optional mutable cache {name -> fileArea item}.
 * @returns {Promise<object|null>} File area item or null.
 */
async function resolveFileAreaByName(apiClient, projectId, fileAreaName, fileAreasCache) {
  if (fileAreasCache && fileAreasCache[fileAreaName]) {
    return fileAreasCache[fileAreaName];
  }

  // Inline import to avoid circular deps
  const FileAreasApi = require('../api/FileAreasApi');
  const response = await new FileAreasApi(apiClient).getFileAreas(projectId);
  const items = (response && response.items) || [];

  if (fileAreasCache) {
    for (const item of items) {
      const name = (item.data || {}).fileAreaName || (item.data || {}).name || item.fileAreaName || item.name;
      if (name) fileAreasCache[name] = item;
    }
  }

  return (
    findByField(items, 'fileAreaName', fileAreaName, (x) => x.data || x) ||
    findByField(items, 'name', fileAreaName, (x) => x.data || x)
  );
}

/**
 * Resolve "FileAreaName/Folder/SubFolder" to { fileAreaId, folderId }.
 *
 * @param {object} apiClient - ApiClient instance.
 * @param {string} projectId
 * @param {string} path - e.g. "Files/4_Design/C07_Geometry"
 * @param {object} [opts]
 * @param {boolean} [opts.verbose=false]
 * @param {object} [opts.fileAreasCache]
 * @param {object} [opts.foldersCache]
 * @param {object} [opts.resolvedPathsCache]
 * @returns {Promise<{ fileAreaId: string|null, folderId: string|null }>}
 */
async function resolveFolderIdFromNamedPath(apiClient, projectId, path, opts = {}) {
  const { verbose = false, fileAreasCache, foldersCache, resolvedPathsCache } = opts;

  if (resolvedPathsCache && resolvedPathsCache[path]) {
    return resolvedPathsCache[path];
  }

  const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { fileAreaId: null, folderId: null };

  const fileAreaName = parts[0];
  const folderNames = parts.slice(1);

  const fileAreaItem = await resolveFileAreaByName(apiClient, projectId, fileAreaName, fileAreasCache);
  if (!fileAreaItem) {
    if (verbose) console.log(`Could not resolve file area: ${fileAreaName}`);
    return { fileAreaId: null, folderId: null };
  }

  const fileAreaId =
    (fileAreaItem.data || {}).fileAreaId ||
    (fileAreaItem.data || {}).id ||
    fileAreaItem.fileAreaId ||
    fileAreaItem.id;

  // Fetch all folders for this file area (with cache)
  let folders = foldersCache && foldersCache[fileAreaId];
  if (!folders) {
    if (verbose) {
      console.log(`GET /5.1/projects/${projectId}/file_areas/${fileAreaId}/folders`);
    }
    const FoldersApi = require('../api/FoldersApi');
    folders = await new FoldersApi(apiClient).getAllFolders(projectId, fileAreaId);
    if (foldersCache) foldersCache[fileAreaId] = folders;
  }

  // Build a lookup: (parentFolderId, folderName) -> folder
  // Collect all valid folder IDs first
  const allFolderIds = new Set();
  for (const f of folders) {
    const data = f.data || f;
    const fid = data.folderId || data.id;
    if (fid) allFolderIds.add(fid);
  }

  const folderIndex = new Map();
  for (const f of folders) {
    const data = f.data || f;
    const fid = data.folderId || data.id;
    const pid = data.parentFolderId || data.parentId || null;
    const name = data.folderName || data.name || '';
    // Treat root-level folders (parent not in folder list) as children of null
    const parentKey = allFolderIds.has(pid) ? pid : null;
    folderIndex.set(`${parentKey}|||${name}`, fid);
  }

  let parentFolderId = null;
  for (const folderName of folderNames) {
    const key = `${parentFolderId}|||${folderName}`;
    const fid = folderIndex.get(key);
    if (!fid) {
      if (verbose) console.log(`Could not resolve folder segment: ${folderName}`);
      const result = { fileAreaId, folderId: null };
      if (resolvedPathsCache) resolvedPathsCache[path] = result;
      return result;
    }
    parentFolderId = fid;
  }

  const result = { fileAreaId, folderId: parentFolderId };
  if (resolvedPathsCache) resolvedPathsCache[path] = result;
  return result;
}

module.exports = { resolveFileAreaByName, resolveFolderIdFromNamedPath };
