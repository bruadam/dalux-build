/**
 * Cross-document search: a temporary RAG index over a Dalux file area.
 *
 * `build_file_area_index` downloads, extracts and embeds the readable
 * documents in a (file area, folder) scope into a disposable index in the OS
 * temp directory; `search_file_area` then answers "which documents say
 * something about X" across all of them at once. The reasoning stays with the
 * calling agent — these tools return cited passages, not an answer.
 */

import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { SUPPORTED_EXTENSIONS } from '../extract';
import { buildIndex } from '../rag/build';
import { indexIdFor, resolveScope } from '../rag/scope';
import { searchIndex } from '../rag/search';
import { indexStores } from '../store';

const scopeShape = {
  projectId: z.string(),
  fileAreaId: z.string().describe('The file area ID to index.'),
  folderId: z.string().optional().describe('Restrict to one folder (omit to index the whole file area).'),
  folderPath: z
    .string()
    .optional().describe('Folder path, e.g. "Files/4_Design". Alternative to folderId.'),
  recursive: z.boolean().optional().describe('Include subfolders of the chosen folder (default true).'),
  extensions: z
    .array(z.string())
    .optional()
    .describe('Extensions to index (default all supported).'),
  includeDrawings: z
    .boolean()
    .optional().describe('Include drawings (default true).'),
};

// ---------- build_file_area_index ----------

export const buildFileAreaIndexInput = z.object({
  ...scopeShape,
  maxFiles: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional().describe('Max files per call (default 250).'),
  maxFileSizeMb: z.number().min(1).max(500).optional().describe('Skip files larger than this (default 60 MB).'),
  timeBudgetSeconds: z
    .number()
    .int()
    .min(10)
    .max(900)
    .optional().describe('Time budget per call (default 120).'),
  refresh: z.boolean().optional().describe('Rebuild everything.'),
});
export type BuildFileAreaIndexInput = z.infer<typeof buildFileAreaIndexInput>;

export async function buildFileAreaIndex(client: DaluxClient, args: BuildFileAreaIndexInput) {
  const scope = await resolveScope(client, args);
  const report = await buildIndex(client, scope, {
    maxFiles: args.maxFiles,
    maxFileSizeMb: args.maxFileSizeMb,
    timeBudgetSeconds: args.timeBudgetSeconds,
    refresh: args.refresh,
  });

  return {
    ...report,
    // Skip lists can run to thousands of files; the agent needs the shape of
    // what was left out, not every name (buildIndex already groups them).
    failed: report.failed.slice(0, 20),
    nextStep: report.complete
      ? `Search it with search_file_area (indexId "${report.indexId}").`
      : 'Call build_file_area_index again with the same arguments to index the remaining files.',
  };
}

// ---------- search_file_area ----------

export const searchFileAreaInput = z.object({
  query: z.string().describe('Natural-language query.'),
  indexId: z
    .string()
    .optional().describe('From build_file_area_index; or give the scope instead.'),
  projectId: z.string().optional().describe('Or address the index by scope.'),
  fileAreaId: z.string().optional(),
  folderId: z.string().optional(),
  folderPath: z.string().optional(),
  recursive: z.boolean().optional().describe('As at build time (default true).'),
  extensions: z.array(z.string()).optional().describe('As at build time.'),
  includeDrawings: z.boolean().optional().describe('As at build time (default true).'),
  topK: z.number().int().min(1).max(50).optional().describe('Max passages to return (default 8).'),
  perFileLimit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .nullable()
    .optional()
    .describe('Max passages from any one document (default 3; null for no cap).'),
  fileNameContains: z.string().optional().describe('Only search documents whose name contains this text.'),
  fileIds: z.array(z.string()).optional().describe('Only search these documents.'),
});
export type SearchFileAreaInput = z.infer<typeof searchFileAreaInput>;

export async function searchFileArea(client: DaluxClient, args: SearchFileAreaInput) {
  let indexId = args.indexId;
  if (!indexId) {
    if (!args.projectId || !args.fileAreaId) {
      throw new Error('Pass either indexId, or projectId + fileAreaId to address the index by scope.');
    }
    indexId = indexIdFor(
      await resolveScope(client, {
        projectId: args.projectId,
        fileAreaId: args.fileAreaId,
        folderId: args.folderId,
        folderPath: args.folderPath,
        recursive: args.recursive,
        extensions: args.extensions,
        includeDrawings: args.includeDrawings,
      }),
    );
  }

  const result = await searchIndex(indexId, args.query, {
    topK: args.topK,
    perFileLimit: args.perFileLimit,
    fileNameContains: args.fileNameContains,
    fileIds: args.fileIds,
  });

  const manifest = await indexStores().fileAreas.readManifest(indexId);
  return {
    ...result,
    matches: result.matches.map((match) => ({
      fileId: match.fileId,
      fileName: match.fileName,
      location: match.location,
      page: match.page,
      text: match.text,
      score: Number(match.score.toFixed(4)),
    })),
    indexedFiles: manifest ? Object.keys(manifest.files).length : 0,
    indexUpdatedAt: manifest?.updatedAt,
  };
}

// ---------- list_file_area_indexes ----------

export const listFileAreaIndexesInput = z.object({});
export type ListFileAreaIndexesInput = z.infer<typeof listFileAreaIndexesInput>;

export async function listFileAreaIndexes() {
  return { indexes: await indexStores().fileAreas.listIndexes() };
}

// ---------- drop_file_area_index ----------

export const dropFileAreaIndexInput = z.object({
  indexId: z.string(),
});
export type DropFileAreaIndexInput = z.infer<typeof dropFileAreaIndexInput>;

export async function dropFileAreaIndex(_client: DaluxClient, args: DropFileAreaIndexInput) {
  const dropped = await indexStores().fileAreas.dropIndex(args.indexId);
  return {
    dropped,
    message: dropped
      ? `Deleted the local index "${args.indexId}". Nothing in Dalux was changed.`
      : `No index "${args.indexId}" on this server.`,
  };
}
