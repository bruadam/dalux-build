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
import { ragIndexDir, ragRoot } from '../../cachePaths';
import { summarizeSkips, type IndexManifest, type IndexStore, type IndexSummary, type IndexedDocument } from '../types';

// Bumped when the manifest shape changes; an older manifest is ignored, which
// costs a rebuild of a disposable cache rather than mis-reading it.
export const MANIFEST_VERSION = 2;

export interface StoredIndexManifest extends IndexManifest {
  version: number;
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

export function readManifest(indexId: string): StoredIndexManifest | null {
  const file = manifestPath(indexId);
  if (!existsSync(file)) return null;
  let manifest: StoredIndexManifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf-8')) as StoredIndexManifest;
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
  const stored: StoredIndexManifest = { ...manifest, version: MANIFEST_VERSION };
  writeFileSync(manifestPath(manifest.indexId), JSON.stringify(stored, null, 2), 'utf-8');
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
    .filter((manifest): manifest is StoredIndexManifest => manifest !== null)
    .map(summarize)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const fileAreaFileStore: IndexStore<IndexManifest, IndexedDocument, IndexSummary> = {
  readManifest: async (indexId) => readManifest(indexId),
  writeManifest: async (manifest) => writeManifest(manifest),
  readDocument: async (indexId, fileId) => readDocument(indexId, fileId),
  writeDocument: async (indexId, document, vectors) => writeDocument(indexId, document, vectors),
  readVectors: async (indexId, fileId, dimensions) => readVectors(indexId, fileId, dimensions),
  deleteDocument: async (indexId, fileId) => deleteDocument(indexId, fileId),
  dropIndex: async (indexId) => dropIndex(indexId),
  listIndexes: async () => listIndexes(),
};
