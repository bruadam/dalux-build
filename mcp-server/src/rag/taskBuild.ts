/**
 * Build (or incrementally refresh) a temporary local RAG index over a
 * project's tasks, their change history, and their attachments' text,
 * combined one task at a time.
 *
 * Unlike the file-area index (rag/build.ts), tasks and changes are already
 * structured JSON and need no download — only attachments do. A task whose
 * own fields, change history, and attachment list are all unchanged since
 * the last build (by content hash) is skipped, so re-running the build
 * after a handful of edits only re-embeds (and re-downloads attachments
 * for) those tasks. Unlike the file-area index, there is currently no
 * time-budgeted multi-pass build here — a project with many large,
 * newly-attached documents can make the first build slow.
 */

import { createHash } from 'node:crypto';
import type { DaluxClient } from 'dalux-build-api';
import { taskIndexRoot, pruneStaleIndexes } from '../cachePaths';
import { collectAllDaluxItems } from '../daluxPagination';
import { CHUNK_OVERLAP, CHUNK_SIZE, packLines } from '../extract/chunk';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedTexts, embeddingsAvailable } from '../search/rank';
import { extractAttachmentTextsByTaskId, groupAttachmentsByTaskId } from './taskAttachments';
import { groupChangesByTaskId, renderTaskLines, str, taskRevisionKey, unwrapTask, type AttachmentText } from './taskText';
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

/** This is the cached path, so a higher cap than search_tasks' ad-hoc includeAttachments is worth the one-time cost. */
const MAX_ATTACHMENTS_PER_TASK_INDEX = 10;
const ATTACHMENT_CONCURRENCY_INDEX = 6;

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
  attachmentCount: number;
  totalChunks: number;
  warnings: string[];
  elapsedSeconds: number;
}

interface DirtyTask {
  taskId: string;
  data: Record<string, unknown>;
  changes: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  revisionKey: string;
  chunks: TaskChunk[];
}

function chunkTask(
  data: Record<string, unknown>,
  changes: Record<string, unknown>[],
  attachmentTexts: readonly AttachmentText[],
): TaskChunk[] {
  const lines = renderTaskLines(data, changes, attachmentTexts);
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

  const [rawTasks, rawChanges, rawAttachments] = await Promise.all([
    collectAllDaluxItems((pageParams) => client.tasks.getProjectTasks(scope.projectId, { ...params, ...pageParams })),
    collectAllDaluxItems((pageParams) => client.tasks.getProjectTaskChanges(scope.projectId, pageParams)),
    collectAllDaluxItems((pageParams) => client.tasks.getProjectTaskAttachments(scope.projectId, pageParams)),
  ]);
  const changesByTaskId = groupChangesByTaskId(rawChanges as Record<string, unknown>[]);
  const attachmentsByTaskId = groupAttachmentsByTaskId(rawAttachments);

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
    const attachments = attachmentsByTaskId.get(taskId) ?? [];
    const revisionKey = taskRevisionKey(data, changes, attachments);
    const cached = manifest.tasks[taskId];
    if (!refresh && cached && cached.revisionKey === revisionKey) continue;
    dirty.push({ taskId, data, changes, attachments, revisionKey, chunks: [] });
  }

  // Attachments are downloaded and parsed only for tasks that are actually
  // dirty — a task whose fields/changes/attachment list are unchanged reuses
  // its cached chunks (and never re-downloads anything).
  const attachmentTextsByTaskId = await extractAttachmentTextsByTaskId(
    client,
    new Map(dirty.map((task) => [task.taskId, task.attachments])),
    dirty.map((task) => task.taskId),
    { maxPerTask: MAX_ATTACHMENTS_PER_TASK_INDEX, concurrency: ATTACHMENT_CONCURRENCY_INDEX },
  );
  for (const task of dirty) {
    task.chunks = chunkTask(task.data, task.changes, attachmentTextsByTaskId.get(task.taskId) ?? []);
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
      attachmentCount: task.attachments.length,
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
    attachmentCount: rawAttachments.length,
    totalChunks,
    warnings,
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  };
}
