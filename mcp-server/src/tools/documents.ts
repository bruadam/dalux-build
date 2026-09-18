import path from 'node:path';
import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { cacheDirFor } from '../cachePaths';
import { SUPPORTED_EXTENSIONS, UnsupportedFormatError, extractDocument } from '../extract';
import { buildInlineResource } from '../inlineResource';
import { searchChunks } from '../search/documentSearch';

// ---------- download_file ----------

export const downloadFileInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
  fileId: z.string().describe('The file ID.'),
});
export type DownloadFileInput = z.infer<typeof downloadFileInput>;

/**
 * Downloads a file's content into a local cache directory (does not return
 * raw bytes to the caller — a multi-MB PDF would blow an LLM's context).
 * Returns a local file path plus metadata; use search_file_content to read it.
 */
export async function downloadFile(client: DaluxClient, args: DownloadFileInput) {
  const savePath = cacheDirFor(args.fileId);
  const result = await client.files.getFile(args.projectId, args.fileAreaId, args.fileId, {
    download: true,
    savePath,
  });
  if (typeof result === 'string') {
    return { found: false, message: result };
  }
  const data = (result as { data?: Record<string, unknown> } & Record<string, unknown>).data ?? result;
  return {
    found: true,
    filePath: (result as Record<string, unknown>).downloadedFilePath ?? null,
    fileName: (data as Record<string, unknown>).fileName ?? null,
    fileId: args.fileId,
  };
}

/**
 * download_file's actual MCP handler. Downloads via `downloadFile` above
 * (shared with search_file_content/render_pdf_page, which only ever need the
 * local path) and additionally inlines the bytes as a base64 embedded
 * resource, size-capped by buildInlineResource — a caller reaching this
 * server over a remote MCP connection (HTTP transport, Docker, a hosted
 * connector) has no filesystem access to wherever this server's cache
 * directory lives, so the path alone would be useless to it.
 */
export async function downloadFileToChat(client: DaluxClient, args: DownloadFileInput) {
  const download = await downloadFile(client, args);
  if (!download.found || !download.filePath) return download;

  const fileName = (download.fileName as string | null) ?? path.basename(download.filePath as string);
  const inline = await buildInlineResource(download.filePath as string, fileName);
  if (inline.inlined) {
    return { ...download, size: inline.size, resource: inline.resource };
  }
  return { ...download, message: inline.reason };
}

// ---------- search_file_content ----------

export const searchFileContentInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
  fileId: z
    .string()
    .describe(`The file ID. Supported formats: ${SUPPORTED_EXTENSIONS.join(', ')} (PDFs include drawings).`),
  query: z.string().describe('The text to search for in the document, in natural language.'),
  topK: z.number().int().min(1).max(20).optional().describe('Max matching passages to return (default 5).'),
});
export type SearchFileContentInput = z.infer<typeof searchFileContentInput>;

/**
 * Downloads one document and searches its text.
 *
 * Handles PDFs (documents and drawings), Word and Excel files; each match
 * carries a citable location — a page for PDFs, a heading for Word, a
 * sheet/row range for Excel. Uses OpenAI embeddings for semantic ranking when
 * OPENAI_API_KEY is set, otherwise BM25 — a lightweight, single-file
 * complement to the file-area index in tools/fileAreaIndex.ts, not a
 * replacement for it.
 */
export async function searchFileContent(client: DaluxClient, args: SearchFileContentInput) {
  const download = await downloadFile(client, args);
  if (!download.found || !download.filePath) {
    return { found: false, message: 'message' in download ? download.message : 'File not found.' };
  }

  const fileName = (download.fileName as string | null) ?? undefined;
  let extraction;
  try {
    extraction = await extractDocument(download.filePath as string, fileName);
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      return {
        found: true,
        searchable: false,
        fileId: args.fileId,
        fileName: download.fileName,
        message: `${err.message} The file is downloaded at ${download.filePath} if another tool can read it.`,
      };
    }
    throw err;
  }

  const { mode, matches } = await searchChunks(extraction.chunks, args.query, args.topK ?? 5);

  return {
    found: true,
    searchable: extraction.chunks.length > 0,
    fileId: args.fileId,
    fileName: download.fileName,
    format: extraction.format,
    ranking: mode,
    pageCount: extraction.pageCount,
    pagesWithoutText: extraction.pagesWithoutText?.length ? extraction.pagesWithoutText : undefined,
    note: extraction.note,
    matches: matches.map((match) => ({
      page: match.page,
      location: match.location,
      text: match.text,
      score: Number(match.score.toFixed(4)),
    })),
  };
}
