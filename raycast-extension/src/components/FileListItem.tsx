import { Action, ActionPanel, Icon, Keyboard, List, open, showInFinder, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { downloadFile } from "../lib/download";
import type { FileEntry } from "../lib/files";
import { formatBytes, formatDate } from "../lib/format";

async function fetchThen(file: FileEntry, then: (filePath: string) => Promise<void>) {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Downloading", message: file.fileName });
  try {
    const filePath = await downloadFile(file);
    await toast.hide();
    await then(filePath);
  } catch (error) {
    await toast.hide();
    await showFailureToast(error, { title: "Could not download file" });
  }
}

export function FileActions({ file, extra }: { file: FileEntry; extra?: React.ReactNode }) {
  return (
    <>
      <ActionPanel.Section>
        <Action title="Open File" icon={Icon.Document} onAction={() => fetchThen(file, (p) => open(p))} />
        <Action
          title="Show in Finder"
          icon={Icon.Finder}
          shortcut={{ modifiers: ["cmd"], key: "f" }}
          onAction={() => fetchThen(file, (p) => showInFinder(p))}
        />
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="Copy File Name"
          content={file.fileName}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
        <Action.CopyToClipboard
          title="Copy Folder Path"
          content={[file.fileAreaName, file.folderPath].filter(Boolean).join("/")}
          shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
        />
        {file.downloadLink && (
          <Action.CopyToClipboard
            title="Copy API Download Link"
            content={file.downloadLink}
            shortcut={{ modifiers: ["cmd", "shift"], key: "l" }}
          />
        )}
      </ActionPanel.Section>
      {extra}
    </>
  );
}

export function FileDetail({ file, userName }: { file: FileEntry; userName?: string }) {
  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Name" text={file.fileName} />
          <List.Item.Detail.Metadata.Label title="File Area" text={file.fileAreaName} />
          <List.Item.Detail.Metadata.Label title="Folder" text={file.folderPath || "—"} />
          <List.Item.Detail.Metadata.Separator />
          {file.version && <List.Item.Detail.Metadata.Label title="Version" text={file.version} />}
          {file.fileType && <List.Item.Detail.Metadata.Label title="Type" text={file.fileType} />}
          {file.fileSize != null && <List.Item.Detail.Metadata.Label title="Size" text={formatBytes(file.fileSize)} />}
          {file.lastModified && (
            <List.Item.Detail.Metadata.Label title="Last Modified" text={formatDate(file.lastModified)} />
          )}
          {userName && <List.Item.Detail.Metadata.Label title="Last Modified By" text={userName} />}
          {file.uploaded && <List.Item.Detail.Metadata.Label title="Uploaded" text={formatDate(file.uploaded)} />}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

export function FileListItem({
  file,
  showingDetail,
  userName,
  extraActions,
}: {
  file: FileEntry;
  showingDetail: boolean;
  userName?: string;
  extraActions?: React.ReactNode;
}) {
  const location = [file.fileAreaName, file.folderPath].filter(Boolean).join("/");
  return (
    <List.Item
      id={`${file.fileAreaId}:${file.fileId}`}
      icon={{ fileIcon: file.fileName }}
      title={file.fileName}
      subtitle={showingDetail ? undefined : location}
      accessories={
        showingDetail
          ? undefined
          : [
              ...(file.version ? [{ tag: file.version, tooltip: "Version" }] : []),
              { date: file.lastModified ? new Date(file.lastModified) : undefined, tooltip: "Last modified" },
            ]
      }
      detail={<FileDetail file={file} userName={userName} />}
      actions={
        <ActionPanel>
          <FileActions file={file} extra={extraActions} />
        </ActionPanel>
      }
    />
  );
}
