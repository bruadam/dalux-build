/**
 * On-disk layout of a temporary task index — the task-side sibling of
 * rag/store.ts, which holds file-area indexes.
 *
 *   <tmp>/dalux-mcp/task-index/<indexId>/manifest.json    scope, per-task revisions
 *   <tmp>/dalux-mcp/task-index/<indexId>/tasks/<id>.json  one task's chunks (its own
 *                                                          fields plus its change history)
 *   <tmp>/dalux-mcp/task-index/<indexId>/tasks/<id>.vec   its embeddings, Float32 little-endian
 *
 * One file per task (rather than one blob per index) is what makes rebuilding
 * incremental: a single edited task rewrites its own two files and leaves the
 * rest of the project's tasks untouched.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { taskIndexDir, taskIndexRoot } from '../cachePaths';

export const MANIFEST_VERSION = 1;

export interface TaskIndexScope {
  projectId: string;
  /** Shorthand narrowing, expands to an OData filter on data/type/typeId — see tools/taskIndex.ts. */
  typeId: string | null;
  /** Raw OData $filter narrowing which tasks are indexed. Takes precedence over typeId. */
  filter: string | null;
}

/** A rendered passage of a task's text — its own fields, or one change entry. No page concept, unlike document chunks. */
export interface TaskChunk {
  location: string;
  text: string;
}

export interface TaskManifestEntry {
  subject: string;
  number: string | null;
  usage: string | null;
  revisionKey: string;
  chunkCount: number;
  changeCount: number;
  attachmentCount: number;
  indexedAt: string;
}

export interface TaskIndexManifest {
  version: number;
  indexId: string;
  scope: TaskIndexScope;
  createdAt: string;
  updatedAt: string;
  /** Null when the index was built without an embeddings key (lexical search only). */
  embedding: { model: string; dimensions: number } | null;
  tasks: Record<string, TaskManifestEntry>;
}

export interface IndexedTask {
  taskId: string;
  chunks: TaskChunk[];
}

function tasksDir(indexId: string): string {
  const dir = path.join(taskIndexDir(indexId), 'tasks');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function manifestPath(indexId: string): string {
  return path.join(taskIndexDir(indexId), 'manifest.json');
}

/** Task ids come from the API; keep them from escaping the index directory. */
function safeId(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function readManifest(indexId: string): TaskIndexManifest | null {
  const file = manifestPath(indexId);
  if (!existsSync(file)) return null;
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf-8')) as TaskIndexManifest;
    return manifest.version === MANIFEST_VERSION ? manifest : null;
  } catch {
    return null;
  }
}

export function writeManifest(manifest: TaskIndexManifest): void {
  writeFileSync(manifestPath(manifest.indexId), JSON.stringify(manifest, null, 2), 'utf-8');
}

export function writeDocument(indexId: string, task: IndexedTask, vectors: number[][] | null): void {
  const base = path.join(tasksDir(indexId), safeId(task.taskId));
  writeFileSync(`${base}.json`, JSON.stringify(task), 'utf-8');
  if (vectors?.length) {
    const flat = new Float32Array(vectors.length * vectors[0].length);
    vectors.forEach((vector, i) => flat.set(vector, i * vectors[0].length));
    writeFileSync(`${base}.vec`, Buffer.from(flat.buffer));
  } else {
    rmSync(`${base}.vec`, { force: true });
  }
}

export function readDocument(indexId: string, taskId: string): IndexedTask | null {
  const file = path.join(tasksDir(indexId), `${safeId(taskId)}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as IndexedTask;
  } catch {
    return null;
  }
}

/** Per-chunk vectors for a task, or null when it was indexed lexically. */
export function readVectors(indexId: string, taskId: string, dimensions: number): Float32Array[] | null {
  const file = path.join(tasksDir(indexId), `${safeId(taskId)}.vec`);
  if (!existsSync(file)) return null;
  const raw = readFileSync(file);
  // Node may hand back a pooled Buffer whose byteOffset is not 4-byte aligned,
  // which Float32Array cannot view directly — copy into a fresh buffer.
  const copy = Uint8Array.from(raw);
  const floats = new Float32Array(copy.buffer);
  const out: Float32Array[] = [];
  for (let start = 0; start + dimensions <= floats.length; start += dimensions) {
    out.push(floats.subarray(start, start + dimensions));
  }
  return out;
}

export function deleteDocument(indexId: string, taskId: string): void {
  const base = path.join(tasksDir(indexId), safeId(taskId));
  rmSync(`${base}.json`, { force: true });
  rmSync(`${base}.vec`, { force: true });
}

export function dropIndex(indexId: string): boolean {
  const dir = path.join(taskIndexRoot(), safeId(indexId));
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export interface TaskIndexSummary {
  indexId: string;
  scope: TaskIndexScope;
  taskCount: number;
  chunkCount: number;
  updatedAt: string;
  mode: 'embeddings' | 'lexical';
  sizeBytes: number;
}

function directorySize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      total += entry.isDirectory() ? directorySize(full) : statSync(full).size;
    } catch {
      // Raced with a prune or a concurrent build.
    }
  }
  return total;
}

export function summarize(manifest: TaskIndexManifest): TaskIndexSummary {
  const tasks = Object.values(manifest.tasks);
  return {
    indexId: manifest.indexId,
    scope: manifest.scope,
    taskCount: tasks.length,
    chunkCount: tasks.reduce((total, task) => total + task.chunkCount, 0),
    updatedAt: manifest.updatedAt,
    mode: manifest.embedding ? 'embeddings' : 'lexical',
    sizeBytes: directorySize(taskIndexDir(manifest.indexId)),
  };
}

export function listIndexes(): TaskIndexSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(taskIndexRoot());
  } catch {
    return [];
  }
  return entries
    .map((indexId) => readManifest(indexId))
    .filter((manifest): manifest is TaskIndexManifest => manifest !== null)
    .map(summarize)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
