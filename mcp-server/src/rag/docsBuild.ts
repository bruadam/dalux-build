/**
 * Incremental build of a temporary index over a docs repo on GitHub.
 *
 * Mirrors rag/build.ts (the Dalux file-area index): each pass works within a
 * time budget, and a document whose git blob SHA is unchanged since the last
 * pass is reused untouched, so re-running after adding or editing a handful
 * of files only pays for what changed. The one real difference is the source
 * — content comes from the GitHub Contents API (docsSource.ts) instead of a
 * Dalux download link.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { docsIndexRoot, pruneStaleIndexes } from '../cachePaths';
import { extractDocument } from '../extract';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedTexts, embeddingsAvailable } from '../search/rank';
import { fetchDocContent, listDocsEntries, type DocsRepoEntry, type DocsRepoScope } from './docsSource';
import {
  MANIFEST_VERSION,
  deleteDocument,
  readManifest,
  safeDocId,
  writeDocument,
  writeManifest,
  type DocsIndexManifest,
  type FailedDoc,
} from './docsStore';

/** Indexes nobody has touched for a week are deleted on the next build. */
const STALE_INDEX_MS = 7 * 24 * 60 * 60 * 1000;

/** Guard against one enormous document dominating the index (and the embedding bill). */
const MAX_CHUNKS_PER_DOC = 1500;

const MANIFEST_FLUSH_EVERY = 10;

export interface DocsBuildOptions {
  maxDocs?: number;
  maxFileSizeMb?: number;
  timeBudgetSeconds?: number;
  refresh?: boolean;
  concurrency?: number;
}

export interface DocsBuildReport {
  indexId: string;
  scope: DocsRepoScope;
  complete: boolean;
  mode: 'embeddings' | 'lexical';
  docsInScope: number;
  docsIndexedThisPass: number;
  docsReused: number;
  docsPending: number;
  docsRemoved: number;
  totalChunks: number;
  failed: FailedDoc[];
  warnings: string[];
  elapsedSeconds: number;
}

