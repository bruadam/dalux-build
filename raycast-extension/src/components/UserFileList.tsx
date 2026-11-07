import { useMemo } from "react";
import { FileList } from "./FileList";
import { useProjectFiles } from "../lib/data";
import { filesOfUser } from "../lib/files";
import type { UserEntry } from "../lib/users";

/** Files across all file areas that the user uploaded or last modified. */
export function UserFileList({ projectId, user }: { projectId: string; user: UserEntry }) {
  const files = useProjectFiles(projectId);
  const userFiles = useMemo(() => files.data && filesOfUser(files.data.files, user.userId), [files.data, user.userId]);
  return (
    <FileList
      projectId={projectId}
      navigationTitle={`Files · ${user.name}`}
      files={userFiles}
      isLoading={files.isLoading}
      error={files.error}
      onRefresh={files.refresh}
    />
  );
}
