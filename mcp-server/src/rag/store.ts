/**
 * On-disk layout of a temporary file-area index.
 *
 *   <tmp>/dalux-mcp/rag/<indexId>/manifest.json   scope, per-file revisions, skips
 *   <tmp>/dalux-mcp/rag/<indexId>/docs/<id>.json  one file's chunks
 *   <tmp>/dalux-mcp/rag/<indexId>/docs/<id>.vec   its embeddings, Float32 little-endian
 *
 * One file per document (rather than one blob per index) is what makes
 * re-indexing incremental: a changed specification rewrites its own two files
 * and leaves the other 200 documents untouched.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ragIndexDir, ragRoot } from '../cachePaths';
import type { TextChunk } from '../extract';
import type { IndexScope } from './scope';

// Bumped when the manifest shape changes; an older manifest is ignored, which
// costs a rebuild of a disposable cache rather than mis-reading it.
export const MANIFEST_VERSION = 2;

export interface ManifestEntry {
  fileName: string;
  revisionKey: string;
  format: string;
  chunkCount: number;
  note?: string;
  indexedAt: string;
}

/**
 * Skipped files are stored grouped, not listed.
 *
 * A docx-only scope over a file area of drawings skips thousands of files;
 * keeping every name made the manifest 25x larger than the index it describes,
 * and it was rewritten on every pass.
 */
export interface SkipSummary {
  reason: string;
  count: number;
  examples: string[];
}

export interface FailedFile {
  fileId: string;
  fileName: string;
  /** Revision that failed, so a later upload of the same file is retried. */
  revisionKey: string;
  error: string;
}

export interface IndexManifest {
  version: number;
  indexId: string;
  scope: IndexScope;
  createdAt: string;
  updatedAt: string;
  /** Null when the index was built without an embeddings key (lexical search only). */
  embedding: { model: string; dimensions: number } | null;
  files: Record<string, ManifestEntry>;
  skipped: SkipSummary[];
  failed: FailedFile[];
}

export interface IndexedDocument {
  fileId: string;
  fileName: string;
  format: string;
  note?: string;
  chunks: TextChunk[];
}

function docsDir(indexId: string): string {
  const dir = path.join(ragIndexDir(indexId), 'docs');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function manifestPath(indexId: string): string {
  return path.join(ragIndexDir(indexId), 'manifest.json');
}

/** File ids come from the API; keep them from escaping the index directory. */
function safeId(fileId: string): string {
  return fileId.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function readManifest(indexId: string): IndexManifest | null {
  const file = manifestPath(indexId);
  if (!existsSync(file)) return null;
  let manifest: IndexManifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf-8')) as IndexManifest;
  } catch {
    return null;
  }
  if (manifest.version === MANIFEST_VERSION) return manifest;
  // v1 listed every skipped file individually. The documents it indexed are
  // still perfectly readable, so the manifest is migrated rather than
  // discarded — throwing away an index somebody waited minutes to build would
  // be a poor trade for a one-field schema change.
  if (manifest.version === 1) {
    const legacy = manifest.skipped as unknown as { fileName: string; reason: string }[];
    return { ...manifest, version: MANIFEST_VERSION, skipped: summarizeSkips(legacy ?? []) };
  }
  return null;
}

export function writeManifest(manifest: IndexManifest): void {
  writeFileSync(manifestPath(manifest.indexId), JSON.stringify(manifest, null, 2), 'utf-8');
}

/** Group skipped files by reason, keeping a few names per group as evidence. */
export function summarizeSkips(skipped: readonly { fileName: string; reason: string }[]): SkipSummary[] {
  const byReason = new Map<string, string[]>();
  for (const skip of skipped) {
    byReason.set(skip.reason, [...(byReason.get(skip.reason) ?? []), skip.fileName]);
  }
  return [...byReason.entries()].map(([reason, fileNames]) => ({
    reason,
    count: fileNames.length,
    examples: fileNames.slice(0, 5),
  }));
}

export function writeDocument(
  indexId: string,
  document: IndexedDocument,
  vectors: number[][] | null,
): void {
  const base = path.join(docsDir(indexId), safeId(document.fileId));
  writeFileSync(`${base}.json`, JSON.stringify(document), 'utf-8');
  if (vectors?.length) {
    const flat = new Float32Array(vectors.length * vectors[0].length);
    vectors.forEach((vector, i) => flat.set(vector, i * vectors[0].length));
    writeFileSync(`${base}.vec`, Buffer.from(flat.buffer));
  } else {
    rmSync(`${base}.vec`, { force: true });
  }
}

export function readDocument(indexId: string, fileId: string): IndexedDocument | null {
  const file = path.join(docsDir(indexId), `${safeId(fileId)}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as IndexedDocument;
  } catch {
    return null;
  }
}

/** Per-chunk vectors for a document, or null when it was indexed lexically. */
export function readVectors(indexId: string, fileId: string, dimensions: number): Float32Array[] | null {
  const file = path.join(docsDir(indexId), `${safeId(fileId)}.vec`);
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

export function deleteDocument(indexId: string, fileId: string): void {
  const base = path.join(docsDir(indexId), safeId(fileId));
  rmSync(`${base}.json`, { force: true });
  rmSync(`${base}.vec`, { force: true });
}

export function dropIndex(indexId: string): boolean {
  const dir = path.join(ragRoot(), safeId(indexId));
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export interface IndexSummary {
  indexId: string;
  scope: IndexScope;
  fileCount: number;
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

export function summarize(manifest: IndexManifest): IndexSummary {
  const files = Object.values(manifest.files);
  return {
    indexId: manifest.indexId,
    scope: manifest.scope,
    fileCount: files.length,
    chunkCount: files.reduce((total, file) => total + file.chunkCount, 0),
    updatedAt: manifest.updatedAt,
    mode: manifest.embedding ? 'embeddings' : 'lexical',
    sizeBytes: directorySize(ragIndexDir(manifest.indexId)),
  };
}

export function listIndexes(): IndexSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(ragRoot());
  } catch {
    return [];
  }
  return entries
    .map((indexId) => readManifest(indexId))
    .filter((manifest): manifest is IndexManifest => manifest !== null)
    .map(summarize)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
