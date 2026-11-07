import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { collectAllDaluxItems } from '../daluxPagination';
import { fieldsInput, pageInput, paginateForLlm, pickFields, type PaginatedForLlm } from '../serialize';

/** File fields list tools return by default; the rest (downloadLink, contentHash, user ids, ...) via `fields` or get_file. */
const FILE_FIELDS = ['fileId', 'fileName', 'folderId', 'lastModified', 'version', 'fileSize'] as const;

/** Case-insensitive substring match on a named string field, tolerant of items missing that field. */
function matchesNameQuery(item: unknown, field: string, needle: string): boolean {
  const value = (item as Record<string, unknown>)[field];
  return typeof value === 'string' && value.toLowerCase().includes(needle);
}

// ---------- list_file_areas ----------

export const listFileAreasInput = z.object({
  projectId: z.string(),
});
export type ListFileAreasInput = z.infer<typeof listFileAreasInput>;

export async function listFileAreas(client: DaluxClient, args: ListFileAreasInput) {
  const items = await collectAllDaluxItems((params) => client.fileAreas.getFileAreas(args.projectId, params));
  return { items };
}

// ---------- get_file_area ----------

export const getFileAreaInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
});
export type GetFileAreaInput = z.infer<typeof getFileAreaInput>;

export async function getFileArea(client: DaluxClient, args: GetFileAreaInput) {
  return client.fileAreas.getFileArea(args.projectId, args.fileAreaId);
}

// ---------- list_folders ----------

export const listFoldersInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
  ...pageInput,
});
export type ListFoldersInput = z.infer<typeof listFoldersInput>;

export async function listFolders(
  client: DaluxClient,
  args: ListFoldersInput,
): Promise<PaginatedForLlm<unknown>> {
  const items = await collectAllDaluxItems((params) =>
    client.folders.listFolders(args.projectId, args.fileAreaId, params),
  );
  return paginateForLlm(items, args);
}

// ---------- search_folders_by_name ----------

export const searchFoldersByNameInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
  query: z.string().describe('Case-insensitive substring of the folder name.'),
  ...pageInput,
});
export type SearchFoldersByNameInput = z.infer<typeof searchFoldersByNameInput>;

/** Finds folders in a file area whose name contains `query`, case-insensitively. */
export async function searchFoldersByName(
  client: DaluxClient,
  args: SearchFoldersByNameInput,
): Promise<PaginatedForLlm<unknown>> {
  const items = await collectAllDaluxItems((params) =>
    client.folders.listFolders(args.projectId, args.fileAreaId, params),
  );
  const needle = args.query.toLowerCase();
  const matches = items.filter((item) => matchesNameQuery(item, 'folderName', needle));
  return paginateForLlm(matches, args);
}

// ---------- get_folder ----------

export const getFolderInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
  folderId: z.string(),
});
export type GetFolderInput = z.infer<typeof getFolderInput>;

export async function getFolder(client: DaluxClient, args: GetFolderInput) {
  return client.folders.getFolder(args.projectId, args.fileAreaId, args.folderId);
}

// ---------- get_folder_by_path ----------

export const getFolderByPathInput = z.object({
  projectId: z.string(),
  path: z.string().describe('e.g. "Files/4_Design/C07_Geometry".'),
});
export type GetFolderByPathInput = z.infer<typeof getFolderByPathInput>;

export async function getFolderByPath(client: DaluxClient, args: GetFolderByPathInput) {
  return client.folders.getFolderByPath(args.projectId, args.path);
}

// ---------- get_folder_tree ----------

const DEFAULT_TREE_DEPTH = 3;

export const getFolderTreeInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
  folderId: z.string().optional().describe('Start folder (default: file area root).'),
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(`Levels below the start folder (default ${DEFAULT_TREE_DEPTH}). Cut-off folders report childCount.`),
});
export type GetFolderTreeInput = z.infer<typeof getFolderTreeInput>;

interface FolderNode {
  id: string;
  name: string;
  children?: FolderNode[];
  childCount?: number;
}

type FolderItem = { folderId: string; folderName?: string; parentFolderId?: string };

/**
 * Folders-only tree (no files), depth-limited and reduced to id/name, so an
 * LLM can navigate a large file area before drilling into a specific folder
 * with list_files_in_folder.
 */
