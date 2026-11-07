/**
 * Resolving which Dalux files a temporary index covers.
 *
 * A scope is (project, file area, optional folder subtree, extension filter).
 * It hashes to a stable index id, so asking for the same scope twice reuses the
 * index that is already on disk instead of re-downloading the file area.
 */

import { createHash } from 'node:crypto';
import type { DaluxClient } from 'dalux-build-api';
import { collectAllDaluxItems } from '../daluxPagination';
import { SUPPORTED_EXTENSIONS, formatFor } from '../extract';

export interface IndexScope {
  projectId: string;
  fileAreaId: string;
  folderId: string | null;
  /** Folder path as the caller wrote it, kept for display only. */
  folderPath: string | null;
  recursive: boolean;
  /** Lowercase extensions including the dot; a subset of SUPPORTED_EXTENSIONS. */
  extensions: string[];
  includeDrawings: boolean;
}

export interface IndexableFile {
  fileId: string;
  fileName: string;
  folderId: string | null;
  /**
   * Folders above `folderId`, root first. Only known when the build listed the
   * file area's folders (a recursive folder scope); undefined otherwise.
   */
  folderAncestorIds?: string[];
  fileType: string | null;
  downloadLink: string | null;
  fileSize: number | null;
  /** Changes whenever the file's content does — drives incremental re-indexing. */
  revisionKey: string;
}

export interface SkippedFile {
  fileId: string;
  fileName: string;
  reason: string;
}

export function indexIdFor(scope: IndexScope): string {
  const raw = [
    scope.projectId,
    scope.fileAreaId,
    scope.folderId ?? '',
    scope.recursive ? 'r' : 'flat',
    [...scope.extensions].sort().join(','),
    scope.includeDrawings ? 'drawings' : 'nodrawings',
  ].join(':');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export function normalizeExtensions(extensions?: readonly string[]): string[] {
  if (!extensions?.length) return [...SUPPORTED_EXTENSIONS];
  const normalized = extensions.map((extension) => {
    const lower = extension.trim().toLowerCase();
    return lower.startsWith('.') ? lower : `.${lower}`;
  });
  const unsupported = normalized.filter((extension) => !SUPPORTED_EXTENSIONS.includes(extension as never));
  if (unsupported.length) {
    throw new Error(
      `Unsupported extension(s): ${unsupported.join(', ')}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
    );
  }
  return [...new Set(normalized)];
}

function unwrap(item: unknown): Record<string, unknown> {
  const record = (item ?? {}) as Record<string, unknown>;
  return ((record.data as Record<string, unknown>) ?? record) as Record<string, unknown>;
}

export interface ScopeArgs {
  projectId: string;
  fileAreaId: string;
  folderId?: string | null;
  folderPath?: string | null;
  recursive?: boolean;
  extensions?: string[];
  includeDrawings?: boolean;
}

export async function resolveScope(client: DaluxClient, args: ScopeArgs): Promise<IndexScope> {
  if (args.folderId && args.folderPath) {
    throw new Error('Pass either folderId or folderPath, not both.');
  }

  let folderId = args.folderId ?? null;
  if (args.folderPath) {
    const response = await client.folders.getFolderByPath(args.projectId, args.folderPath);
    const data = unwrap(response);
    folderId = (data.folderId as string) ?? null;
    if (!folderId) throw new Error(`No folder found at path "${args.folderPath}".`);
  }

  return {
    projectId: args.projectId,
    fileAreaId: args.fileAreaId,
    folderId,
    folderPath: args.folderPath ?? null,
    recursive: args.recursive ?? true,
    extensions: normalizeExtensions(args.extensions),
    includeDrawings: args.includeDrawings ?? true,
  };
}

interface FolderTree {
  /** The scope folder plus, when recursive, every folder beneath it; null when the scope has no folder. */
  subtree: Set<string> | null;
  /** Parent of each folder in the file area; null when the folder list was not fetched. */
  parentOf: Map<string, string> | null;
}

async function folderTree(client: DaluxClient, scope: IndexScope): Promise<FolderTree> {
  if (!scope.folderId) return { subtree: null, parentOf: null };
  if (!scope.recursive) return { subtree: new Set([scope.folderId]), parentOf: null };

  const folders = await collectAllDaluxItems((params) =>
    client.folders.listFolders(scope.projectId, scope.fileAreaId, params),
  );

  const childrenByParent = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const folder of folders) {
    const data = unwrap(folder);
    const id = data.folderId as string | undefined;
    const parent = (data.parentFolderId as string | undefined) ?? '';
    if (!id) continue;
    childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), id]);
    if (parent) parentOf.set(id, parent);
  }

  const subtree = new Set<string>([scope.folderId]);
  const queue = [scope.folderId];
  while (queue.length) {
    for (const child of childrenByParent.get(queue.pop() as string) ?? []) {
      if (subtree.has(child)) continue;
      subtree.add(child);
      queue.push(child);
    }
  }
  return { subtree, parentOf };
}

/** Folders above `folderId`, root first. */
function ancestorsOf(folderId: string, parentOf: Map<string, string>): string[] {
  const ancestors: string[] = [];
  let current = parentOf.get(folderId);
  while (current && !ancestors.includes(current) && current !== folderId) {
    ancestors.unshift(current);
    current = parentOf.get(current);
  }
  return ancestors;
}

/**
 * List the files in `scope` this server can extract text from, plus the ones it
 * deliberately passed over. The skip list is returned rather than swallowed:
 * "none of the 40 files in this folder are readable (they are all .dwg)" is an
 * answer, whereas an empty index looks like a bug.
 */
export async function listIndexableFiles(
  client: DaluxClient,
  scope: IndexScope,
): Promise<{ files: IndexableFile[]; skipped: SkippedFile[] }> {
  const { subtree, parentOf } = await folderTree(client, scope);
  const items = await collectAllDaluxItems((params) =>
    client.files.listFiles(scope.projectId, scope.fileAreaId, params),
  );

  const files: IndexableFile[] = [];
  const skipped: SkippedFile[] = [];

  for (const item of items) {
    const data = unwrap(item);
    const fileId = data.fileId as string | undefined;
    const fileName = (data.fileName as string | undefined) ?? '';
    if (!fileId) continue;
    if (data.deleted === true) continue;

    const folderId = (data.folderId as string | undefined) ?? null;
    if (subtree && !(folderId && subtree.has(folderId))) continue;

    const fileType = (data.fileType as string | undefined) ?? null;
    const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : '';

    if (!scope.extensions.includes(extension) || !formatFor(fileName)) {
      skipped.push({ fileId, fileName, reason: `unsupported file type (${extension || 'no extension'})` });
      continue;
    }
    if (!scope.includeDrawings && fileType === 'drawing') {
      skipped.push({ fileId, fileName, reason: 'drawing excluded by includeDrawings=false' });
      continue;
    }

    const downloadLink = (data.downloadLink as string | undefined) ?? null;
    files.push({
      fileId,
      fileName,
      folderId,
      folderAncestorIds: parentOf && folderId ? ancestorsOf(folderId, parentOf) : undefined,
      fileType,
      downloadLink,
      fileSize: (data.fileSize as number | undefined) ?? null,
      revisionKey:
        (data.contentHash as string | undefined) ||
        (data.fileRevisionId as string | undefined) ||
        (data.version as string | undefined) ||
        (data.lastModified as string | undefined) ||
        '',
    });
  }

  return { files, skipped };
}
