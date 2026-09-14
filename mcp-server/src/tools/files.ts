import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { collectAllDaluxItems } from '../daluxPagination';
import { fullListForLlm, type PaginatedForLlm } from '../serialize';

// ---------- list_file_areas ----------

export const listFileAreasInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
});
export type ListFileAreasInput = z.infer<typeof listFileAreasInput>;

export async function listFileAreas(client: DaluxClient, args: ListFileAreasInput) {
  const items = await collectAllDaluxItems((params) => client.fileAreas.getFileAreas(args.projectId, params));
  return { items };
}

// ---------- get_file_area ----------

export const getFileAreaInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
});
export type GetFileAreaInput = z.infer<typeof getFileAreaInput>;

export async function getFileArea(client: DaluxClient, args: GetFileAreaInput) {
  return client.fileAreas.getFileArea(args.projectId, args.fileAreaId);
}

// ---------- list_folders ----------

export const listFoldersInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
});
export type ListFoldersInput = z.infer<typeof listFoldersInput>;

export async function listFolders(
  client: DaluxClient,
  args: ListFoldersInput,
): Promise<PaginatedForLlm<unknown>> {
  const folders = await client.folders.getAllFolders(args.projectId, args.fileAreaId);
  return fullListForLlm(folders);
}

// ---------- get_folder ----------

export const getFolderInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
  folderId: z.string().describe('The folder ID.'),
});
export type GetFolderInput = z.infer<typeof getFolderInput>;

export async function getFolder(client: DaluxClient, args: GetFolderInput) {
  return client.folders.getFolder(args.projectId, args.fileAreaId, args.folderId);
}

// ---------- get_folder_by_path ----------

export const getFolderByPathInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  path: z.string().describe('Full path starting with the file area name, e.g. "Files/4_Design/C07_Geometry".'),
});
export type GetFolderByPathInput = z.infer<typeof getFolderByPathInput>;

export async function getFolderByPath(client: DaluxClient, args: GetFolderByPathInput) {
  return client.folders.getFolderByPath(args.projectId, args.path);
}

// ---------- get_folder_tree ----------

export const getFolderTreeInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
});
export type GetFolderTreeInput = z.infer<typeof getFolderTreeInput>;

/**
 * Folders-only tree (no files) — cheap enough for an LLM to use for
 * navigation before drilling into a specific folder with list_files_in_folder.
 */
export async function getFolderTree(client: DaluxClient, args: GetFolderTreeInput) {
  return client.folders.getFileAreaTree(args.projectId, args.fileAreaId);
}

// ---------- list_files_in_folder ----------

export const listFilesInFolderInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
  folderId: z.string().describe('The folder ID.'),
});
export type ListFilesInFolderInput = z.infer<typeof listFilesInFolderInput>;

export async function listFilesInFolder(
  client: DaluxClient,
  args: ListFilesInFolderInput,
): Promise<PaginatedForLlm<unknown>> {
  const files = await client.files.getAllFilesInFolder(args.projectId, args.fileAreaId, args.folderId);
  return fullListForLlm(files);
}

// ---------- list_files ----------

export const listFilesInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
});
export type ListFilesInput = z.infer<typeof listFilesInput>;

export async function listFiles(
  client: DaluxClient,
  args: ListFilesInput,
): Promise<PaginatedForLlm<unknown>> {
  const files = await client.files.getAllFiles(args.projectId, args.fileAreaId);
  return fullListForLlm(files);
}

// ---------- get_file ----------

export const getFileInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
  fileId: z.string().describe('The file ID.'),
});
export type GetFileInput = z.infer<typeof getFileInput>;

/**
 * Metadata only — this tool never downloads file content to disk (read-only,
 * side-effect-free by design; download=false is not exposed as a tool option).
 */
export async function getFile(client: DaluxClient, args: GetFileInput) {
  return client.files.getFile(args.projectId, args.fileAreaId, args.fileId);
}
