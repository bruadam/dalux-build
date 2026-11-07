/**
 * Loaders and hooks for Dalux data. Every list follows bookmark pagination to
 * the end and is cached (see useCachedLoad) with a TTL that fits how often
 * the data changes and how expensive it is to load.
 */

import { Toast, showToast } from "@raycast/api";
import { getClient } from "./client";
import { MINUTE, useCachedLoad } from "./cache";
import { folderPaths, toFileEntry, type DaluxFile, type FileEntry, type Folder } from "./files";
import { collectAll, type ProgressCallback } from "./pagination";
import { foldTaskChanges, toTaskSummary, type TaskChange, type TaskState, type TaskSummary } from "./tasks";
import { toUserEntry, type UserEntry } from "./users";

export interface Project {
  projectId: string;
  projectName: string;
  number?: string;
}

export interface WorkPackage {
  workpackageId: string;
  name: string;
}

export interface VersionSet {
  versionSetId: string;
  name: string;
  description?: string;
  status?: string;
  fileAreaId: string;
}

export interface FileArea {
  fileAreaId: string;
  fileAreaName: string;
  fileAreaType: string;
}

export interface ProjectFiles {
  fileAreas: FileArea[];
  folders: Record<string, Folder[]>;
  files: FileEntry[];
}

/** Shows a toast with page progress for loads that can take a while. */
async function withProgress<T>(title: string, run: (onProgress: ProgressCallback) => Promise<T>): Promise<T> {
  const toast = await showToast({ style: Toast.Style.Animated, title });
  try {
    const result = await run((loaded, total) => {
      toast.message = total ? `${loaded.toLocaleString()} of ${total.toLocaleString()}` : loaded.toLocaleString();
    });
    await toast.hide();
    return result;
  } catch (error) {
    await toast.hide();
    throw error;
  }
}

export function useProjects() {
  return useCachedLoad<Project[]>("projects", 60 * MINUTE, async () => {
    const items = await collectAll((params) => getClient().projects.listProjects(params));
    return items
      .map((p) => ({ projectId: p.projectId, projectName: p.projectName, number: p.number ?? undefined }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
  });
}

export function useTasks(projectId: string | undefined) {
  return useCachedLoad<TaskSummary[]>(projectId && `tasks:${projectId}`, 10 * MINUTE, () =>
    withProgress("Loading tasks", async (onProgress) => {
      const items = await collectAll((params) => getClient().tasks.getProjectTasks(projectId!, params), { onProgress });
      return items.map(toTaskSummary).filter((task): task is TaskSummary => Boolean(task));
    }),
  );
}

/**
 * Status, responsible, deadline and work package per task, folded from the
 * project's full change history. Dalux has no per-task filter for changes, so
 * this loads the whole history; it is the slowest load here, hence the long TTL.
 */
export function useTaskStates(projectId: string | undefined) {
  return useCachedLoad<Record<string, TaskState>>(projectId && `task-states:${projectId}`, 60 * MINUTE, () =>
    withProgress("Loading task history", async (onProgress) => {
      const changes = await collectAll((params) => getClient().tasks.getProjectTaskChanges(projectId!, params), {
        onProgress,
      });
      return foldTaskChanges(changes as TaskChange[]);
    }),
  );
}

export function useUsers(projectId: string | undefined) {
  return useCachedLoad<UserEntry[]>(projectId && `users:${projectId}`, 60 * MINUTE, async () => {
    const client = getClient();
    const [users, companies] = await Promise.all([
      collectAll((params) => client.users.listProjectUsers(projectId!, params)),
      // Company names only decorate users; a key without access to companies still gets the user list.
      collectAll((params) => client.companies.listProjectCompanies(projectId!, params)).catch(() => []),
    ]);
    const companyNames = new Map<string, string>();
    for (const company of companies) {
      if (company.companyId && company.name) companyNames.set(company.companyId, company.name);
    }
    return users.map((user) => toUserEntry(user, companyNames)).sort((a, b) => a.name.localeCompare(b.name));
  });
}

export function useWorkPackages(projectId: string | undefined) {
  return useCachedLoad<WorkPackage[]>(projectId && `work-packages:${projectId}`, 60 * MINUTE, async () => {
    const items = await collectAll((params) => getClient().workPackages.listWorkPackages(projectId!, params));
    return items
      .filter((wp) => wp.workpackageId)
      .map((wp) => ({ workpackageId: wp.workpackageId!, name: wp.name ?? wp.workpackageId! }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

async function loadFolders(projectId: string, fileAreaId: string): Promise<Folder[]> {
  const items = await collectAll((params) => getClient().folders.listFolders(projectId, fileAreaId, params));
  return items.map((f) => ({ folderId: f.folderId, folderName: f.folderName, parentFolderId: f.parentFolderId }));
}

/** Every file area of a project with its folders and (non-deleted) files. */
export function useProjectFiles(projectId: string | undefined) {
  return useCachedLoad<ProjectFiles>(projectId && `files:${projectId}`, 15 * MINUTE, () =>
    withProgress("Loading files", async (onProgress) => {
      const client = getClient();
      const areas = await collectAll((params) => client.fileAreas.getFileAreas(projectId!, params));
      const loadedPerArea = areas.map(() => 0);
      const perArea = await Promise.all(
        areas.map(async (area, index) => {
          const [folders, files] = await Promise.all([
            loadFolders(projectId!, area.fileAreaId),
            collectAll((params) => client.files.listFiles(projectId!, area.fileAreaId, params), {
              onProgress: (count) => {
                loadedPerArea[index] = count;
                onProgress(
                  loadedPerArea.reduce((a, b) => a + b, 0),
                  undefined,
                );
              },
            }),
          ]);
          const paths = folderPaths(folders);
          return {
            folders,
            files: (files as DaluxFile[])
              .filter((f) => !f.deleted)
              .map((f) => toFileEntry(f, area.fileAreaName, paths)),
          };
        }),
      );
      return {
        fileAreas: areas.map((a) => ({
          fileAreaId: a.fileAreaId,
          fileAreaName: a.fileAreaName,
          fileAreaType: a.fileAreaType,
        })),
        folders: Object.fromEntries(areas.map((area, i) => [area.fileAreaId, perArea[i].folders])),
        files: perArea.flatMap((area) => area.files),
      };
    }),
  );
}

export function useVersionSets(projectId: string | undefined) {
  return useCachedLoad<VersionSet[]>(projectId && `version-sets:${projectId}`, 15 * MINUTE, async () => {
    const items = await collectAll((params) => getClient().versionSets.getVersionSets(projectId!, params));
    return items
      .map((vs) => ({
        versionSetId: vs.versionSetId,
        name: vs.name,
        description: vs.description ?? undefined,
        status: vs.status ?? undefined,
        fileAreaId: vs.fileAreaId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

export function useVersionSetFiles(projectId: string, versionSet: VersionSet) {
  return useCachedLoad<FileEntry[]>(
    `version-set-files:${projectId}:${versionSet.versionSetId}`,
    15 * MINUTE,
    async () => {
      const client = getClient();
      const [area, folders, files] = await Promise.all([
        client.fileAreas.getFileArea(projectId, versionSet.fileAreaId),
        loadFolders(projectId, versionSet.fileAreaId),
        collectAll((params) => client.versionSets.listVersionSetFiles(projectId, versionSet.versionSetId, params)),
      ]);
      const paths = folderPaths(folders);
      return (files as DaluxFile[]).filter((f) => !f.deleted).map((f) => toFileEntry(f, area.fileAreaName, paths));
    },
  );
}
