import type { RankField } from "./rank";

/** Matches the client's `FolderSchema`. */
export interface Folder {
  folderId: string;
  folderName: string;
  parentFolderId?: string | null;
}

/** The subset of the client's `FileSchema` used here. */
export interface DaluxFile {
  fileId: string;
  fileRevisionId?: string | null;
  fileName: string;
  fileAreaId: string;
  folderId?: string | null;
  uploadedByUserId?: string | null;
  uploaded?: string | null;
  lastModifiedByUserId?: string | null;
  lastModified?: string | null;
  version?: string | null;
  deleted?: boolean | null;
  fileType?: string | null;
  fileSize?: number | null;
  downloadLink?: string | null;
}

export interface FileEntry {
  fileId: string;
  fileRevisionId?: string;
  fileName: string;
  fileAreaId: string;
  fileAreaName: string;
  folderId?: string;
  folderPath: string;
  version?: string;
  uploaded?: string;
  uploadedByUserId?: string;
  lastModified?: string;
  lastModifiedByUserId?: string;
  fileType?: string;
  fileSize?: number;
  downloadLink?: string;
}

/**
 * Full "/"-joined path of every folder. A parent id that is not in the list
 * is treated as the file area root.
 */
export function folderPaths(folders: readonly Folder[]): Map<string, string> {
  const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
  const paths = new Map<string, string>();

  function resolve(folderId: string, visiting: Set<string>): string {
    const known = paths.get(folderId);
    if (known !== undefined) return known;
    const folder = byId.get(folderId);
    if (!folder) return "";
    const parentId = folder.parentFolderId;
    const parentPath =
      parentId && byId.has(parentId) && !visiting.has(parentId) ? resolve(parentId, visiting.add(folderId)) : "";
    const path = parentPath ? `${parentPath}/${folder.folderName}` : folder.folderName;
    paths.set(folderId, path);
    return path;
  }

  for (const folder of folders) resolve(folder.folderId, new Set());
  return paths;
}

export function toFileEntry(file: DaluxFile, fileAreaName: string, paths: Map<string, string>): FileEntry {
  return {
    fileId: file.fileId,
    fileRevisionId: file.fileRevisionId ?? undefined,
    fileName: file.fileName,
    fileAreaId: file.fileAreaId,
    fileAreaName,
    folderId: file.folderId ?? undefined,
    folderPath: (file.folderId && paths.get(file.folderId)) || "",
    version: file.version ?? undefined,
    uploaded: file.uploaded ?? undefined,
    uploadedByUserId: file.uploadedByUserId ?? undefined,
    lastModified: file.lastModified ?? undefined,
    lastModifiedByUserId: file.lastModifiedByUserId ?? undefined,
    fileType: file.fileType ?? undefined,
    fileSize: file.fileSize ?? undefined,
    downloadLink: file.downloadLink ?? undefined,
  };
}

/**
 * The file areas matching the "Preferred File Area" preference (name or ID,
 * case-insensitive). All areas when the preference is empty or matches none
 * in this project, so projects without that area still show their files.
 */
export function preferredFileAreas<T extends { fileAreaId: string; fileAreaName: string }>(
  areas: readonly T[],
  preferred: string | undefined,
): T[] {
  const wanted = preferred?.trim().toLowerCase();
  const matches = wanted
    ? areas.filter((a) => a.fileAreaId.toLowerCase() === wanted || a.fileAreaName.toLowerCase() === wanted)
    : [];
  return matches.length ? matches : [...areas];
}

/** Files the user uploaded or last modified. */
export function filesOfUser(files: readonly FileEntry[], userId: string): FileEntry[] {
  return files.filter((file) => file.uploadedByUserId === userId || file.lastModifiedByUserId === userId);
}

export function fileRankFields(file: FileEntry): RankField[] {
  return [
    { text: file.fileName, weight: 3 },
    { text: file.folderPath, weight: 1 },
    { text: file.fileAreaName, weight: 0.5 },
    { text: file.fileType, weight: 0.5 },
  ];
}

/** File names can contain characters that are not valid in a local path segment. */
export function safeFileName(name: string): string {
  return name.replace(/[/\\:]/g, "_").replace(/^\.+/, "_") || "file";
}
