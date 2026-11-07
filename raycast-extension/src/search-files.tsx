import { FileList } from "./components/FileList";
import { useProjectFiles } from "./lib/data";
import { ProjectDropdown, useSelectedProject } from "./lib/projects";

export default function SearchFiles() {
  const { project, projects, setProjectId } = useSelectedProject();
  const files = useProjectFiles(project?.projectId);
  return (
    <FileList
      projectId={project?.projectId}
      files={files.data?.files}
      isLoading={projects.isLoading || files.isLoading}
      error={projects.error ?? files.error}
      onRefresh={projects.error ? projects.refresh : files.refresh}
      searchBarAccessory={<ProjectDropdown projects={projects.data ?? []} project={project} onChange={setProjectId} />}
    />
  );
}
