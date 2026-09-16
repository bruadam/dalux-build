/**
 * Build (or incrementally refresh) a temporary local RAG index over a
 * project's tasks and their change history, combined one task at a time.
 *
 * Unlike the file-area index (rag/build.ts), there is nothing to download —
 * tasks and changes are already structured JSON — so a build always
 * completes in one pass; only the embedding calls are batched to keep them
 * fast and (with OPENAI_API_KEY set) cheap. A task whose own fields and
 * change history are unchanged since the last build (by content hash) is
 * skipped, so re-running the build after a handful of edits only re-embeds
 * those tasks.
 */

import { createHash } from 'node:crypto';
import type { DaluxClient } from 'dalux-build-api';
import { taskIndexRoot, pruneStaleIndexes } from '../cachePaths';
import { collectAllDaluxItems } from '../daluxPagination';
import { CHUNK_OVERLAP, CHUNK_SIZE, packLines } from '../extract/chunk';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedTexts, embeddingsAvailable } from '../search/rank';
import { groupChangesByTaskId, renderTaskLines, str, taskRevisionKey, unwrapTask } from './taskText';
import {
  MANIFEST_VERSION,
  deleteDocument,
  readManifest,
  writeDocument,
  writeManifest,
  type TaskChunk,
  type TaskIndexManifest,
  type TaskIndexScope,
} from './taskStore';

/** Indexes nobody has touched for a week are deleted on the next build. */
const STALE_INDEX_MS = 7 * 24 * 60 * 60 * 1000;

/** Guard against one task with an enormous change history dominating the index. */
const MAX_CHUNKS_PER_TASK = 50;

