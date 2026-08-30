import { findByField } from './search';

type AnyRecord = Record<string, unknown>;

export interface ResolvedFolderPath {
  fileAreaId: string | null;
  folderId: string | null;
}

export interface PathResolverOptions {
  verbose?: boolean;
  fileAreasCache?: Record<string, AnyRecord>;
  foldersCache?: Record<string, AnyRecord[]>;
  resolvedPathsCache?: Record<string, ResolvedFolderPath>;
}

/**
 * Resolve a file area by its displayed name for a project.
 */
export async function resolveFileAreaByName(
  apiClient: unknown,
  projectId: string,
  fileAreaName: string,
  fileAreasCache?: Record<string, AnyRecord>,
): Promise<AnyRecord | null> {
  if (fileAreasCache && fileAreasCache[fileAreaName]) {
    return fileAreasCache[fileAreaName];
  }

  // Inline require to avoid a circular dependency with FileAreasApi.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { FileAreasApi } = require('../api/FileAreasApi') as typeof import('../api/FileAreasApi');
  const response = await new FileAreasApi(apiClient as never).getFileAreas(projectId);
  const items = ((response && (response as AnyRecord).items) as AnyRecord[]) || [];

  if (fileAreasCache) {
    for (const item of items) {
      const data = (item.data as AnyRecord) || {};
      const name = (data.fileAreaName as string) || (data.name as string) || (item.fileAreaName as string) || (item.name as string);
      if (name) fileAreasCache[name] = item;
    }
  }

  return (
    findByField(items, 'fileAreaName', fileAreaName, (x) => (x.data as AnyRecord) || x) ||
    findByField(items, 'name', fileAreaName, (x) => (x.data as AnyRecord) || x)
  );
}

/**
 * Resolve "FileAreaName/Folder/SubFolder" to { fileAreaId, folderId }.
 */
export async function resolveFolderIdFromNamedPath(
  apiClient: unknown,
  projectId: string,
  path: string,
  opts: PathResolverOptions = {},
): Promise<ResolvedFolderPath> {
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

  const fileAreaData = (fileAreaItem.data as AnyRecord) || {};
  const fileAreaId =
    (fileAreaData.fileAreaId as string) ||
    (fileAreaData.id as string) ||
    (fileAreaItem.fileAreaId as string) ||
    (fileAreaItem.id as string);

  let folders = foldersCache && foldersCache[fileAreaId];
  if (!folders) {
    if (verbose) {
      console.log(`GET /5.1/projects/${projectId}/file_areas/${fileAreaId}/folders`);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { FoldersApi } = require('../api/FoldersApi') as typeof import('../api/FoldersApi');
    folders = (await new FoldersApi(apiClient as never).getAllFolders(projectId, fileAreaId)) as AnyRecord[];
    if (foldersCache) foldersCache[fileAreaId] = folders;
  }

  const allFolderIds = new Set<string>();
  for (const f of folders) {
    const data = (f.data as AnyRecord) || f;
    const fid = (data.folderId as string) || (data.id as string);
    if (fid) allFolderIds.add(fid);
  }

  const folderIndex = new Map<string, string>();
  for (const f of folders) {
    const data = (f.data as AnyRecord) || f;
    const fid = (data.folderId as string) || (data.id as string);
    const pid = ((data.parentFolderId as string) || (data.parentId as string) || null) as string | null;
    const name = (data.folderName as string) || (data.name as string) || '';
    const parentKey = pid && allFolderIds.has(pid) ? pid : null;
    folderIndex.set(`${parentKey}|||${name}`, fid);
  }

  let parentFolderId: string | null = null;
  for (const folderName of folderNames) {
    const key = `${parentFolderId}|||${folderName}`;
    const fid = folderIndex.get(key);
    if (!fid) {
      if (verbose) console.log(`Could not resolve folder segment: ${folderName}`);
      const result: ResolvedFolderPath = { fileAreaId, folderId: null };
      if (resolvedPathsCache) resolvedPathsCache[path] = result;
      return result;
    }
    parentFolderId = fid;
  }

  const result: ResolvedFolderPath = { fileAreaId, folderId: parentFolderId };
  if (resolvedPathsCache) resolvedPathsCache[path] = result;
  return result;
}
