import type { DaluxClient, FolderTreeNode } from 'dalux-build-api';
import { canSee, reaches } from './checkAccess';
import type { RequestContext } from './context';
import type { FolderLookup } from './folders';

type Page<T> = { items?: T[] | null } | null | undefined;

async function filterPage<P extends Page<T>, T>(page: P, keep: (item: T) => Promise<boolean> | boolean): Promise<P> {
  if (!page?.items) return page;
  const flags = await Promise.all(page.items.map(keep));
  return { ...page, items: page.items.filter((_, i) => flags[i]) };
}

function override<T extends object>(target: T, methods: Partial<T>): T {
  return Object.assign(Object.create(target) as T, methods);
}

/**
 * The Dalux client as seen by a restricted caller: project, file area, folder,
 * and file listings drop what the caller's grants do not reach, before any
 * tool pages or counts them.
 */
export function restrictClient(client: DaluxClient, context: RequestContext, folders: FolderLookup): DaluxClient {
  if (context.access === 'unrestricted') return client;

  const folderVisible = async (projectId: string, fileAreaId: string, folderId: string | null | undefined) => {
    if (canSee(context, 'files:read', { projectId, fileAreaId })) return true;
    if (!folderId) return false;
    const folderAncestorIds = await folders.ancestry(projectId, fileAreaId, folderId);
    return canSee(context, 'files:read', { projectId, fileAreaId, folderId, folderAncestorIds });
  };

  const pruneTree = async (projectId: string, fileAreaId: string, node: FolderTreeNode): Promise<FolderTreeNode[]> => {
    if (node.id && (await folderVisible(projectId, fileAreaId, node.id))) return [node];
    const children = (await Promise.all(node.children.map((child) => pruneTree(projectId, fileAreaId, child)))).flat();
    return node.id ? children : [{ ...node, children, files: [] }];
  };

  const { projects, fileAreas, folders: foldersApi, files } = client;
  return override(client, {
    projects: override(projects, {
      listProjects: async (params) =>
        filterPage(await projects.listProjects(params), (project) => reaches(context, 'projects:read', { projectId: (project as { projectId?: string }).projectId })),
    }),
    fileAreas: override(fileAreas, {
      getFileAreas: async (projectId, params) =>
        filterPage(await fileAreas.getFileAreas(projectId, params), (area) =>
          reaches(context, 'files:read', { projectId, fileAreaId: (area as { fileAreaId?: string }).fileAreaId }),
        ),
    }),
    folders: override(foldersApi, {
      listFolders: async (projectId, fileAreaId, params) =>
        filterPage(await foldersApi.listFolders(projectId, fileAreaId, params), (folder) =>
          folderVisible(projectId, fileAreaId, (folder as { folderId?: string }).folderId),
        ),
      getFileAreaTree: async (projectId, fileAreaId, filesApi, verbose) => {
        const tree = await foldersApi.getFileAreaTree(projectId, fileAreaId, filesApi, verbose);
        if (canSee(context, 'files:read', { projectId, fileAreaId })) return tree;
        return (await pruneTree(projectId, fileAreaId, tree))[0];
      },
    }),
    files: override(files, {
      listFiles: async (projectId, fileAreaId, params) =>
        filterPage(await files.listFiles(projectId, fileAreaId, params), (file) =>
          folderVisible(projectId, fileAreaId, (file as { folderId?: string | null }).folderId),
        ),
    }),
  });
}
