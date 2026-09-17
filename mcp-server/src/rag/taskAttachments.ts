/**
 * Pulling a task's attachments into its search context: downloading each one
 * and extracting its text (pdf/docx/xlsx — the same formats search_file_content
 * reads), so a spec sheet or inspection report attached to a task is
 * searchable alongside its subject, description and change history.
 *
 * Best-effort by design: an attachment in a format this server can't parse
 * (.doc, .xls, images, drawings, ...), over the size limit, or that simply
 * fails to extract (corrupt, password-protected, a scanned PDF with no text
 * layer) is skipped rather than failing the whole task — same tolerance
 * rag/build.ts applies to a file area full of mixed formats.
 */

import { statSync } from 'node:fs';
import type { DaluxClient } from 'dalux-build-api';
import { downloadDaluxFile } from '../attachmentFetch';
import { pool } from '../concurrency';
import { extractDocument, isSupported } from '../extract';
import { str, type AttachmentText } from './taskText';

const DEFAULT_MAX_ATTACHMENT_MB = 20;
const DEFAULT_CONCURRENCY = 4;

export function groupAttachmentsByTaskId(attachments: readonly unknown[]): Map<string, Record<string, unknown>[]> {
  const byTaskId = new Map<string, Record<string, unknown>[]>();
  for (const raw of attachments) {
    const attachment = raw as Record<string, unknown>;
    const taskId = attachment?.taskId as string | undefined;
    if (!taskId) continue;
    byTaskId.set(taskId, [...(byTaskId.get(taskId) ?? []), attachment]);
  }
  return byTaskId;
}

function attachmentFileInfo(attachment: Record<string, unknown>): { url: string; fileName: string } | null {
  const mediaFile = attachment.mediaFile as Record<string, unknown> | undefined;
  const url = str(mediaFile?.fileDownload);
  const fileName = str(mediaFile?.name);
  if (!url || !fileName) return null;
  return { url, fileName };
}

/**
 * Downloads and extracts the text of one task attachment. Returns null
 * (never throws) for anything unsupported, oversized, or unreadable.
 */
export async function extractAttachmentText(
  client: DaluxClient,
  attachment: Record<string, unknown>,
  maxFileSizeMb: number = DEFAULT_MAX_ATTACHMENT_MB,
): Promise<AttachmentText | null> {
  const info = attachmentFileInfo(attachment);
  if (!info || !isSupported(info.fileName)) return null;

  try {
    const filePath = await downloadDaluxFile(client, info.url, info.fileName);
    if (statSync(filePath).size > maxFileSizeMb * 1024 * 1024) return null;
    const extraction = await extractDocument(filePath, info.fileName);
    return { fileName: info.fileName, chunks: extraction.chunks };
  } catch {
    return null;
  }
}

export interface ExtractAttachmentsOptions {
  /** Max attachments actually downloaded/extracted per task; the rest are silently left out. */
  maxPerTask?: number;
  maxFileSizeMb?: number;
  /** Total concurrent downloads across every task in this call, not per task. */
  concurrency?: number;
}

/**
 * Extracts attachment text for every task in `taskIds`, up to `maxPerTask`
 * attachments each, all drawn from one shared pool of at most `concurrency`
 * concurrent downloads — so searching 200 tasks with attachments enabled
 * doesn't open 200x the per-task concurrency at once.
 */
export async function extractAttachmentTextsByTaskId(
  client: DaluxClient,
  attachmentsByTaskId: ReadonlyMap<string, readonly Record<string, unknown>[]>,
  taskIds: readonly string[],
  options: ExtractAttachmentsOptions = {},
): Promise<Map<string, AttachmentText[]>> {
  const maxPerTask = options.maxPerTask ?? Infinity;
  const entries: { taskId: string; attachment: Record<string, unknown> }[] = [];
  for (const taskId of taskIds) {
    const attachments = (attachmentsByTaskId.get(taskId) ?? []).slice(0, maxPerTask);
    for (const attachment of attachments) entries.push({ taskId, attachment });
  }

  const resultsByTaskId = new Map<string, AttachmentText[]>();
  await pool(entries, options.concurrency ?? DEFAULT_CONCURRENCY, () => false, async ({ taskId, attachment }) => {
    const text = await extractAttachmentText(client, attachment, options.maxFileSizeMb);
    if (!text) return;
    resultsByTaskId.set(taskId, [...(resultsByTaskId.get(taskId) ?? []), text]);
  });
  return resultsByTaskId;
}
