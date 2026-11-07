import { TaskList } from "./components/TaskList";
import { ErrorView } from "./lib/errors";
import { ProjectDropdown, useSelectedProject } from "./lib/projects";
import { List } from "@raycast/api";

export default function SearchTasks() {
  const { project, projects, setProjectId } = useSelectedProject();
  if (projects.error && !projects.data) {
    return (
      <List>
        <ErrorView error={projects.error} onRetry={projects.refresh} />
      </List>
    );
  }
  return (
    <TaskList
      projectId={project?.projectId}
      searchBarAccessory={<ProjectDropdown projects={projects.data ?? []} project={project} onChange={setProjectId} />}
    />
  );
}
