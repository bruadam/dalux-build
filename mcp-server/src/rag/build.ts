/**
 * Incremental build of a temporary file-area index.
 *
 * Designed to be called repeatedly: each pass works within a time budget, so a
 * 400-document file area is indexed over several tool calls instead of one that
 * blows the host's timeout. Files whose revision is unchanged since the last
 * pass are reused untouched, so the second call is cheap and a later call after
 * new uploads only pays for what changed.
 */

import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DaluxClient } from 'dalux-build-api';
import { pruneStaleIndexes, ragIndexDir } from '../cachePaths';
import { pool } from '../concurrency';
import { extractDocument } from '../extract';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedTexts, embeddingsAvailable } from '../search/rank';
import { indexIdFor, listIndexableFiles, type IndexScope, type IndexableFile } from './scope';
import {
  MANIFEST_VERSION,
  deleteDocument,
  readManifest,
  summarizeSkips,
  writeDocument,
  writeManifest,
  type FailedFile,
  type IndexManifest,
  type SkipSummary,
} from './store';

/** Indexes nobody has touched for a week are deleted on the next build. */
const STALE_INDEX_MS = 7 * 24 * 60 * 60 * 1000;

/** Guard against one enormous document dominating the index (and the embedding bill). */
const MAX_CHUNKS_PER_FILE = 1500;

/**
 * How often the manifest is written mid-pass.
 *
 * Without this, a build killed part-way through (the host restarting the
 * server, the user cancelling) leaves documents on disk that no manifest
 * mentions, and the next call re-indexes the whole scope from zero.
 */
const MANIFEST_FLUSH_EVERY = 10;

export interface BuildOptions {
  /** Upper bound on files indexed in this pass (not on the index as a whole). */
  maxFiles?: number;
  maxFileSizeMb?: number;
  timeBudgetSeconds?: number;
  /** Re-extract and re-embed every file, ignoring the cached revisions. */
  refresh?: boolean;
  concurrency?: number;
}

export interface BuildReport {
  indexId: string;
  scope: IndexScope;
  /** False when the time/file budget ran out — call the tool again to continue. */
  complete: boolean;
  mode: 'embeddings' | 'lexical';
  filesInScope: number;
  filesIndexedThisPass: number;
  filesReused: number;
  filesPending: number;
  filesRemoved: number;
  totalChunks: number;
  skipped: SkipSummary[];
  failed: FailedFile[];
  warnings: string[];
  elapsedSeconds: number;
}

