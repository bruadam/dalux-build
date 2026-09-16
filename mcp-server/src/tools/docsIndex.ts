/**
 * Cross-document search over a reference-docs repo on GitHub — laws,
 * guidelines, standards, procedures, or whatever else a project keeps in a
 * shared corpus separate from any one Dalux project's files.
 *
 * `build_docs_index` fetches the readable documents under a folder in a
 * GitHub repo (over the REST API — no local clone) into a disposable index in
 * the OS temp directory; `search_docs_index` then answers "what do our
 * standards say about X" across all of them at once. Same shape as
 * `build_file_area_index`/`search_file_area` (tools/fileAreaIndex.ts), with
 * GitHub as the source instead of a Dalux file area.
 */

import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { SUPPORTED_EXTENSIONS } from '../extract';
import { buildDocsIndex as runBuildDocsIndex, docsIndexIdFor } from '../rag/docsBuild';
import { searchDocsIndex as runSearchDocsIndex } from '../rag/docsSearch';
import { dropIndex, listIndexes, readManifest } from '../rag/docsStore';
import type { DocsRepoScope } from '../rag/docsSource';

/**
 * `DOCS_GITHUB_*` env vars let a deployment pin a default corpus (e.g. one
 * organisation's `dalux-build-docs` repo) so callers don't have to name the
 * repo on every call; every value can still be overridden per call.
 * `DOCS_GITHUB_TOKEN` falls back to the more common `GITHUB_TOKEN` name —
 * needed at all only for a private repo, or to raise GitHub's unauthenticated
 * rate limit for a public one.
 */
function envToken(): string | null {
  return process.env.DOCS_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
}

function resolveScope(args: { owner?: string; repo?: string; ref?: string; path?: string }): DocsRepoScope {
  const owner = args.owner ?? process.env.DOCS_GITHUB_OWNER;
  const repo = args.repo ?? process.env.DOCS_GITHUB_REPO;
  if (!owner || !repo) {
    throw new Error(
      'Pass owner and repo (or set DOCS_GITHUB_OWNER/DOCS_GITHUB_REPO in the server environment) to say which GitHub repo to index.',
    );
  }
  return {
    owner,
    repo,
    ref: args.ref ?? process.env.DOCS_GITHUB_REF ?? 'main',
    path: args.path ?? process.env.DOCS_GITHUB_PATH ?? 'docs',
  };
}

const scopeShape = {
  owner: z.string().optional().describe('Repo owner (user or org). Defaults to the DOCS_GITHUB_OWNER env var.'),
  repo: z.string().optional().describe('Repo name. Defaults to the DOCS_GITHUB_REPO env var.'),
  ref: z.string().optional().describe('Branch, tag or commit SHA to read. Defaults to DOCS_GITHUB_REF, or "main".'),
  path: z
    .string()
    .optional()
    .describe('Folder within the repo to index, recursively. Defaults to DOCS_GITHUB_PATH, or "docs".'),
};

// ---------- build_docs_index ----------

export const buildDocsIndexInput = z.object({
  ...scopeShape,
  maxDocs: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .describe('Max documents to index in this call (default 250). Call again to continue a large repo.'),
  maxFileSizeMb: z.number().min(1).max(500).optional().describe('Skip files larger than this (default 60 MB).'),
  timeBudgetSeconds: z
    .number()
    .int()
    .min(10)
    .max(900)
    .optional()
    .describe('Stop this pass after roughly this long and report what is left (default 120).'),
  refresh: z.boolean().optional().describe('Re-extract and re-embed every document, ignoring cached revisions.'),
});
export type BuildDocsIndexInput = z.infer<typeof buildDocsIndexInput>;

export async function buildDocsIndex(_client: DaluxClient, args: BuildDocsIndexInput) {
  const scope = resolveScope(args);
  const report = await runBuildDocsIndex(scope, envToken(), {
    maxDocs: args.maxDocs,
    maxFileSizeMb: args.maxFileSizeMb,
    timeBudgetSeconds: args.timeBudgetSeconds,
    refresh: args.refresh,
  });

  return {
    ...report,
    nextStep: report.complete
      ? `Search it with search_docs_index (indexId "${report.indexId}").`
      : 'Call build_docs_index again with the same arguments to index the remaining documents.',
  };
}

// ---------- search_docs_index ----------

