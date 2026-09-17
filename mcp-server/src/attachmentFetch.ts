/**
 * Downloading a direct, pre-signed Dalux file-download URL — the shape task
 * attachments come back as (`mediaFile.fileDownload`), rather than a
 * fileId/fileArea pair a project file has. Shared by tools/tasks.ts
 * (download_task_attachment) and rag/taskAttachments.ts (pulling attachment
 * text into task search context) so both sign and cache these links the
 * same way instead of duplicating it.
 */

import { createHash } from 'node:crypto';
import type { DaluxClient } from 'dalux-build-api';
import { cacheDirFor } from './cachePaths';

/**
 * Downloads a signed file-download URL into the shared file cache, keyed by
 * a hash of the URL since these links have no fileId of their own. Signs the
 * request with the same X-API-KEY as every other Dalux call — see
 * FilesApi.downloadFileFromLink in dalux-build-api.
 */
export async function downloadDaluxFile(client: DaluxClient, fileDownload: string, fileName: string): Promise<string> {
  const cacheKey = createHash('sha256').update(fileDownload).digest('hex').slice(0, 16);
  const dir = cacheDirFor(`link-${cacheKey}`);
  return client.files.downloadFileFromLink(fileDownload, fileName, dir);
}
