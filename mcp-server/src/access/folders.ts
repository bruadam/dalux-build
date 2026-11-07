import type { DaluxClient } from 'dalux-build-api';
import { collectAllDaluxItems } from '../daluxPagination';

const TTL_MS = 60_000;

/** Folder placement of Dalux files and folders, which folder grants are checked against. */
export interface FolderLookup {
  /** Folder ids from the file area's top folder down to and including `folderId`. */
  ancestry(projectId: string, fileAreaId: string, folderId: string): Promise<string[]>;
  fileFolder(projectId: string, fileAreaId: string, fileId: string): Promise<string | undefined>;
}

function cached<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const entries = new Map<string, { value: Promise<T>; at: number }>();
  return (key) => {
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = load(key);
    value.catch(() => entries.delete(key));
    entries.set(key, { value, at: Date.now() });
    return value;
  };
}

/** One Dalux folder listing per file area and one file lookup per file, each cached for a minute. */
export function createFolderLookup(client: DaluxClient): FolderLookup {
  const parents = cached(async (key) => {
    const [projectId, fileAreaId] = key.split('/');
    const folders = await collectAllDaluxItems((params) => client.folders.listFolders(projectId, fileAreaId, params));
    return new Map(folders.map((folder) => [folder.folderId, folder.parentFolderId ?? undefined]));
  });
  const fileFolder = cached(async (key) => {
    const [projectId, fileAreaId, fileId] = key.split('/');
    const file = (await client.files.getFile(projectId, fileAreaId, fileId)) as { data?: { folderId?: string | null } } | null;
    return file?.data?.folderId ?? undefined;
  });

  return {
    async ancestry(projectId, fileAreaId, folderId) {
      const parentOf = await parents(`${projectId}/${fileAreaId}`);
      const chain: string[] = [];
      for (let id: string | undefined = folderId; id && !chain.includes(id); id = parentOf.get(id)) chain.unshift(id);
      return chain;
    },
    fileFolder: (projectId, fileAreaId, fileId) => fileFolder(`${projectId}/${fileAreaId}/${fileId}`),
  };
}
