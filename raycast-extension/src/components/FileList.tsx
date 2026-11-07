import { Icon, List } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import { useMemo, useState } from "react";
import { CommonActions } from "./CommonActions";
import { FileListItem } from "./FileListItem";
import { useUsers } from "../lib/data";
import { ErrorView } from "../lib/errors";
import { fileRankFields, type FileEntry } from "../lib/files";
import { byNewest } from "../lib/format";
import { rankItems } from "../lib/rank";

const MAX_ITEMS = 200;

/** A ranked, searchable list of files. Without a query it shows the most recently modified files. */
export function FileList({
  projectId,
  files,
  isLoading,
  error,
  onRefresh,
  navigationTitle,
  searchBarAccessory,
}: {
  projectId: string | undefined;
  files: FileEntry[] | undefined;
  isLoading: boolean;
  error: Error | undefined;
  onRefresh: () => void;
  navigationTitle?: string;
  searchBarAccessory?: List.Props["searchBarAccessory"];
}) {
  const [searchText, setSearchText] = useState("");
  const [showingDetail, setShowingDetail] = useCachedState("files-show-detail", false);
  const users = useUsers(projectId);
  const userNames = useMemo(() => new Map((users.data ?? []).map((u) => [u.userId, u.name])), [users.data]);

  const results = useMemo(() => {
    const all = files ?? [];
    const ordered = searchText.trim()
      ? rankItems(all, searchText, fileRankFields)
      : [...all].sort(byNewest((f) => f.lastModified ?? f.uploaded));
    return ordered.slice(0, MAX_ITEMS);
  }, [files, searchText]);

  return (
    <List
      navigationTitle={navigationTitle}
      isLoading={isLoading}
      filtering={false}
      onSearchTextChange={setSearchText}
      isShowingDetail={showingDetail && results.length > 0}
      searchBarPlaceholder="Search files by name, number or folder…"
      searchBarAccessory={searchBarAccessory}
    >
      {error && !files ? (
        <ErrorView error={error} onRetry={onRefresh} />
      ) : (
        <List.EmptyView
          icon={Icon.Document}
          title={isLoading && !files ? "Loading files…" : searchText ? "No matching files" : "No files"}
        />
      )}
      <List.Section
        title={searchText.trim() ? "Best Matches" : "Recently Modified"}
        subtitle={files ? `${results.length} of ${files.length.toLocaleString()}` : undefined}
      >
        {results.map((file) => (
          <FileListItem
            key={`${file.fileAreaId}:${file.fileId}`}
            file={file}
            showingDetail={showingDetail}
            userName={file.lastModifiedByUserId ? userNames.get(file.lastModifiedByUserId) : undefined}
            extraActions={
              <CommonActions onToggleDetail={() => setShowingDetail(!showingDetail)} onRefresh={onRefresh} />
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
