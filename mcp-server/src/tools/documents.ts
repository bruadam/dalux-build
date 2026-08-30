import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { cacheDirFor, extractChunks, searchChunks } from '../pdfSearch';

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
 * Returns a local file path plus metadata; use search_pdf_content to read it.
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

// ---------- search_pdf_content ----------

export const searchPdfContentInput = z.object({
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID.'),
  fileId: z.string().describe('The file ID (must be a PDF).'),
  query: z.string().describe('The text to search for in the PDF, in natural language.'),
  topK: z.number().int().min(1).max(20).optional().describe('Max matching chunks to return (default 5).'),
});
export type SearchPdfContentInput = z.infer<typeof searchPdfContentInput>;

/**
 * Downloads the PDF (or reuses the local cache) and searches its text.
 * Uses OpenAI embeddings for semantic search when OPENAI_API_KEY is set,
 * otherwise falls back to keyword matching — a lightweight, single-file
 * complement to the corpus-wide RAG agent in the Python package, not a
 * replacement for it.
 */
export async function searchPdfContent(client: DaluxClient, args: SearchPdfContentInput) {
  const download = await downloadFile(client, args);
  if (!download.found || !download.filePath) {
    return { found: false, message: 'message' in download ? download.message : 'File not found.' };
  }
  const chunks = await extractChunks(download.filePath as string);
  const matches = await searchChunks(chunks, args.query, args.topK ?? 5);
  return {
    fileName: download.fileName,
    fileId: args.fileId,
    matches: matches.map((m) => ({ page: m.page, text: m.text, score: m.score })),
  };
}
