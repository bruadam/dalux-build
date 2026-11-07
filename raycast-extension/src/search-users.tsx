import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useMemo, useState } from "react";
import { CommonActions } from "./components/CommonActions";
import { UserTaskList } from "./components/UserTaskList";
import { useUsers } from "./lib/data";
import { ErrorView } from "./lib/errors";
import { ProjectDropdown, useSelectedProject } from "./lib/projects";
import { rankItems } from "./lib/rank";
import { userRankFields } from "./lib/users";

export default function SearchUsers() {
  const { project, projects, setProjectId } = useSelectedProject();
  const users = useUsers(project?.projectId);
  const [searchText, setSearchText] = useState("");
  const [showingDetail, setShowingDetail] = useCachedState("users-show-detail", false);
  const results = useMemo(() => rankItems(users.data ?? [], searchText, userRankFields), [users.data, searchText]);
  const error = projects.error ?? users.error;

  return (
    <List
      isLoading={projects.isLoading || users.isLoading}
      filtering={false}
      onSearchTextChange={setSearchText}
      isShowingDetail={showingDetail && results.length > 0}
      searchBarPlaceholder="Search users by name, email or company…"
      searchBarAccessory={<ProjectDropdown projects={projects.data ?? []} project={project} onChange={setProjectId} />}
    >
      {error && !users.data ? (
        <ErrorView error={error} onRetry={() => (projects.error ? projects.refresh() : users.refresh())} />
      ) : (
        <List.EmptyView icon={Icon.PersonCircle} title={searchText ? "No matching users" : "No users"} />
      )}
      {results.map((user) => (
        <List.Item
          key={user.userId}
          icon={Icon.Person}
          title={user.name}
          subtitle={showingDetail ? undefined : user.email}
          keywords={[user.email]}
          accessories={
            showingDetail || !user.companyName ? undefined : [{ icon: Icon.Building, text: user.companyName }]
          }
          detail={
            <List.Item.Detail
              metadata={
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label title="Name" text={user.name} />
                  <List.Item.Detail.Metadata.Link title="Email" text={user.email} target={`mailto:${user.email}`} />
                  {user.companyName && <List.Item.Detail.Metadata.Label title="Company" text={user.companyName} />}
                  {user.userType && <List.Item.Detail.Metadata.Label title="User Type" text={user.userType} />}
                </List.Item.Detail.Metadata>
              }
            />
          }
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action.CopyToClipboard title="Copy Email" content={user.email} />
                <Action.OpenInBrowser
                  title="Send Email"
                  icon={Icon.Envelope}
                  url={`mailto:${user.email}`}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
                />
                <Action.CopyToClipboard
                  title="Copy Name"
                  content={user.name}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
                />
                <Action.CopyToClipboard
                  title="Copy Name and Email"
                  content={`${user.name} <${user.email}>`}
                  shortcut={Keyboard.Shortcut.Common.Copy}
                />
              </ActionPanel.Section>
              {project && (
                <Action.Push
                  title="Show Tasks"
                  icon={Icon.CheckList}
                  shortcut={{ modifiers: ["cmd"], key: "t" }}
                  target={<UserTaskList projectId={project.projectId} user={user} />}
                />
              )}
              <CommonActions onToggleDetail={() => setShowingDetail(!showingDetail)} onRefresh={users.refresh} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
