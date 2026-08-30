import { z } from 'zod';
import { ApiClient } from '../apiClient';
import { paginate } from '../utils/pagination';
import { findByField } from '../utils/search';
import { validateProjectId, validateFileAreaId } from '../utils/validation';
import { resolveFolderIdFromNamedPath } from '../utils/pathResolver';
import { convertToModel, convertToModelList } from '../models/convert';
import { FolderSchema, FolderResponseSchema, FoldersListResponseSchema } from '../models/folders';

/**
 * Minimal shape expected of a FilesApi instance passed to `getFileAreaTree`.
 * Kept duck-typed (rather than importing FilesApi) to avoid coupling this
 * module to the files API surface for what is purely optional plumbing.
 */
interface FilesApiLike {
  getAllFiles(
    projectId: string,
    fileAreaId: string,
    params?: Record<string, unknown>,
    verbose?: boolean,
  ): Promise<unknown[]>;
}

export interface FolderTreeNode {
  id: string | null;
  name: string;
  path: string;
  raw: Record<string, unknown> | null;
  children: FolderTreeNode[];
  files: unknown[];
}

/**
 * API methods for folders within a file area.
 */
export class FoldersApi {
  private _client: ApiClient;

  constructor(apiClient: ApiClient) {
    this._client = apiClient;
  }

  /**
   * Browse all folders on the given project and file area (single page).
   * GET /5.1/projects/{projectId}/file_areas/{fileAreaId}/folders
   */
  async listFolders(
    projectId: string,
    fileAreaId: string,
    params: Record<string, unknown> = {},
  ): Promise<z.infer<typeof FoldersListResponseSchema>> {
    const response = await this._client.get(
      `/5.1/projects/${projectId}/file_areas/${fileAreaId}/folders`,
      params,
    );
    return convertToModel(response, FoldersListResponseSchema, 'FoldersListResponse') as z.infer<
      typeof FoldersListResponseSchema
    >;
  }

  /**
   * Retrieve all folders by following bookmark pagination automatically.
   */
  async getAllFolders(
    projectId: string,
    fileAreaId: string,
    params: Record<string, unknown> = {},
    verbose = false,
  ): Promise<z.infer<typeof FolderSchema>[]> {
    validateProjectId(projectId);
    validateFileAreaId(fileAreaId);
    const endpoint = `/5.1/projects/${projectId}/file_areas/${fileAreaId}/folders`;
    const raw = await paginate(endpoint, this._client, params, verbose);
    return convertToModelList(raw, FolderSchema, 'Folder');
  }

  /**
   * Retrieve a specific folder.
   * GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/folders/{folderId}
   */
  async getFolder(
    projectId: string,
    fileAreaId: string,
    folderId: string,
  ): Promise<z.infer<typeof FolderResponseSchema>> {
    const response = await this._client.get(
      `/5.0/projects/${projectId}/file_areas/${fileAreaId}/folders/${folderId}`,
    );
    return convertToModel(response, FolderResponseSchema, 'FolderResponse') as z.infer<
      typeof FolderResponseSchema
    >;
  }

