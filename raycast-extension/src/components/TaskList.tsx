import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useMemo, useState } from "react";
import { CommonActions } from "./CommonActions";
import { useTaskStates, useTasks, useUsers, useWorkPackages } from "../lib/data";
import { ErrorView } from "../lib/errors";
import { byNewest, formatDate } from "../lib/format";
import { rankItems } from "../lib/rank";
import { isClosed, taskRankFields, type TaskContext, type TaskState, type TaskSummary } from "../lib/tasks";

const MAX_ITEMS = 200;

type StatusFilter = "all" | "open" | "closed";

interface Row {
  task: TaskSummary;
  context: TaskContext & { createdByName?: string };
  section: string;
}

export interface TaskListProps {
  projectId: string | undefined;
  navigationTitle?: string;
  searchBarAccessory?: List.Props["searchBarAccessory"];
  /** Section title for a task, or undefined to leave it out. Defaults to one "Tasks" section. */
  sectionOf?: (task: TaskSummary, state: TaskState | undefined) => string | undefined;
  /** Whether the list needs the change history (status, responsible, work package) to be complete. */
  needsHistory?: boolean;
  emptyTitle?: string;
}

function statusColor(state: TaskState | undefined): Color {
  if (!state?.status) return Color.SecondaryText;
  return isClosed(state) ? Color.Green : Color.Orange;
}

