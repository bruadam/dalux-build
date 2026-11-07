import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useMemo } from "react";
import { CommonActions } from "./components/CommonActions";
import { FileList } from "./components/FileList";
import { FileListItem } from "./components/FileListItem";
import { useProjectFiles, type FileArea, type ProjectFiles } from "./lib/data";
import { ErrorView } from "./lib/errors";
import { folderPaths, type Folder } from "./lib/files";
import { ProjectDropdown, useSelectedProject } from "./lib/projects";

interface Location {
  projectId: string;
  data: ProjectFiles;
  area: FileArea;
  folder?: Folder;
  title: string;
  onRefresh: () => void;
}

/** Child folders and files of a folder (or of the file area root). */
function FolderView(location: Location) {
  const { data, area, folder, projectId } = location;
  const [showingDetail, setShowingDetail] = useCachedState("files-show-detail", false);
  const { folders, files } = useMemo(() => {
    const areaFolders = data.folders[area.fileAreaId] ?? [];
    const ids = new Set(areaFolders.map((f) => f.folderId));
    const isChild = (parentId: string | null | undefined) =>
      folder ? parentId === folder.folderId : !parentId || !ids.has(parentId);
    return {
      folders: areaFolders
        .filter((f) => isChild(f.parentFolderId))
        .sort((a, b) => a.folderName.localeCompare(b.folderName)),
      files: data.files
        .filter(
          (f) =>
            f.fileAreaId === area.fileAreaId &&
            (folder ? f.folderId === folder.folderId : !f.folderId || !ids.has(f.folderId)),
        )
        .sort((a, b) => a.fileName.localeCompare(b.fileName)),
    };
  }, [data, area, folder]);

  const searchBelow = (target: Folder | undefined, title: string) => {
    const prefix = target ? folderPaths(data.folders[area.fileAreaId] ?? []).get(target.folderId) : undefined;
    const below = data.files.filter(
      (f) =>
        f.fileAreaId === area.fileAreaId &&
        (!target || f.folderId === target.folderId || (prefix !== undefined && f.folderPath.startsWith(`${prefix}/`))),
    );
    return (
      <Action.Push
        title="Search Below This Folder"
        icon={Icon.MagnifyingGlass}
        shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
        target={
          <FileList
            projectId={projectId}
            navigationTitle={title}
            files={below}
            isLoading={false}
            error={undefined}
            onRefresh={location.onRefresh}
          />
        }
      />
    );
  };

  return (
    <List
      navigationTitle={location.title}
      isShowingDetail={showingDetail && files.length > 0}
      searchBarPlaceholder="Filter this folder…"
    >
      <List.EmptyView icon={Icon.Folder} title="Empty folder" />
      <List.Section title="Folders">
        {folders.map((child) => (
          <List.Item
            key={child.folderId}
            icon={Icon.Folder}
            title={child.folderName}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Open Folder"
                  icon={Icon.Folder}
                  target={<FolderView {...location} folder={child} title={`${location.title}/${child.folderName}`} />}
                />
                {searchBelow(child, `${location.title}/${child.folderName}`)}
                <CommonActions onRefresh={location.onRefresh} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      <List.Section title="Files">
        {files.map((file) => (
          <FileListItem
            key={file.fileId}
            file={file}
            showingDetail={showingDetail}
            extraActions={
              <>
                <ActionPanel.Section>{searchBelow(folder, location.title)}</ActionPanel.Section>
                <CommonActions onToggleDetail={() => setShowingDetail(!showingDetail)} onRefresh={location.onRefresh} />
              </>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

export default function OpenFile() {
  const { project, projects, setProjectId } = useSelectedProject();
  const files = useProjectFiles(project?.projectId);
  const error = projects.error ?? files.error;
  return (
    <List
      isLoading={projects.isLoading || files.isLoading}
      searchBarPlaceholder="Pick a file area…"
      searchBarAccessory={<ProjectDropdown projects={projects.data ?? []} project={project} onChange={setProjectId} />}
    >
      {error && !files.data ? (
        <ErrorView error={error} onRetry={() => (projects.error ? projects.refresh() : files.refresh())} />
      ) : (
        <List.EmptyView icon={Icon.Folder} title={files.isLoading ? "Loading files…" : "No file areas"} />
      )}
      {project &&
        files.data?.fileAreas.map((area) => (
          <List.Item
            key={area.fileAreaId}
            icon={Icon.HardDrive}
            title={area.fileAreaName}
            subtitle={area.fileAreaType}
            accessories={[
              {
                text: `${files.data!.files.filter((f) => f.fileAreaId === area.fileAreaId).length.toLocaleString()} files`,
              },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Open File Area"
                  icon={Icon.Folder}
                  target={
                    <FolderView
                      projectId={project.projectId}
                      data={files.data!}
                      area={area}
                      title={area.fileAreaName}
                      onRefresh={files.refresh}
                    />
                  }
                />
                <CommonActions onRefresh={files.refresh} />
              </ActionPanel>
            }
          />
        ))}
    </List>
  );
}