export function taskIndexIdFor(scope: TaskIndexScope): string {
  const raw = [scope.projectId, scope.typeId ?? '', scope.filter ?? ''].join(':');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

export interface TaskBuildOptions {
  /** Re-render and re-embed every task, ignoring cached revisions. */
  refresh?: boolean;
}

export interface TaskBuildReport {
  indexId: string;
  scope: TaskIndexScope;
  mode: 'embeddings' | 'lexical';
  taskCount: number;
  tasksIndexed: number;
  tasksReused: number;
  tasksRemoved: number;
  changeCount: number;
  totalChunks: number;
  warnings: string[];
  elapsedSeconds: number;
}

interface DirtyTask {
  taskId: string;
  data: Record<string, unknown>;
  changes: Record<string, unknown>[];
  chunks: TaskChunk[];
  revisionKey: string;
}

function chunkTask(data: Record<string, unknown>, changes: Record<string, unknown>[]): TaskChunk[] {
  const lines = renderTaskLines(data, changes);
  let packed = packLines(lines, CHUNK_SIZE, CHUNK_OVERLAP);
  if (packed.length > MAX_CHUNKS_PER_TASK) packed = packed.slice(0, MAX_CHUNKS_PER_TASK);
  return packed.map((chunk) => ({
    location: chunk.firstLine === chunk.lastLine ? `entry ${chunk.firstLine + 1}` : `entries ${chunk.firstLine + 1}-${chunk.lastLine + 1}`,
    text: chunk.text,
  }));
}

export async function buildTaskIndex(
  client: DaluxClient,
  scope: TaskIndexScope,
  options: TaskBuildOptions = {},
): Promise<TaskBuildReport> {
  const startedAt = Date.now();
  pruneStaleIndexes(STALE_INDEX_MS, Date.now(), taskIndexRoot());

  const indexId = taskIndexIdFor(scope);
  const warnings: string[] = [];
  const useEmbeddings = embeddingsAvailable();

  const existing = readManifest(indexId);
  const manifest: TaskIndexManifest = existing ?? {
    version: MANIFEST_VERSION,
    indexId,
    scope,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    embedding: useEmbeddings ? { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS } : null,
    tasks: {},
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

  const params: Record<string, unknown> = {};
  if (scope.filter) {
    params.$filter = scope.filter;
  } else if (scope.typeId) {
    params.$filter = `data/type/typeId eq '${scope.typeId.replace(/'/g, "''")}'`;
  }

  const [rawTasks, rawChanges] = await Promise.all([
    collectAllDaluxItems((pageParams) => client.tasks.getProjectTasks(scope.projectId, { ...params, ...pageParams })),
    collectAllDaluxItems((pageParams) => client.tasks.getProjectTaskChanges(scope.projectId, pageParams)),
  ]);
  const changesByTaskId = groupChangesByTaskId(rawChanges as Record<string, unknown>[]);

  const tasks = rawTasks
    .map((raw) => unwrapTask(raw))
    .filter((data): data is Record<string, unknown> => typeof data.taskId === 'string');

  const liveIds = new Set(tasks.map((data) => data.taskId as string));
  let tasksRemoved = 0;
  for (const taskId of Object.keys(manifest.tasks)) {
    if (liveIds.has(taskId)) continue;
    deleteDocument(indexId, taskId);
    delete manifest.tasks[taskId];
    tasksRemoved += 1;
  }

  const dirty: DirtyTask[] = [];
  for (const data of tasks) {
    const taskId = data.taskId as string;
    const changes = changesByTaskId.get(taskId) ?? [];
    const revisionKey = taskRevisionKey(data, changes);
    const cached = manifest.tasks[taskId];
    if (!refresh && cached && cached.revisionKey === revisionKey) continue;
    dirty.push({ taskId, data, changes, chunks: chunkTask(data, changes), revisionKey });
  }

  // One flattened embeddings call across every dirty task's chunks, rather than
  // one call per task — embedTexts already batches internally, so this keeps
  // the request count down regardless of how many tasks changed.
  let observedDimensions: number | null = null;
  const vectorsByTaskId = new Map<string, number[][]>();
  if (useEmbeddings && dirty.length) {
    const flatTexts = dirty.flatMap((task) => task.chunks.map((chunk) => chunk.text));
    if (flatTexts.length) {
      const flatVectors = await embedTexts(flatTexts);
      observedDimensions = flatVectors[0]?.length ?? null;
      let cursor = 0;
      for (const task of dirty) {
        vectorsByTaskId.set(task.taskId, flatVectors.slice(cursor, cursor + task.chunks.length));
        cursor += task.chunks.length;
      }
    }
  }

  for (const task of dirty) {
    const vectors = vectorsByTaskId.get(task.taskId) ?? null;
    writeDocument(indexId, { taskId: task.taskId, chunks: task.chunks }, vectors?.length ? vectors : null);
    manifest.tasks[task.taskId] = {
      subject: str(task.data.subject) ?? str(task.data.title) ?? '',
      number: str(task.data.number),
      usage: str(task.data.usage),
      revisionKey: task.revisionKey,
      chunkCount: task.chunks.length,
      changeCount: task.changes.length,
      indexedAt: new Date().toISOString(),
    };
  }

  if (observedDimensions !== null && manifest.embedding && manifest.embedding.dimensions !== observedDimensions) {
    // A different embedding width than the stored vectors: everything indexed
    // before this pass is now unreadable, so it is dropped and re-indexed on
    // the next call rather than being scored against mismatched vectors.
    const writtenThisPass = new Set(dirty.map((task) => task.taskId));
    for (const taskId of Object.keys(manifest.tasks)) {
      if (writtenThisPass.has(taskId)) continue;
      deleteDocument(indexId, taskId);
      delete manifest.tasks[taskId];
    }
    warnings.push(
      `The embedding model now returns ${observedDimensions}-dimensional vectors instead of ${manifest.embedding.dimensions} — previously indexed tasks were dropped and will be re-embedded.`,
    );
    manifest.embedding = { model: EMBEDDING_MODEL, dimensions: observedDimensions };
  }

  manifest.updatedAt = new Date().toISOString();
  writeManifest(manifest);

  const totalChunks = Object.values(manifest.tasks).reduce((total, entry) => total + entry.chunkCount, 0);

  return {
    indexId,
    scope,
    mode: useEmbeddings ? 'embeddings' : 'lexical',
    taskCount: tasks.length,
    tasksIndexed: dirty.length,
    tasksReused: tasks.length - dirty.length,
    tasksRemoved,
    changeCount: rawChanges.length,
    totalChunks,
    warnings,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  };
}
