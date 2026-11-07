import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useMemo } from "react";
import { CommonActions } from "./components/CommonActions";
import { UserTaskList } from "./components/UserTaskList";
import { useTaskStates, useTasks, useUsers } from "./lib/data";
import { ErrorView } from "./lib/errors";
import { ProjectDropdown, useSelectedProject } from "./lib/projects";

export default function UserTasks() {
  const { project, projects, setProjectId } = useSelectedProject();
  const users = useUsers(project?.projectId);
  const tasks = useTasks(project?.projectId);
  const states = useTaskStates(project?.projectId);

  const counts = useMemo(() => {
    const result = new Map<string, { responsible: number; created: number }>();
    const bump = (userId: string | undefined, key: "responsible" | "created") => {
      if (!userId) return;
      const entry = result.get(userId) ?? { responsible: 0, created: 0 };
      entry[key] += 1;
      result.set(userId, entry);
    };
    for (const state of Object.values(states.data ?? {})) bump(state.responsibleUserId, "responsible");
    for (const task of tasks.data ?? []) bump(task.createdByUserId, "created");
    return result;
  }, [tasks.data, states.data]);

  const error = projects.error ?? users.error;
  return (
    <List
      isLoading={projects.isLoading || users.isLoading || tasks.isLoading || states.isLoading}
      searchBarPlaceholder="Pick a user by name or email…"
      searchBarAccessory={<ProjectDropdown projects={projects.data ?? []} project={project} onChange={setProjectId} />}
    >
      {error && !users.data ? (
        <ErrorView error={error} onRetry={() => (projects.error ? projects.refresh() : users.refresh())} />
      ) : (
        <List.EmptyView icon={Icon.PersonCircle} title="No users" />
      )}
      {(users.data ?? []).map((user) => {
        const count = counts.get(user.userId);
        return (
          <List.Item
            key={user.userId}
            icon={Icon.Person}
            title={user.name}
            subtitle={user.email}
            keywords={[user.email, user.companyName ?? ""]}
            accessories={[
              ...(count?.responsible
                ? [{ icon: Icon.Person, text: String(count.responsible), tooltip: "Currently responsible" }]
                : []),
              ...(count?.created ? [{ icon: Icon.Plus, text: String(count.created), tooltip: "Created" }] : []),
            ]}
            actions={
              <ActionPanel>
                {project && (
                  <Action.Push
                    title="Show Tasks"
                    icon={Icon.CheckList}
                    target={<UserTaskList projectId={project.projectId} user={user} />}
                  />
                )}
                <CommonActions onRefresh={users.refresh} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
