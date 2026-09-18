/**
 * Inlining a downloaded document's extracted text into the MCP tool result,
 * for the formats extractDocument can read (pdf/docx/xlsx/md/html).
 *
 * Raw bytes can't usefully reach a chat client the way an image can: a
 * vision model tokenizes a picture at a small, fixed cost regardless of
 * file size, but there's no equivalent for an arbitrary document — the only
 * way the model can actually use a PDF/Word/Excel file is its text, not its
 * bytes. (It also turns out this server's MCP host has no support at all
 * for an embedded binary resource content block — see server.ts — so text
 * is the only thing that reliably reaches the chat for these formats
 * anyway.) download_file/download_task_attachment reuse the same
 * extractDocument pipeline search_file_content already relies on.
 */

import { extractDocument, isSupported, UnsupportedFormatError, type TextChunk } from './extract';

/**
 * Cap on how many characters of extracted text get inlined. Unlike the byte
 * cap on image/file inlining, this bounds tokens directly — 200k characters
 * is a generous single-document budget without risking the whole context.
 * Override with DALUX_MCP_MAX_INLINE_CHARS, or per-call via
 * download_file/download_task_attachment's `maxInlineChars` argument (both
 * clamped to HARD_MAX_INLINE_CHARS).
 */
const DEFAULT_MAX_INLINE_CHARS = 200_000;
export const HARD_MAX_INLINE_CHARS = 2_000_000;

export function maxInlineChars(override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return Math.min(override, HARD_MAX_INLINE_CHARS);
  }
  const configured = process.env.DALUX_MCP_MAX_INLINE_CHARS;
  if (!configured) return DEFAULT_MAX_INLINE_CHARS;
  const parsed = Number(configured);
  const fallback = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_INLINE_CHARS;
  return Math.min(fallback, HARD_MAX_INLINE_CHARS);
}

export type InlineTextResult =
  | { inlined: true; format: string; text: string; truncated: boolean; pageCount?: number }
  | { inlined: false; reason: string };

function renderChunk(chunk: TextChunk): string {
  return `[${chunk.location}]\n${chunk.text}`;
}

/** Extracts and concatenates a document's text, capped by character count. */
export async function buildInlineText(filePath: string, fileName: string, maxCharsOverride?: number): Promise<InlineTextResult> {
  if (!isSupported(fileName)) {
    return { inlined: false, reason: `No text extraction available for "${fileName}".` };
  }

  let extraction;
  try {
    extraction = await extractDocument(filePath, fileName);
  } catch (err) {
    if (err instanceof UnsupportedFormatError) return { inlined: false, reason: err.message };
    throw err;
  }

  const limit = maxInlineChars(maxCharsOverride);
  const full = extraction.chunks.map(renderChunk).join('\n\n');
  const truncated = full.length > limit;
  return {
    inlined: true,
    format: extraction.format,
    text: truncated ? full.slice(0, limit) : full,
    truncated,
    pageCount: extraction.pageCount,
  };
}
