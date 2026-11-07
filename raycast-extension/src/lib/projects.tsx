import { getPreferenceValues, List } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { type Project, useProjects } from "./data";

/**
 * The project the command works on: the last project picked in any command,
 * else the "Default Project" preference (name, number or ID), else the first
 * project.
 */
export function useSelectedProject() {
  const projects = useProjects();
  const [lastProjectId, setLastProjectId] = useCachedState<string | undefined>("last-project-id", undefined);
  const { defaultProject } = getPreferenceValues<Preferences>();

  const list = projects.data ?? [];
  const wanted = defaultProject?.trim().toLowerCase();
  const project =
    list.find((p) => p.projectId === lastProjectId) ??
    (wanted
      ? list.find((p) => [p.projectId, p.projectName, p.number].some((v) => v?.toLowerCase() === wanted))
      : undefined) ??
    list[0];

  return { project, projects, setProjectId: setLastProjectId };
}

export function ProjectDropdown({
  projects,
  project,
  onChange,
}: {
  projects: Project[];
  project: Project | undefined;
  onChange: (projectId: string) => void;
}) {
  return (
    <List.Dropdown
      tooltip="Project"
      value={project?.projectId ?? ""}
      onChange={(projectId) => projectId && projectId !== project?.projectId && onChange(projectId)}
    >
      {projects.map((p) => (
        <List.Dropdown.Item
          key={p.projectId}
          value={p.projectId}
          title={p.number ? `${p.projectName} (${p.number})` : p.projectName}
          keywords={[p.number ?? "", p.projectId]}
        />
      ))}
    </List.Dropdown>
  );
}
