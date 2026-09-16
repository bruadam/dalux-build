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

/**
 * Delete index directories untouched for longer than `maxAgeMs`.
 *
 * These indexes are caches of project documents living in the OS temp
 * directory; pruning on every build keeps a long-running server from
 * accumulating stale copies of file areas nobody is querying any more.
 */
export function pruneStaleIndexes(maxAgeMs: number, now: number = Date.now()): string[] {
  const root = ragRoot();
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
