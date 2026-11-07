import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useMemo } from "react";
import { CommonActions } from "./components/CommonActions";
import { TaskList } from "./components/TaskList";
import { useTaskStates, useWorkPackages, type WorkPackage } from "./lib/data";
import { ErrorView } from "./lib/errors";
import { ProjectDropdown, useSelectedProject } from "./lib/projects";

function WorkPackageTaskList({ projectId, workPackage }: { projectId: string; workPackage: WorkPackage }) {
  return (
    <TaskList
      projectId={projectId}
      navigationTitle={workPackage.name}
      sectionOf={(_task, state) => (state?.workpackageId === workPackage.workpackageId ? workPackage.name : undefined)}
      needsHistory
      emptyTitle="No tasks in this work package"
    />
  );
}

export default function WorkPackageTasks() {
  const { project, projects, setProjectId } = useSelectedProject();
  const workPackages = useWorkPackages(project?.projectId);
  const states = useTaskStates(project?.projectId);

  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const state of Object.values(states.data ?? {})) {
      if (state.workpackageId) result.set(state.workpackageId, (result.get(state.workpackageId) ?? 0) + 1);
    }
    return result;
  }, [states.data]);

  const error = projects.error ?? workPackages.error;
  return (
    <List
      isLoading={projects.isLoading || workPackages.isLoading || states.isLoading}
      searchBarPlaceholder="Pick a work package…"
      searchBarAccessory={<ProjectDropdown projects={projects.data ?? []} project={project} onChange={setProjectId} />}
    >
      {error && !workPackages.data ? (
        <ErrorView error={error} onRetry={() => (projects.error ? projects.refresh() : workPackages.refresh())} />
      ) : (
        <List.EmptyView icon={Icon.Box} title="No work packages" />
      )}
      {(workPackages.data ?? []).map((workPackage) => (
        <List.Item
          key={workPackage.workpackageId}
          icon={Icon.Box}
          title={workPackage.name}
          accessories={
            states.data
              ? [{ icon: Icon.CheckList, text: String(counts.get(workPackage.workpackageId) ?? 0), tooltip: "Tasks" }]
              : undefined
          }
          actions={
            <ActionPanel>
              {project && (
                <Action.Push
                  title="Show Tasks"
                  icon={Icon.CheckList}
                  target={<WorkPackageTaskList projectId={project.projectId} workPackage={workPackage} />}
                />
              )}
              <CommonActions
                onRefresh={() => {
                  workPackages.refresh();
                  states.refresh();
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
