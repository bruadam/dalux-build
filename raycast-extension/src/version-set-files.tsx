import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { CommonActions } from "./components/CommonActions";
import { FileList } from "./components/FileList";
import { useVersionSetFiles, useVersionSets, type VersionSet } from "./lib/data";
import { ErrorView } from "./lib/errors";
import { ProjectDropdown, useSelectedProject } from "./lib/projects";

function VersionSetFiles({ projectId, versionSet }: { projectId: string; versionSet: VersionSet }) {
  const files = useVersionSetFiles(projectId, versionSet);
  return (
    <FileList
      projectId={projectId}
      navigationTitle={versionSet.name}
      files={files.data}
      isLoading={files.isLoading}
      error={files.error}
      onRefresh={files.refresh}
    />
  );
}

export default function VersionSetFilesCommand() {
  const { project, projects, setProjectId } = useSelectedProject();
  const versionSets = useVersionSets(project?.projectId);
  const error = projects.error ?? versionSets.error;
  return (
    <List
      isLoading={projects.isLoading || versionSets.isLoading}
      searchBarPlaceholder="Pick a version set…"
      searchBarAccessory={<ProjectDropdown projects={projects.data ?? []} project={project} onChange={setProjectId} />}
    >
      {error && !versionSets.data ? (
        <ErrorView error={error} onRetry={() => (projects.error ? projects.refresh() : versionSets.refresh())} />
      ) : (
        <List.EmptyView icon={Icon.Layers} title="No version sets" />
      )}
      {(versionSets.data ?? []).map((versionSet) => (
        <List.Item
          key={versionSet.versionSetId}
          icon={Icon.Layers}
          title={versionSet.name}
          subtitle={versionSet.description}
          accessories={versionSet.status ? [{ tag: versionSet.status }] : undefined}
          actions={
            <ActionPanel>
              {project && (
                <Action.Push
                  title="Show Files"
                  icon={Icon.Document}
                  target={<VersionSetFiles projectId={project.projectId} versionSet={versionSet} />}
                />
              )}
              <CommonActions onRefresh={versionSets.refresh} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
