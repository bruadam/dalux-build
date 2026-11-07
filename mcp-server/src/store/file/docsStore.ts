/**
 * On-disk layout of a temporary docs-repo index — the GitHub-sourced sibling of
 * fileAreaStore.ts (file-area indexes) and taskStore.ts (task indexes).
 *
 *   <tmp>/dalux-mcp/docs-index/<indexId>/manifest.json    scope, per-document revisions
 *   <tmp>/dalux-mcp/docs-index/<indexId>/docs/<id>.json   one document's chunks
 *   <tmp>/dalux-mcp/docs-index/<indexId>/docs/<id>.vec    its embeddings, Float32 little-endian
 *
 * One file per document (rather than one blob per index) is what makes
 * rebuilding incremental: a single edited document rewrites its own two files
 * and leaves the rest of the corpus untouched.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { docsIndexDir, docsIndexRoot } from '../../cachePaths';
import type { DocsIndexManifest, DocsIndexSummary, IndexStore, IndexedDoc } from '../types';

/**
 * Longest sanitized filename this produces, well under the 255-byte limit
 * most filesystems (APFS, ext4, NTFS) impose on a single path component —
 * leaves headroom for the ".json"/".vec" suffix and multi-byte UTF-8 in the
 * hash-preserved characters.
 */
const MAX_SAFE_ID_LENGTH = 150;

/**
 * A repo path used as a filename/path component, safely: unsafe characters
 * replaced, and — since some corpora (e.g. Molio's Danish document titles)
 * produce sanitized names past what a filesystem allows in one component —
 * long ones truncated with a content hash appended so two documents can
 * never collide once shortened.
 */
export function safeDocId(docPath: string): string {
  const sanitized = docPath.replace(/[^A-Za-z0-9._-]/g, '_');
  if (sanitized.length <= MAX_SAFE_ID_LENGTH) return sanitized;
  const hash = createHash('sha256').update(docPath).digest('hex').slice(0, 16);
  return `${sanitized.slice(0, MAX_SAFE_ID_LENGTH - hash.length - 1)}_${hash}`;
}

export const MANIFEST_VERSION = 1;

export interface StoredDocsIndexManifest extends DocsIndexManifest {
  version: number;
}

function docsDir(indexId: string): string {
  const dir = path.join(docsIndexDir(indexId), 'docs');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function manifestPath(indexId: string): string {
  return path.join(docsIndexDir(indexId), 'manifest.json');
}

export function readManifest(indexId: string): StoredDocsIndexManifest | null {
  const file = manifestPath(indexId);
  if (!existsSync(file)) return null;
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf-8')) as StoredDocsIndexManifest;
    return manifest.version === MANIFEST_VERSION ? manifest : null;
  } catch {
    return null;
  }
}

export function writeManifest(manifest: DocsIndexManifest): void {
  const stored: StoredDocsIndexManifest = { ...manifest, version: MANIFEST_VERSION };
  writeFileSync(manifestPath(manifest.indexId), JSON.stringify(stored, null, 2), 'utf-8');
}

export function writeDocument(indexId: string, doc: IndexedDoc, vectors: number[][] | null): void {
  const base = path.join(docsDir(indexId), safeDocId(doc.path));
  writeFileSync(`${base}.json`, JSON.stringify(doc), 'utf-8');
  if (vectors?.length) {
    const flat = new Float32Array(vectors.length * vectors[0].length);
    vectors.forEach((vector, i) => flat.set(vector, i * vectors[0].length));
    writeFileSync(`${base}.vec`, Buffer.from(flat.buffer));
  } else {
    rmSync(`${base}.vec`, { force: true });
  }
}

export function readDocument(indexId: string, docPath: string): IndexedDoc | null {
  const file = path.join(docsDir(indexId), `${safeDocId(docPath)}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as IndexedDoc;
  } catch {
    return null;
  }
}

/** Per-chunk vectors for a document, or null when it was indexed lexically. */
export function readVectors(indexId: string, docPath: string, dimensions: number): Float32Array[] | null {
  const file = path.join(docsDir(indexId), `${safeDocId(docPath)}.vec`);
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

export function deleteDocument(indexId: string, docPath: string): void {
  const base = path.join(docsDir(indexId), safeDocId(docPath));
  rmSync(`${base}.json`, { force: true });
  rmSync(`${base}.vec`, { force: true });
}

export function dropIndex(indexId: string): boolean {
  const dir = path.join(docsIndexRoot(), safeDocId(indexId));
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

export function summarize(manifest: DocsIndexManifest): DocsIndexSummary {
  const docs = Object.values(manifest.docs);
  return {
    indexId: manifest.indexId,
    scope: manifest.scope,
    docCount: docs.length,
    chunkCount: docs.reduce((total, doc) => total + doc.chunkCount, 0),
    updatedAt: manifest.updatedAt,
    mode: manifest.embedding ? 'embeddings' : 'lexical',
    sizeBytes: directorySize(docsIndexDir(manifest.indexId)),
  };
}

export function listIndexes(): DocsIndexSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(docsIndexRoot());
  } catch {
    return [];
  }
  return entries
    .map((indexId) => readManifest(indexId))
    .filter((manifest): manifest is StoredDocsIndexManifest => manifest !== null)
    .map(summarize)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const docsFileStore: IndexStore<DocsIndexManifest, IndexedDoc, DocsIndexSummary> = {
  readManifest: async (indexId) => readManifest(indexId),
  writeManifest: async (manifest) => writeManifest(manifest),
  readDocument: async (indexId, docPath) => readDocument(indexId, docPath),
  writeDocument: async (indexId, document, vectors) => writeDocument(indexId, document, vectors),
  readVectors: async (indexId, docPath, dimensions) => readVectors(indexId, docPath, dimensions),
  deleteDocument: async (indexId, docPath) => deleteDocument(indexId, docPath),
  dropIndex: async (indexId) => dropIndex(indexId),
  listIndexes: async () => listIndexes(),
};