export async function getFolderTree(client: DaluxClient, args: GetFolderTreeInput) {
  const folders = (await collectAllDaluxItems((params) =>
    client.folders.listFolders(args.projectId, args.fileAreaId, params),
  )) as FolderItem[];
  const ids = new Set(folders.map((folder) => folder.folderId));
  const childrenOf = new Map<string | undefined, FolderItem[]>();
  for (const folder of folders) {
    const parent = folder.parentFolderId && ids.has(folder.parentFolderId) ? folder.parentFolderId : undefined;
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(folder);
    else childrenOf.set(parent, [folder]);
  }

  const maxDepth = args.maxDepth ?? DEFAULT_TREE_DEPTH;
  const build = (folder: FolderItem, depth: number): FolderNode => {
    const node: FolderNode = { id: folder.folderId, name: folder.folderName ?? '' };
    const children = childrenOf.get(folder.folderId) ?? [];
    if (children.length === 0) return node;
    if (depth >= maxDepth) return { ...node, childCount: children.length };
    return { ...node, children: children.map((child) => build(child, depth + 1)) };
  };

  const roots = args.folderId
    ? folders.filter((folder) => folder.folderId === args.folderId)
    : (childrenOf.get(undefined) ?? []);
  if (args.folderId && roots.length === 0) {
    throw new Error(`Folder ${args.folderId} not found in file area ${args.fileAreaId}.`);
  }
  return { totalFolders: folders.length, maxDepth, tree: roots.map((root) => build(root, 0)) };
}

// ---------- list_files_in_folder ----------

export const listFilesInFolderInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
  folderId: z.string(),
  ...pageInput,
  fields: fieldsInput,
});
export type ListFilesInFolderInput = z.infer<typeof listFilesInFolderInput>;

export async function listFilesInFolder(
  client: DaluxClient,
  args: ListFilesInFolderInput,
): Promise<PaginatedForLlm<unknown>> {
  const items = await collectAllDaluxItems((params) => client.files.listFiles(args.projectId, args.fileAreaId, params));
  const inFolder = items.filter((file) => {
    const record = file as Record<string, unknown>;
    return record.folderId === args.folderId;
  });
  return pickFields(paginateForLlm(inFolder, args), FILE_FIELDS, args.fields);
}

// ---------- list_files ----------

export const listFilesInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
  ...pageInput,
  fields: fieldsInput,
});
export type ListFilesInput = z.infer<typeof listFilesInput>;

export async function listFiles(
  client: DaluxClient,
  args: ListFilesInput,
): Promise<PaginatedForLlm<unknown>> {
  const items = await collectAllDaluxItems((params) => client.files.listFiles(args.projectId, args.fileAreaId, params));
  return pickFields(paginateForLlm(items, args), FILE_FIELDS, args.fields);
}

// ---------- search_files_by_name ----------

export const searchFilesByNameInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
  query: z.string().describe('Case-insensitive substring of the file name.'),
  ...pageInput,
  fields: fieldsInput,
});
export type SearchFilesByNameInput = z.infer<typeof searchFilesByNameInput>;

/** Finds files in a file area whose name contains `query`, case-insensitively. */
export async function searchFilesByName(
  client: DaluxClient,
  args: SearchFilesByNameInput,
): Promise<PaginatedForLlm<unknown>> {
  const items = await collectAllDaluxItems((params) => client.files.listFiles(args.projectId, args.fileAreaId, params));
  const needle = args.query.toLowerCase();
  const matches = items.filter((item) => matchesNameQuery(item, 'fileName', needle));
  return pickFields(paginateForLlm(matches, args), FILE_FIELDS, args.fields);
}

// ---------- get_file ----------

export const getFileInput = z.object({
  projectId: z.string(),
  fileAreaId: z.string(),
  fileId: z.string(),
});
export type GetFileInput = z.infer<typeof getFileInput>;

/**
 * Metadata only — this tool never downloads file content to disk (read-only,
 * side-effect-free by design; download=false is not exposed as a tool option).
 */
export async function getFile(client: DaluxClient, args: GetFileInput) {
  return client.files.getFile(args.projectId, args.fileAreaId, args.fileId);
}
