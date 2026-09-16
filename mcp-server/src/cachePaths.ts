import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Root of everything this server writes to disk — all of it disposable.
 *
 * `DALUX_MCP_CACHE_DIR` overrides the OS temp directory, which a container
 * deployment needs when /tmp is small or wiped between restarts, and which
 * lets the tests keep their indexes out of the real cache.
 */
export function mcpCacheRoot(): string {
  const configured = process.env.DALUX_MCP_CACHE_DIR;
  return configured ? path.resolve(configured) : path.join(tmpdir(), 'dalux-mcp');
}

/** Per-file download cache, shared by download_file, search_file_content and the IFC tools. */
export function cacheDirFor(fileId: string): string {
  const dir = path.join(mcpCacheRoot(), 'files', fileId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Per-file directory for artifacts this server *derives* from a download —
 * schedule CSVs, clash results.
 *
 * Deliberately not a sub-directory of `cacheDirFor`: that holds the downloaded
 * file itself, and `modelLinks.resolveModelFile` takes its only non-dot entry
 * to be that file, so dropping anything else in there hands the 3D viewer a
 * CSV instead of the IFC.
 */
export function derivedDirFor(fileId: string): string {
  const dir = path.join(mcpCacheRoot(), 'derived', fileId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Root under which every temporary file-area index lives (one sub-directory per index). */
export function ragRoot(): string {
  const dir = path.join(mcpCacheRoot(), 'rag');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Directory holding a single temporary index's manifest and per-document chunks/vectors. */
export function ragIndexDir(indexId: string): string {
  const dir = path.join(ragRoot(), indexId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Root under which every temporary task index lives (see rag/taskStore.ts). */
export function taskIndexRoot(): string {
  const dir = path.join(mcpCacheRoot(), 'task-index');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Directory holding a single temporary task index's manifest and per-task chunks/vectors. */
export function taskIndexDir(indexId: string): string {
  const dir = path.join(taskIndexRoot(), indexId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Root under which every temporary docs-repo index lives (see rag/docsStore.ts). */
export function docsIndexRoot(): string {
  const dir = path.join(mcpCacheRoot(), 'docs-index');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Directory holding a single temporary docs-repo index's manifest and per-document chunks/vectors. */
export function docsIndexDir(indexId: string): string {
  const dir = path.join(docsIndexRoot(), indexId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Delete index directories untouched for longer than `maxAgeMs`, under `root`
 * (defaulting to the file-area index root; pass `taskIndexRoot()` to prune task
 * indexes instead).
 *
 * These indexes are caches of project data living in the OS temp directory;
 * pruning on every build keeps a long-running server from accumulating stale
 * copies nobody is querying any more.
 */
export function pruneStaleIndexes(maxAgeMs: number, now: number = Date.now(), root: string = ragRoot()): string[] {
  const pruned: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return pruned;
  }
  for (const entry of entries) {
    const dir = path.join(root, entry);
    try {
      const stat = statSync(dir);
      if (!stat.isDirectory()) continue;
      if (now - stat.mtimeMs <= maxAgeMs) continue;
      rmSync(dir, { recursive: true, force: true });
      pruned.push(entry);
    } catch {
      // A concurrent build may have removed it already — nothing to do.
    }
  }
  return pruned;
}
