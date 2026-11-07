import { TaskList } from "./TaskList";
import type { TaskState, TaskSummary } from "../lib/tasks";
import type { UserEntry } from "../lib/users";

/**
 * A user's tasks: the ones they are currently responsible for (from the change
 * history) and the ones they created (`createdBy` on the task).
 */
export function UserTaskList({ projectId, user }: { projectId: string; user: UserEntry }) {
  const sectionOf = (task: TaskSummary, state: TaskState | undefined) => {
    if (state?.responsibleUserId === user.userId) return "Currently Responsible";
    if (task.createdByUserId === user.userId) return "Created";
    return undefined;
  };
  return (
    <TaskList
      projectId={projectId}
      navigationTitle={`Tasks · ${user.name}`}
      sectionOf={sectionOf}
      needsHistory
      emptyTitle={`${user.name} has no tasks`}
    />
  );
}