  /**
   * Get a folder using a full path starting with the file area name.
   * e.g. "Files/4_Design/C07_Geometry"
   */
  async getFolderByPath(
    projectId: string,
    path: string,
    verbose = false,
  ): Promise<z.infer<typeof FolderResponseSchema> | null> {
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
   */
  getFolderFilesProperties(projectId: string, fileAreaId: string, folderId: string): Promise<unknown> {
    return this._client.get(
      `/1.0/projects/${projectId}/file_areas/${fileAreaId}/folders/${folderId}/files/properties/1.0/mappings`,
    );
  }

  /**
   * Get a folder by name within a file area, optionally filtered by parent folder.
   */
  async getFolderByName(
    projectId: string,
    fileAreaId: string,
    folderName: string,
    parentFolderId: string | null = null,
  ): Promise<z.infer<typeof FolderResponseSchema> | null> {
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
   */
  async getFileAreaTreeByPath(
    projectId: string,
    fileAreaId: string,
    folderPath: string,
    verbose = false,
  ): Promise<string | null> {
    const allFolders = (await this.getAllFolders(projectId, fileAreaId)) as unknown as Record<
      string,
      unknown
    >[];

    const cleanPath = folderPath.replace(/^\/|\/$/g, '');
    const pathParts = cleanPath.split('/').map((p) => p.trim()).filter(Boolean);
    if (!pathParts.length) return null;

    function getData(item: Record<string, unknown>): Record<string, unknown> {
      return (item.data as Record<string, unknown>) || item;
    }
    function getFid(item: Record<string, unknown>): string | null {
      const d = getData(item);
      return (d.folderId as string) || (d.id as string) || null;
    }
    function getPid(item: Record<string, unknown>): string {
      const d = getData(item);
      return (d.parentFolderId as string) || (d.parentId as string) || '';
    }
    function getName(item: Record<string, unknown>): string {
      const d = getData(item);
      return (d.folderName as string) || (d.name as string) || '';
    }

    // Collect valid folder IDs
    const validFolderIds = new Set(allFolders.map(getFid).filter(Boolean) as string[]);
    const fileAreaRootId = fileAreaId;

    let candidateParentIds = new Set<string | null>([fileAreaRootId, null, '']);

    for (const segment of pathParts) {
      const pattern = segment.toLowerCase();
      const nextCandidates = new Set<string | null>();
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
   */
  async getFileAreaTree(
    projectId: string,
    fileAreaId: string,
    filesApi: FilesApiLike | null = null,
    verbose = false,
  ): Promise<FolderTreeNode> {
    let allFolders: Record<string, unknown>[];
    let allFiles: unknown[];

    if (filesApi) {
      [allFolders, allFiles] = await Promise.all([
        this.getAllFolders(projectId, fileAreaId, {}, verbose) as unknown as Promise<Record<string, unknown>[]>,
        filesApi.getAllFiles(projectId, fileAreaId, {}, verbose),
      ]);
    } else {
      allFolders = (await this.getAllFolders(projectId, fileAreaId, {}, verbose)) as unknown as Record<
        string,
        unknown
      >[];
      allFiles = [];
    }

    if (verbose) {
      console.log(`Building tree: ${allFolders.length} folder(s), ${allFiles.length} file(s)`);
    }

    function fid(item: Record<string, unknown>): string | null {
      const d = (item.data as Record<string, unknown>) || item;
      return (d.folderId as string) || (d.id as string) || null;
    }
    function pid(item: Record<string, unknown>): string | null {
      const d = (item.data as Record<string, unknown>) || item;
      return (d.parentFolderId as string) || (d.parentId as string) || null;
    }
    function name(item: Record<string, unknown>): string {
      const d = (item.data as Record<string, unknown>) || item;
      return (d.folderName as string) || (d.name as string) || fid(item) || '?';
    }

    // Build node map
    const nodes: Record<string, FolderTreeNode> = {};
    for (const folder of allFolders) {
      const id = fid(folder);
      if (!id) continue;
      nodes[id] = { id, name: name(folder), path: '', raw: folder, children: [], files: [] };
    }

    // Wire parent→child
    const root: FolderTreeNode = { id: null, name: fileAreaId, path: '', raw: null, children: [], files: [] };
    const validIds = new Set(Object.keys(nodes));
    for (const folder of allFolders) {
      const id = fid(folder);
      if (!id) continue;
      const parentId = pid(folder);
      const parent = (parentId && validIds.has(parentId)) ? nodes[parentId] : root;
      parent.children.push(nodes[id]);
    }

    // Compute paths
    function setPaths(node: FolderTreeNode, parentPath: string): void {
      node.path = parentPath ? `${parentPath}/${node.name}` : node.name;
      for (const child of node.children) setPaths(child, node.path);
    }
    for (const child of root.children) setPaths(child, '');

    // Attach files to their folder nodes
    for (const f of allFiles as Record<string, unknown>[]) {
      const folderIdVal = ((f.data as Record<string, unknown>) || {}).folderId || f.folderId || null;
      const target = (folderIdVal && nodes[folderIdVal as string]) ? nodes[folderIdVal as string] : root;
      target.files.push(f);
    }

    return root;
  }
}

/**
 * Simple fnmatch-style wildcard matching (only * is supported).
 */
function _fnmatch(str: string, pattern: string): boolean {
  if (!pattern.includes('*')) return str === pattern;
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(str);
}