export const searchDocsIndexInput = z.object({
  query: z.string().describe('What to look for, in natural language.'),
  indexId: z.string().optional().describe('Index to search, as returned by build_docs_index. Omit to address it by scope instead.'),
  ...scopeShape,
  topK: z.number().int().min(1).max(50).optional().describe('Max passages to return (default 8).'),
  perDocLimit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .nullable()
    .optional()
    .describe('Max passages from any one document (default 3; null for no cap).'),
  pathContains: z.string().optional().describe('Only search documents whose repo path contains this text, e.g. "laws/".'),
});
export type SearchDocsIndexInput = z.infer<typeof searchDocsIndexInput>;

export async function searchDocsIndex(_client: DaluxClient, args: SearchDocsIndexInput) {
  const indexId = args.indexId ?? docsIndexIdFor(resolveScope(args));

  const result = await runSearchDocsIndex(indexId, args.query, {
    topK: args.topK,
    perDocLimit: args.perDocLimit,
    pathContains: args.pathContains,
  });

  const manifest = readManifest(indexId);
  return {
    ...result,
    matches: result.matches.map((match) => ({ ...match, score: Number(match.score.toFixed(4)) })),
    indexedDocs: manifest ? Object.keys(manifest.docs).length : 0,
    indexUpdatedAt: manifest?.updatedAt,
  };
}

// ---------- list_docs_indexes ----------

export const listDocsIndexesInput = z.object({});
export type ListDocsIndexesInput = z.infer<typeof listDocsIndexesInput>;

export async function listDocsIndexes() {
  return { indexes: listIndexes(), supportedExtensions: SUPPORTED_EXTENSIONS };
}

// ---------- drop_docs_index ----------

export const dropDocsIndexInput = z.object({
  indexId: z.string().describe('The index to delete, as reported by list_docs_indexes.'),
});
export type DropDocsIndexInput = z.infer<typeof dropDocsIndexInput>;

export async function dropDocsIndex(_client: DaluxClient, args: DropDocsIndexInput) {
  const dropped = dropIndex(args.indexId);
  return {
    dropped,
    message: dropped
      ? `Deleted the local docs index "${args.indexId}". Nothing on GitHub was changed.`
      : `No docs index "${args.indexId}" on this server.`,
  };
}

// ---------- search_docs ----------
//
// A deployment normally has exactly one reference-docs corpus, pinned via
// DOCS_GITHUB_OWNER/REPO/REF/PATH. build_docs_index/search_docs_index above
// stay around for scripts/build-docs-index.ts (see there) and tests, but
// building is deliberately NOT an MCP tool: indexing hundreds of documents
// costs an OpenAI embedding call per chunk and can take minutes, which is a
// bad thing to let a model trigger mid-conversation. The index is built
// out-of-band (`npm run docs:build`, e.g. as a deploy step) and persists on
// disk (see cachePaths.docsIndexRoot) — search_docs only ever reads it.
//
// No owner/repo/ref/path/indexId here either — the model can't point this
// server at a repo nobody meant it to read.

export const searchDocsInput = z.object({
  query: z.string().describe('What to look for, in natural language.'),
  topK: z.number().int().min(1).max(50).optional().describe('Max passages to return (default 8).'),
  perDocLimit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .nullable()
    .optional()
    .describe('Max passages from any one document (default 3; null for no cap).'),
  pathContains: z.string().optional().describe('Only search documents whose repo path contains this text, e.g. "molio/".'),
});
export type SearchDocsInput = z.infer<typeof searchDocsInput>;

export async function searchDocs(_client: DaluxClient, args: SearchDocsInput) {
  const scope = resolveScope({});
  const indexId = docsIndexIdFor(scope);
  const manifest = readManifest(indexId);
  if (!manifest) {
    throw new Error(
      'The docs corpus has not been indexed yet on this server — run `npm run docs:build` (see mcp-server/scripts/build-docs-index.ts) and restart the server.',
    );
  }

  const result = await runSearchDocsIndex(indexId, args.query, {
    topK: args.topK,
    perDocLimit: args.perDocLimit,
    pathContains: args.pathContains,
  });

  return {
    mode: result.mode,
    query: result.query,
    docsSearched: result.docsSearched,
    chunksSearched: result.chunksSearched,
    matches: result.matches.map((match) => ({ ...match, score: Number(match.score.toFixed(4)) })),
    warnings: result.warnings,
    indexedDocs: Object.keys(manifest.docs).length,
    indexUpdatedAt: manifest.updatedAt,
  };
}