export function docsIndexIdFor(scope: DocsRepoScope): string {
  const raw = `${scope.owner}/${scope.repo}@${scope.ref}:${scope.path}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function sourceDir(indexId: string): string {
  const dir = path.join(docsIndexRoot(), indexId, 'src');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run `worker` over `items` with at most `limit` in flight, stopping when `shouldStop` says so. */
async function pool<T>(
  items: readonly T[],
  limit: number,
  shouldStop: () => boolean,
  worker: (item: T) => Promise<void>,
): Promise<number> {
  let next = 0;
  let processed = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (shouldStop()) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]);
      processed += 1;
    }
  });
  await Promise.all(runners);
  return processed;
}

export async function buildDocsIndex(
  scope: DocsRepoScope,
  token: string | null,
  options: DocsBuildOptions = {},
): Promise<DocsBuildReport> {
  const startedAt = Date.now();
  const maxDocs = options.maxDocs ?? 250;
  const maxFileSizeBytes = (options.maxFileSizeMb ?? 60) * 1024 * 1024;
  const budgetMs = (options.timeBudgetSeconds ?? 120) * 1000;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));

  pruneStaleIndexes(STALE_INDEX_MS, Date.now(), docsIndexRoot());

  const indexId = docsIndexIdFor(scope);
  const warnings: string[] = [];
  const useEmbeddings = embeddingsAvailable();

  const existing = readManifest(indexId);
  const manifest: DocsIndexManifest = existing ?? {
    version: MANIFEST_VERSION,
    indexId,
    scope,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    embedding: useEmbeddings ? { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS } : null,
    docs: {},
    failed: [],
  };

  let refresh = options.refresh ?? false;
  if (existing && useEmbeddings && !existing.embedding) {
    refresh = true;
    warnings.push('OPENAI_API_KEY is now set — re-embedding the index so semantic search can use it.');
  }
  if (existing && !useEmbeddings && existing.embedding) {
    warnings.push('OPENAI_API_KEY is not set — searches will fall back to BM25 despite the stored embeddings.');
  }
  if (useEmbeddings) manifest.embedding = { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS };

  const { entries, truncated } = await listDocsEntries(scope, token);
  manifest.scope = scope;
  if (truncated) {
    warnings.push(
      'GitHub truncated the repository tree listing (very large repo) — some documents past the truncation point may be missing from this index.',
    );
  }

  const liveIds = new Set(entries.map((entry) => entry.path));
  let docsRemoved = 0;
  for (const docPath of Object.keys(manifest.docs)) {
    if (liveIds.has(docPath)) continue;
    deleteDocument(indexId, docPath);
    delete manifest.docs[docPath];
    docsRemoved += 1;
  }

  // A document that failed to extract is not retried until its blob SHA
  // changes — otherwise every later pass would rediscover it and the index
  // would never report itself complete.
  const failedBefore = new Map(manifest.failed.map((entry) => [entry.path, entry]));
  const dirty = entries.filter((entry) => {
    if (refresh) return true;
    const cached = manifest.docs[entry.path];
    if (cached && cached.revisionKey === entry.sha) return false;
    const failure = failedBefore.get(entry.path);
    return !failure || failure.revisionKey !== entry.sha;
  });
  const budgeted = dirty.slice(0, maxDocs);

  const failed: FailedDoc[] = [];
  const sizeSkipped: { path: string; revisionKey: string; error: string }[] = [];
  const writtenThisPass = new Set<string>();
  let observedDimensions: number | null = null;
  let indexedThisPass = 0;

  const outOfTime = () => Date.now() - startedAt > budgetMs;

  const src = sourceDir(indexId);

  await pool(budgeted, concurrency, outOfTime, async (entry: DocsRepoEntry) => {
    let localPath: string | null = null;
    try {
      const buffer = await fetchDocContent(scope, entry.path, token);
      if (buffer.byteLength > maxFileSizeBytes) {
        sizeSkipped.push({
          path: entry.path,
          revisionKey: entry.sha,
          error: `file is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB, above the ${(maxFileSizeBytes / 1024 / 1024).toFixed(0)} MB limit`,
        });
        return;
      }

      // The repo path is never used as a path component directly: "../../etc/passwd.md"
      // would otherwise write outside the index directory, and some corpora
      // (e.g. Molio's Danish document titles) sanitize to a name longer than
      // a filesystem allows in one component — safeDocId truncates+hashes
      // those. No need to re-append the extension: extractDocument below is
      // given entry.path as a nameHint and uses that for format detection.
      localPath = path.join(src, safeDocId(entry.path));
      writeFileSync(localPath, buffer);
      if (statSync(localPath).size > maxFileSizeBytes) {
        sizeSkipped.push({
          path: entry.path,
          revisionKey: entry.sha,
          error: `file exceeds the ${(maxFileSizeBytes / 1024 / 1024).toFixed(0)} MB limit`,
        });
        return;
      }

      const extraction = await extractDocument(localPath, entry.path);
      let chunks = extraction.chunks;
      let note = extraction.note;
      if (chunks.length > MAX_CHUNKS_PER_DOC) {
        chunks = chunks.slice(0, MAX_CHUNKS_PER_DOC);
        note = [note, `Only the first ${MAX_CHUNKS_PER_DOC} chunks of this document were indexed.`].filter(Boolean).join(' ');
      }

      const vectors = useEmbeddings && chunks.length ? await embedTexts(chunks.map((c) => c.text)) : null;
      if (vectors?.length) observedDimensions = vectors[0].length;

      writeDocument(indexId, { path: entry.path, chunks }, vectors);
      writtenThisPass.add(entry.path);
      manifest.docs[entry.path] = {
        path: entry.path,
        revisionKey: entry.sha,
        format: extraction.format,
        chunkCount: chunks.length,
        note,
        indexedAt: new Date().toISOString(),
      };
      indexedThisPass += 1;
      if (indexedThisPass % MANIFEST_FLUSH_EVERY === 0) {
        manifest.updatedAt = new Date().toISOString();
        writeManifest(manifest);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ path: entry.path, revisionKey: entry.sha, error: message });
    } finally {
      if (localPath) rmSync(localPath, { force: true });
    }
  });

  if (observedDimensions !== null && manifest.embedding) {
    if (manifest.embedding.dimensions !== observedDimensions) {
      for (const docPath of Object.keys(manifest.docs)) {
        if (writtenThisPass.has(docPath)) continue;
        deleteDocument(indexId, docPath);
        delete manifest.docs[docPath];
      }
      warnings.push(
        `The embedding model now returns ${observedDimensions}-dimensional vectors instead of ${manifest.embedding.dimensions} — previously indexed documents were dropped and will be re-embedded.`,
      );
    }
    manifest.embedding = { model: EMBEDDING_MODEL, dimensions: observedDimensions };
  }

  const retried = new Set(failed.map((entry) => entry.path));
  manifest.failed = [
    ...manifest.failed.filter((entry) => liveIds.has(entry.path) && !retried.has(entry.path)),
    ...failed,
    ...sizeSkipped,
  ];

  const indexedIds = new Set(Object.keys(manifest.docs));
  const failedIds = new Set(manifest.failed.map((entry) => entry.path));
  const docsPending = entries.filter((entry) => !indexedIds.has(entry.path) && !failedIds.has(entry.path)).length;

  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifest);

  const totalChunks = Object.values(manifest.docs).reduce((total, entry) => total + entry.chunkCount, 0);
  const complete = docsPending === 0;
  if (!complete) {
    warnings.push(`${docsPending} document(s) still to index — run \`npm run docs:build\` again to continue.`);
  }

  return {
    indexId,
    scope,
    complete,
    mode: useEmbeddings ? 'embeddings' : 'lexical',
    docsInScope: entries.length,
    docsIndexedThisPass: indexedThisPass,
    docsReused: entries.length - dirty.length,
    docsPending,
    docsRemoved,
    totalChunks,
    failed: manifest.failed.slice(0, 20),
    warnings,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  };
}
