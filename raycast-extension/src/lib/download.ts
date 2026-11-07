import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { environment } from "@raycast/api";
import { getClient } from "./client";
import { safeFileName, type FileEntry } from "./files";

/**
 * Downloads a file revision into the extension's support directory and
 * returns its local path. A revision already downloaded is reused.
 */
export async function downloadFile(file: FileEntry): Promise<string> {
  if (!file.downloadLink) throw new Error("Dalux returned no download link for this file.");
  const directory = path.join(environment.supportPath, "files", file.fileId, file.fileRevisionId ?? "current");
  const name = safeFileName(file.fileName);
  const target = path.join(directory, name);
  if (existsSync(target) && (file.fileSize == null || statSync(target).size === file.fileSize)) return target;
  return getClient().files.downloadFileFromLink(file.downloadLink, name, directory);
}