function TaskDetail({ row }: { row: Row }) {
  const { task, context } = row;
  const state = context.state;
  const activity = (state?.comments ?? [])
    .map(
      (c) =>
        `- **${formatDate(c.timestamp)}**${c.action ? ` · ${c.action}` : ""}\n\n  ${c.text.replace(/\n/g, "\n  ")}`,
    )
    .join("\n");
  const markdown = [
    `## ${task.subject ?? "(no subject)"}`,
    task.userDefinedFields.length
      ? task.userDefinedFields.map((f) => `**${f.name}:** ${f.value}`).join("  \n")
      : undefined,
    activity ? `### Recent activity\n\n${activity}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          {task.number && <List.Item.Detail.Metadata.Label title="Number" text={task.number} />}
          {task.typeName && <List.Item.Detail.Metadata.Label title="Type" text={task.typeName} />}
          {task.usage && <List.Item.Detail.Metadata.Label title="Usage" text={task.usage} />}
          {task.workflowName && <List.Item.Detail.Metadata.Label title="Workflow" text={task.workflowName} />}
          {state?.status && (
            <List.Item.Detail.Metadata.TagList title="Status">
              <List.Item.Detail.Metadata.TagList.Item text={state.status} color={statusColor(state)} />
            </List.Item.Detail.Metadata.TagList>
          )}
          <List.Item.Detail.Metadata.Separator />
          {context.responsibleName && (
            <List.Item.Detail.Metadata.Label title="Responsible" text={context.responsibleName} />
          )}
          {state?.assignedTo && <List.Item.Detail.Metadata.Label title="Assigned To" text={state.assignedTo} />}
          {state?.deadline && <List.Item.Detail.Metadata.Label title="Deadline" text={formatDate(state.deadline)} />}
          {context.workPackageName && (
            <List.Item.Detail.Metadata.Label title="Work Package" text={context.workPackageName} />
          )}
          <List.Item.Detail.Metadata.Separator />
          {task.created && <List.Item.Detail.Metadata.Label title="Created" text={formatDate(task.created)} />}
          {context.createdByName && <List.Item.Detail.Metadata.Label title="Created By" text={context.createdByName} />}
          {state?.lastChangeAt && (
            <List.Item.Detail.Metadata.Label title="Last Change" text={formatDate(state.lastChangeAt)} />
          )}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export function TaskList({
  projectId,
  navigationTitle,
  searchBarAccessory,
  sectionOf,
  needsHistory,
  emptyTitle,
}: TaskListProps) {
  const [searchText, setSearchText] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [showingDetail, setShowingDetail] = useCachedState("tasks-show-detail", true);
  const tasks = useTasks(projectId);
  const states = useTaskStates(projectId);
  const users = useUsers(projectId);
  const workPackages = useWorkPackages(projectId);

  const rows = useMemo(() => {
    const userNames = new Map((users.data ?? []).map((u) => [u.userId, u.name]));
    const workPackageNames = new Map((workPackages.data ?? []).map((wp) => [wp.workpackageId, wp.name]));
    const all: Row[] = [];
    for (const task of tasks.data ?? []) {
      const state = states.data?.[task.taskId];
      const section = sectionOf ? sectionOf(task, state) : "Tasks";
      if (!section) continue;
      if (status === "open" && (!state || isClosed(state))) continue;
      if (status === "closed" && !isClosed(state)) continue;
      all.push({
        task,
        section,
        context: {
          state,
          responsibleName: state?.responsibleUserId ? userNames.get(state.responsibleUserId) : undefined,
          workPackageName: state?.workpackageId ? workPackageNames.get(state.workpackageId) : undefined,
          createdByName: task.createdByUserId ? userNames.get(task.createdByUserId) : undefined,
        },
      });
    }
    const ordered = searchText.trim()
      ? rankItems(all, searchText, (row) => taskRankFields(row.task, row.context))
      : all.sort(byNewest((row) => row.context.state?.lastChangeAt ?? row.task.created));
    return ordered.slice(0, MAX_ITEMS);
  }, [tasks.data, states.data, users.data, workPackages.data, searchText, status, sectionOf]);

  const sections = useMemo(() => {
    const grouped = new Map<string, Row[]>();
    for (const row of rows) grouped.set(row.section, [...(grouped.get(row.section) ?? []), row]);
    return [...grouped];
  }, [rows]);

  const refresh = () => {
    tasks.refresh();
    states.refresh();
  };
  const error = tasks.error ?? (needsHistory ? states.error : undefined);
  const historyPending = !states.data && states.isLoading;

  return (
    <List
      navigationTitle={navigationTitle}
      isLoading={tasks.isLoading || states.isLoading || users.isLoading}
      isShowingDetail={showingDetail && rows.length > 0}
      filtering={false}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search by number, subject, type, status, responsible…"
      searchBarAccessory={
        searchBarAccessory ?? (
          <List.Dropdown tooltip="Status" value={status} onChange={(v) => setStatus(v as StatusFilter)}>
            <List.Dropdown.Item title="All Statuses" value="all" />
            <List.Dropdown.Item title="Open" value="open" />
            <List.Dropdown.Item title="Closed" value="closed" />
          </List.Dropdown>
        )
      }
    >
      {error && !tasks.data ? (
        <ErrorView error={error} onRetry={refresh} />
      ) : (
        <List.EmptyView
          icon={Icon.CheckList}
          title={
            historyPending && needsHistory
              ? "Loading task history…"
              : searchText
                ? "No matching tasks"
                : (emptyTitle ?? "No tasks")
          }
          description={
            historyPending && needsHistory ? "The first load of a large project can take a few minutes." : undefined
          }
        />
      )}
      {sections.map(([title, sectionRows]) => (
        <List.Section key={title} title={title} subtitle={String(sectionRows.length)}>
          {sectionRows.map((row) => (
            <List.Item
              key={row.task.taskId}
              id={row.task.taskId}
              icon={{ source: Icon.Circle, tintColor: statusColor(row.context.state) }}
              title={row.task.subject ?? "(no subject)"}
              subtitle={
                showingDetail ? row.task.number : [row.task.number, row.task.typeName].filter(Boolean).join(" · ")
              }
              accessories={
                showingDetail
                  ? undefined
                  : [
                      ...(row.context.responsibleName
                        ? [{ icon: Icon.Person, text: row.context.responsibleName }]
                        : []),
                      ...(row.context.state?.status
                        ? [{ tag: { value: row.context.state.status, color: statusColor(row.context.state) } }]
                        : []),
                    ]
              }
              detail={<TaskDetail row={row} />}
              actions={
                <ActionPanel>
                  <ActionPanel.Section>
                    {row.task.number && (
                      <Action.CopyToClipboard
                        title="Copy Task Number"
                        content={row.task.number}
                        shortcut={Keyboard.Shortcut.Common.Copy}
                      />
                    )}
                    {row.task.subject && (
                      <Action.CopyToClipboard
                        title="Copy Subject"
                        content={row.task.subject}
                        shortcut={Keyboard.Shortcut.Common.CopyName}
                      />
                    )}
                    <Action.CopyToClipboard
                      title="Copy Task ID"
                      content={row.task.taskId}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
                    />
                  </ActionPanel.Section>
                  <CommonActions onToggleDetail={() => setShowingDetail(!showingDetail)} onRefresh={refresh} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
