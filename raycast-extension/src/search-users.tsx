import { Action, ActionPanel, Icon, Keyboard, List } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useMemo, useState } from "react";
import { CommonActions } from "./components/CommonActions";
import { UserFileList } from "./components/UserFileList";
import { UserTaskList } from "./components/UserTaskList";
import { useUsers } from "./lib/data";
import { ErrorView } from "./lib/errors";
import { ProjectDropdown, useSelectedProject } from "./lib/projects";
import { rankItems } from "./lib/rank";
import { userRankFields, type UserEntry } from "./lib/users";

function UserProfile({ user }: { user: UserEntry }) {
  const { Metadata } = List.Item.Detail;
  return (
    <List.Item.Detail
      markdown={user.companyName ? `## ${user.name}\n\n${user.companyName}` : `## ${user.name}`}
      metadata={
        <Metadata>
          <Metadata.Link title="Email" text={user.email} target={`mailto:${user.email}`} />
          {user.userType && <Metadata.Label title="User Type" text={user.userType} />}
          {user.companyName && (
            <>
              <Metadata.Separator />
              <Metadata.Label title="Company" text={user.companyName} icon={Icon.Building} />
              {user.companyAddress && <Metadata.Label title="Address" text={user.companyAddress} />}
              {user.companyVatNumber && <Metadata.Label title="VAT Number" text={user.companyVatNumber} />}
            </>
          )}
          <Metadata.Separator />
          <Metadata.Label title="User ID" text={user.userId} />
        </Metadata>
      }
    />
  );
}

export default function SearchUsers() {
  const { project, projects, setProjectId } = useSelectedProject();
  const users = useUsers(project?.projectId);
  const [searchText, setSearchText] = useState("");
  const [showingDetail, setShowingDetail] = useCachedState("users-show-profile", true);
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
          detail={<UserProfile user={user} />}
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
                <ActionPanel.Section>
                  <Action.Push
                    title="Show Tasks"
                    icon={Icon.CheckList}
                    shortcut={{ modifiers: ["cmd"], key: "t" }}
                    target={<UserTaskList projectId={project.projectId} user={user} />}
                  />
                  <Action.Push
                    title="Show Files"
                    icon={Icon.Document}
                    shortcut={{ modifiers: ["cmd"], key: "f" }}
                    target={<UserFileList projectId={project.projectId} user={user} />}
                  />
                </ActionPanel.Section>
              )}
              <CommonActions onToggleDetail={() => setShowingDetail(!showingDetail)} onRefresh={users.refresh} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
