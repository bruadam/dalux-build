import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { currentContext } from './access/requestScope';

function ensureDir(dir: string): void {
  // 0700: on a shared host, other local users must not read cached downloads and indexes (SECURITY-ANALYSIS #4).
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

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

/**
 * Whose files the current request may reuse: its Dalux connection in platform mode, its
 * credentials in header mode, everyone's in stdio. A file id is only unique within one
 * Dalux customer, so connections must not share downloads or what is derived from them.
 * Callers with different grants on one connection do share them: every cache hit is
 * preceded by the access check (see ifc/session.ts assertReadable and access/guard.ts).
 */
export function fileCacheScope(): string | undefined {
  const { connection, fileNamespace } = currentContext();
  return connection?.id ?? fileNamespace;
}

function scopedDir(kind: 'files' | 'derived', fileId: string): string {
  if (!/^[\w.-]+$/.test(fileId) || fileId === '.' || fileId === '..') throw new Error(`Invalid file id "${fileId}".`);
  const scope = fileCacheScope();
  const dir = path.join(mcpCacheRoot(), kind, ...(scope ? [scope] : []), fileId);
  ensureDir(dir);
  return dir;
}

/** Per-file download cache, shared by download_file, search_file_content and the IFC tools. */
export function cacheDirFor(fileId: string): string {
  return scopedDir('files', fileId);
}

/**
 * Per-file directory for artifacts this server *derives* from a download —
 * schedule CSVs, clash results.
 *
 * Deliberately not a sub-directory of `cacheDirFor`: that holds the downloaded
 * file itself, and readers take its only non-dot entry to be that file, so
 * dropping anything else in there could hand them a CSV instead of the IFC.
 */
export function derivedDirFor(fileId: string): string {
  return scopedDir('derived', fileId);
}

/** Where the current caller's indexes and reports live: separate per file namespace (see RequestContext). */
function callerBase(): string {
  const namespace = currentContext().fileNamespace;
  return namespace ? path.join(mcpCacheRoot(), 'callers', namespace) : mcpCacheRoot();
}

/** Root under which every temporary file-area index lives (one sub-directory per index). */
export function ragRoot(): string {
  const dir = path.join(callerBase(), 'rag');
  ensureDir(dir);
  return dir;
}

/** Directory holding a single temporary index's manifest and per-document chunks/vectors. */
export function ragIndexDir(indexId: string): string {
  const dir = path.join(ragRoot(), indexId);
  ensureDir(dir);
  return dir;
}

/** Root under which every temporary task index lives (see store/file/taskStore.ts). */
export function taskIndexRoot(): string {
  const dir = path.join(callerBase(), 'task-index');
  ensureDir(dir);
  return dir;
}

/** Directory holding a single temporary task index's manifest and per-task chunks/vectors. */
export function taskIndexDir(indexId: string): string {
  const dir = path.join(taskIndexRoot(), indexId);
  ensureDir(dir);
  return dir;
}

/** Root under which every document-consistency report lives (see consistency/report.ts). */
export function consistencyRoot(): string {
  const dir = path.join(callerBase(), 'consistency');
  ensureDir(dir);
  return dir;
}

/** Directory holding one consistency report: manifest, per-file facts, findings and exports. */
export function consistencyReportDir(reportId: string): string {
  const dir = path.join(consistencyRoot(), reportId);
  ensureDir(dir);
  return dir;
}

/**
 * Root under which the docs-repo index lives (see store/file/docsStore.ts) — persistent,
 * unlike the file-area and task indexes above.
 *
 * Those two are cheap to rebuild (they read live Dalux data) and scoped to
 * whatever project a session happens to be looking at, so the OS temp
 * directory — wiped on reboot, fine to lose — is the right home for them.
 * The docs index is the opposite: one shared corpus, expensive to rebuild
 * (a Mistral embedding call per chunk) and barely changes day to day, so
 * losing it on every restart would mean re-embedding hundreds of documents
 * just to answer the first `search_docs` call of a new session.
 *
 * `DALUX_MCP_DOCS_DIR` overrides this directly; `DALUX_MCP_CACHE_DIR` (the
 * ephemeral-cache override above) is honoured too, so tests that redirect
 * the whole cache to a throwaway directory keep isolating the docs index
 * without extra setup. Absent both, this defaults to a directory under the
 * user's home rather than tmpdir.
 */
export function docsIndexRoot(): string {
  const configured = process.env.DALUX_MCP_DOCS_DIR ?? process.env.DALUX_MCP_CACHE_DIR;
  const base = configured ? path.resolve(configured) : path.join(homedir(), '.dalux-mcp');
  const dir = path.join(base, 'docs-index');
  ensureDir(dir);
  return dir;
}

/** Directory holding a single temporary docs-repo index's manifest and per-document chunks/vectors. */
export function docsIndexDir(indexId: string): string {
  const dir = path.join(docsIndexRoot(), indexId);
  ensureDir(dir);
  return dir;
}

/**
 * Path to the persisted clash-rule catalog (see ifc/ruleCatalog.ts): a small
 * JSON file of named clash rules — ifc-lite's built-in discipline-matrix
 * presets plus whatever custom rules a caller has saved.
 *
 * Persistent under the user's home directory for the same reason as
 * docsIndexRoot above: a rule library is meant to accumulate across sessions
 * and projects rather than be re-entered every restart. `DALUX_MCP_CACHE_DIR`
 * is honoured so tests can redirect it alongside the rest of the cache.
 */
export function clashRulesPath(connectionId?: string): string {
  const configured = process.env.DALUX_MCP_CACHE_DIR;
  const base = configured ? path.resolve(configured) : path.join(homedir(), '.dalux-mcp');
  ensureDir(base);
  return path.join(base, connectionId ? `clash-rules.${connectionId}.json` : 'clash-rules.json');
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