function sourceDir(indexId: string): string {
  const dir = path.join(ragIndexDir(indexId), 'src');
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function downloadSource(
  client: DaluxClient,
  scope: IndexScope,
  indexId: string,
  file: IndexableFile,
): Promise<string> {
  const directory = sourceDir(indexId);
  // The API-provided name is never used as a path component: a file named
  // "../../etc/passwd.pdf" would otherwise write outside the index directory.
  const localName = `${file.fileId.replace(/[^A-Za-z0-9._-]/g, '_')}${path.extname(file.fileName).toLowerCase()}`;

  if (file.downloadLink) {
    return client.files.downloadFileFromLink(file.downloadLink, localName, directory);
  }

  const result = await client.files.getFile(scope.projectId, scope.fileAreaId, file.fileId, {
    download: true,
    savePath: directory,
  });
  const downloaded = (result as { downloadedFilePath?: string } | string);
  if (typeof downloaded === 'string' || !downloaded.downloadedFilePath) {
    throw new Error(typeof downloaded === 'string' ? downloaded : 'Dalux returned no download link for this file.');
  }
  return downloaded.downloadedFilePath;
}

export async function buildIndex(
  client: DaluxClient,
  scope: IndexScope,
  options: BuildOptions = {},
): Promise<BuildReport> {
  const startedAt = Date.now();
  const maxFiles = options.maxFiles ?? 250;
  const maxFileSizeBytes = (options.maxFileSizeMb ?? 60) * 1024 * 1024;
  const budgetMs = (options.timeBudgetSeconds ?? 120) * 1000;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));

  pruneStaleIndexes(STALE_INDEX_MS);

  const indexId = indexIdFor(scope);
  const warnings: string[] = [];
  const useEmbeddings = embeddingsAvailable();

  const existing = readManifest(indexId);
  const manifest: IndexManifest = existing ?? {
    version: MANIFEST_VERSION,
    indexId,
    scope,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    embedding: useEmbeddings ? { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS } : null,
    files: {},
    skipped: [],
    failed: [],
  };

  // An index built without a key holds no vectors; once a key appears, the
  // documents have to be re-embedded before semantic search can use them.
  let refresh = options.refresh ?? false;
  if (existing && useEmbeddings && !existing.embedding) {
    refresh = true;
    warnings.push('OPENAI_API_KEY is now set — re-embedding the index so semantic search can use it.');
  }
  if (existing && !useEmbeddings && existing.embedding) {
    warnings.push('OPENAI_API_KEY is not set — searches will fall back to BM25 despite the stored embeddings.');
  }
  if (useEmbeddings) {
    manifest.embedding = { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS };
  }

  const { files, skipped } = await listIndexableFiles(client, scope);
  manifest.scope = scope;
  manifest.skipped = summarizeSkips(skipped);

  const liveIds = new Set(files.map((file) => file.fileId));
  let filesRemoved = 0;
  for (const fileId of Object.keys(manifest.files)) {
    if (liveIds.has(fileId)) continue;
    deleteDocument(indexId, fileId);
    delete manifest.files[fileId];
    filesRemoved += 1;
  }

  // A file that failed to extract (corrupt, password-protected, an .xlsx that
  // is really a renamed .xls) is not retried until its revision changes —
  // otherwise every later pass would rediscover it and the index would never
  // report itself complete.
  const failedBefore = new Map(manifest.failed.map((entry) => [entry.fileId, entry]));
  const dirty = files.filter((file) => {
    if (refresh) return true;
    const entry = manifest.files[file.fileId];
    if (entry && entry.revisionKey === file.revisionKey) return false;
    const failure = failedBefore.get(file.fileId);
    return !failure || failure.revisionKey !== file.revisionKey;
  });
  const budgeted = dirty.slice(0, maxFiles);

  const failed: FailedFile[] = [];
  const sizeSkipped: { fileId: string; fileName: string; reason: string }[] = [];
  const writtenThisPass = new Set<string>();
  // The vector files are a flat array of floats, so reading them back depends on
  // knowing the width. It is recorded from what the API actually returned rather
  // than assumed, so pointing OPENAI_BASE_URL at another model cannot silently
  // produce vectors that are re-read at the wrong stride.
  let observedDimensions: number | null = null;
  let indexedThisPass = 0;

  const outOfTime = () => Date.now() - startedAt > budgetMs;

  await pool(budgeted, concurrency, outOfTime, async (file) => {
    if (file.fileSize !== null && file.fileSize > maxFileSizeBytes) {
      sizeSkipped.push({
        fileId: file.fileId,
        fileName: file.fileName,
        reason: `file is ${(file.fileSize / 1024 / 1024).toFixed(1)} MB, above the ${(maxFileSizeBytes / 1024 / 1024).toFixed(0)} MB limit`,
      });
      return;
    }

    let localPath: string | null = null;
    try {
      localPath = await downloadSource(client, scope, indexId, file);
      if (statSync(localPath).size > maxFileSizeBytes) {
        sizeSkipped.push({
          fileId: file.fileId,
          fileName: file.fileName,
          reason: `downloaded file exceeds the ${(maxFileSizeBytes / 1024 / 1024).toFixed(0)} MB limit`,
        });
        return;
      }

      const extraction = await extractDocument(localPath, file.fileName);
      let chunks = extraction.chunks;
      let note = extraction.note;
      if (chunks.length > MAX_CHUNKS_PER_FILE) {
        chunks = chunks.slice(0, MAX_CHUNKS_PER_FILE);
        note = [note, `Only the first ${MAX_CHUNKS_PER_FILE} chunks of this file were indexed.`]
          .filter(Boolean)
          .join(' ');
      }

      const vectors = useEmbeddings && chunks.length ? await embedTexts(chunks.map((c) => c.text)) : null;
      if (vectors?.length) observedDimensions = vectors[0].length;

      writeDocument(
        indexId,
        { fileId: file.fileId, fileName: file.fileName, format: extraction.format, note, chunks },
        vectors,
      );
      writtenThisPass.add(file.fileId);
      manifest.files[file.fileId] = {
        fileName: file.fileName,
        revisionKey: file.revisionKey,
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
      failed.push({
        fileId: file.fileId,
        fileName: file.fileName,
        revisionKey: file.revisionKey,
        error: message,
      });
    } finally {
      // The originals are re-downloadable and only needed for extraction;
      // keeping them would triple the size of a "temporary" index.
      if (localPath) rmSync(localPath, { force: true });
    }
  });

  if (observedDimensions !== null && manifest.embedding) {
    if (manifest.embedding.dimensions !== observedDimensions) {
      // A different embedding width than the stored vectors: everything indexed
      // before this pass is now unreadable, so it is dropped and re-indexed on
      // the next call rather than being scored against mismatched vectors.
      for (const fileId of Object.keys(manifest.files)) {
        if (writtenThisPass.has(fileId)) continue;
        deleteDocument(indexId, fileId);
        delete manifest.files[fileId];
      }
      warnings.push(
        `The embedding model now returns ${observedDimensions}-dimensional vectors instead of ${manifest.embedding.dimensions} — previously indexed documents were dropped and will be re-embedded.`,
      );
    }
    manifest.embedding = { model: EMBEDDING_MODEL, dimensions: observedDimensions };
  }

  // Failures from earlier passes are kept (for files still in scope) alongside
  // this pass's, so the manifest always describes the whole index.
  const retried = new Set(failed.map((entry) => entry.fileId));
  manifest.failed = [
    ...manifest.failed.filter((entry) => liveIds.has(entry.fileId) && !retried.has(entry.fileId)),
    ...failed,
  ];

  const indexedIds = new Set(Object.keys(manifest.files));
  const failedIds = new Set(manifest.failed.map((entry) => entry.fileId));
  const skippedIds = new Set(sizeSkipped.map((entry) => entry.fileId));
  const filesPending = files.filter(
    (file) => !indexedIds.has(file.fileId) && !failedIds.has(file.fileId) && !skippedIds.has(file.fileId),
  ).length;

  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifest);

  const totalChunks = Object.values(manifest.files).reduce((total, entry) => total + entry.chunkCount, 0);
  const complete = filesPending === 0;
  if (!complete) {
    warnings.push(
      `${filesPending} file(s) still to index — call build_file_area_index again with the same arguments to continue.`,
    );
  }

  return {
    indexId,
    scope,
    complete,
    mode: useEmbeddings ? 'embeddings' : 'lexical',
    filesInScope: files.length,
    filesIndexedThisPass: indexedThisPass,
    filesReused: files.length - dirty.length,
    filesPending,
    filesRemoved,
    totalChunks,
    skipped: summarizeSkips([...skipped, ...sizeSkipped]),
    failed: manifest.failed,
    warnings,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  };
}
