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
import { dropIndex, listIndexes, readManifest } from '../rag/store';

const scopeShape = {
  projectId: z.string().describe('The Dalux project ID.'),
  fileAreaId: z.string().describe('The file area ID to index.'),
  folderId: z.string().optional().describe('Restrict to one folder (omit to index the whole file area).'),
  folderPath: z
    .string()
    .optional()
    .describe('Restrict to one folder by path, e.g. "Files/4_Design/Contracts". Alternative to folderId.'),
  recursive: z.boolean().optional().describe('Include subfolders of the chosen folder (default true).'),
  extensions: z
    .array(z.string())
    .optional()
    .describe(`Formats to index (default all supported: ${SUPPORTED_EXTENSIONS.join(', ')}).`),
  includeDrawings: z
    .boolean()
    .optional()
    .describe(
      'Include files Dalux classifies as drawings (default true). Their text layer holds title blocks, room names and annotations; scanned sheets contribute nothing.',
    ),
};

// ---------- build_file_area_index ----------

export const buildFileAreaIndexInput = z.object({
  ...scopeShape,
  maxFiles: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .describe('Max files to index in this call (default 250). Call again to continue a large file area.'),
  maxFileSizeMb: z.number().min(1).max(500).optional().describe('Skip files larger than this (default 60 MB).'),
  timeBudgetSeconds: z
    .number()
    .int()
    .min(10)
    .max(900)
    .optional()
    .describe('Stop this pass after roughly this long and report what is left (default 120).'),
  refresh: z.boolean().optional().describe('Re-extract and re-embed every file, ignoring cached revisions.'),
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
  query: z.string().describe('What to look for, in natural language.'),
  indexId: z
    .string()
    .optional()
    .describe('Index to search, as returned by build_file_area_index. Omit to address it by scope instead.'),
  projectId: z.string().optional().describe('With fileAreaId: address the index by scope instead of indexId.'),
  fileAreaId: z.string().optional().describe('The file area ID the index covers.'),
  folderId: z.string().optional().describe('The folder ID the index covers, if it was scoped to one.'),
  folderPath: z.string().optional().describe('The folder path the index covers, if it was scoped to one.'),
  recursive: z.boolean().optional().describe('Must match the value the index was built with (default true).'),
  extensions: z.array(z.string()).optional().describe('Must match the value the index was built with.'),
  includeDrawings: z.boolean().optional().describe('Must match the value the index was built with (default true).'),
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

  const manifest = readManifest(indexId);
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
  return { indexes: listIndexes() };
}

// ---------- drop_file_area_index ----------

export const dropFileAreaIndexInput = z.object({
  indexId: z.string().describe('The index to delete, as reported by list_file_area_indexes.'),
});
export type DropFileAreaIndexInput = z.infer<typeof dropFileAreaIndexInput>;

export async function dropFileAreaIndex(_client: DaluxClient, args: DropFileAreaIndexInput) {
  const dropped = dropIndex(args.indexId);
  return {
    dropped,
    message: dropped
      ? `Deleted the local index "${args.indexId}". Nothing in Dalux was changed.`
      : `No index "${args.indexId}" on this server.`,
  };
}
