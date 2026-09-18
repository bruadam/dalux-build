/**
 * Inlining a downloaded *image* file's bytes into the MCP tool result as a
 * real `image` content block, for download_file/download_task_attachment.
 * This only works for images: a vision model tokenizes a picture cheaply
 * regardless of file size, the same reason render_pdf_page already streams
 * rendered PDF pages this way. There is no equivalent for arbitrary
 * document bytes — see inlineText.ts for how PDF/Word/Excel/Markdown/HTML
 * files stream instead (their extracted text), and downloadLinks.ts for the
 * clickable-link fallback every download gets regardless of format.
 */

import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

/**
 * Cap on how many bytes of a downloaded file get inlined as a base64 blob.
 * Base64 inflates size by ~33%, and a chat transport or an LLM's context
 * both have real limits — this is the same "would blow an LLM's context"
 * concern download_file was originally written around, just bounded instead
 * of absolute. Above the cap the file is still saved locally and the path is
 * still reported, matching the old behaviour exactly.
 *
 * Override the default with DALUX_MCP_MAX_INLINE_BYTES for a deployment that
 * wants a different one. A caller can also raise the cap for a single call
 * (download_file/download_task_attachment's `maxInlineBytes` argument) —
 * meant for when the chat user explicitly asks for a large file to be
 * streamed back rather than left as a local path. Either way, nothing gets
 * inlined above HARD_MAX_INLINE_BYTES: 500 MB is roughly the largest a chat
 * client such as Claude can actually handle in one message, so it acts as an
 * absolute ceiling regardless of who asked for it.
 */
const DEFAULT_MAX_INLINE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const HARD_MAX_INLINE_BYTES = 500 * 1024 * 1024; // 500 MiB

export function maxInlineBytes(override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return Math.min(override, HARD_MAX_INLINE_BYTES);
  }
  const configured = process.env.DALUX_MCP_MAX_INLINE_BYTES;
  if (!configured) return DEFAULT_MAX_INLINE_BYTES;
  const parsed = Number(configured);
  const fallback = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_INLINE_BYTES;
  return Math.min(fallback, HARD_MAX_INLINE_BYTES);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docm': 'application/vnd.ms-word.document.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ifc': 'application/x-step',
  '.dwg': 'image/vnd.dwg',
  '.dxf': 'image/vnd.dxf',
};

/** Best-effort MIME type from a file name's extension; unknown extensions fall back to a generic binary type. */
export function mimeTypeFor(fileName: string): string {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

// The IANA-registered MIME type for a format isn't the same question as
// "can a vision model actually look at this" — .dwg/.dxf are registered as
// image/vnd.dwg and image/vnd.dxf despite being CAD vector formats no chat
// client can decode as a picture, and .tiff/.svg aren't accepted by Claude's
// vision input either. This is deliberately narrower than "starts with
// image/" for that reason — see downloadFileToChat/downloadTaskAttachmentToChat.
const RENDERABLE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

/** Whether `mimeType` is a format a vision model can actually be shown as an `image` content block. */
export function isRenderableImage(mimeType: string): boolean {
  return RENDERABLE_IMAGE_MIME_TYPES.has(mimeType);
}

export type InlineResult =
  | { inlined: true; size: number; mimeType: string; data: string }
  | { inlined: false; size?: number; reason: string };

/**
 * Reads an image file already saved to the local cache and base64-encodes
 * it for an MCP `image` content block. Stats the file first so an oversized
 * file is never fully read into memory just to be discarded.
 *
 * `maxBytesOverride` raises (or lowers) the inline cap for this call alone —
 * see maxInlineBytes above — and is still clamped to HARD_MAX_INLINE_BYTES.
 */
export async function buildInlineResource(
  filePath: string,
  fileName: string,
  maxBytesOverride?: number,
): Promise<InlineResult> {
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { inlined: false, reason: `Could not read the downloaded file: ${message}` };
  }

  const limit = maxInlineBytes(maxBytesOverride);
  if (size > limit) {
    return {
      inlined: false,
      size,
      reason:
        `File is ${size} bytes, over the ${limit}-byte inline limit, so it was not streamed back through MCP. ` +
        `It is still saved locally at ${filePath}; use search_file_content or render_pdf_page to work with it instead.`,
    };
  }

  const data = await readFile(filePath);
  return { inlined: true, size, mimeType: mimeTypeFor(fileName), data: data.toString('base64') };
}
