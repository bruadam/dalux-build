/**
 * Storage interface for the search indexes (file areas, tasks, reference docs).
 *
 * The file store under ./file is the only implementation today; the platform's
 * Postgres store implements the same interface.
 */

import type { TextChunk } from '../extract';
import type { DocsRepoScope } from '../rag/docsSource';
import type { IndexScope } from '../rag/scope';

export interface IndexStore<Manifest extends { indexId: string }, Document, Summary> {
  readManifest(indexId: string): Promise<Manifest | null>;
  writeManifest(manifest: Manifest): Promise<void>;
  readDocument(indexId: string, documentId: string): Promise<Document | null>;
  /** `vectors` holds one embedding per chunk, or null for a lexical-only document. */
  writeDocument(indexId: string, document: Document, vectors: number[][] | null): Promise<void>;
  /** Per-chunk vectors for a document, or null when it was indexed lexically. */
  readVectors(indexId: string, documentId: string, dimensions: number): Promise<Float32Array[] | null>;
  deleteDocument(indexId: string, documentId: string): Promise<void>;
  dropIndex(indexId: string): Promise<boolean>;
  listIndexes(): Promise<Summary[]>;
  /**
   * Ranks chunks inside the store. Searchers use it when present and otherwise
   * score every chunk read through readDocument/readVectors (the file store).
   */
  search?(indexId: string, request: ChunkSearchRequest): Promise<ChunkSearchResult<ChunkOf<Document>>>;
}

export type ChunkOf<Document> = Document extends { chunks: (infer Chunk)[] } ? Chunk : never;

export interface ChunkSearchRequest {
  query: string;
  /** Embeds the query for semantic ranking; null ranks lexically. */
  embedQuery: (() => Promise<number[]>) | null;
  topK: number;
  /** Cap on matches from any single document; null for no cap. */
  perDocumentLimit: number | null;
  /** Only search these documents (file id, task id, or repo path). */
  documentIds?: string[];
}

export interface ChunkSearchResult<Chunk> {
  /** Some documents in the searched set have no embeddings, so the ranking fell back to lexical. */
  missingVectors: boolean;
  /** Best first, already limited to topK and perDocumentLimit. */
  matches: { documentId: string; chunk: Chunk; score: number }[];
}

export interface IndexStores {
  fileAreas: IndexStore<IndexManifest, IndexedDocument, IndexSummary>;
  tasks: IndexStore<TaskIndexManifest, IndexedTask, TaskIndexSummary>;
  docs: IndexStore<DocsIndexManifest, IndexedDoc, DocsIndexSummary>;
}

/**
 * Where an indexed document lives in Dalux, for access checks on indexed
 * content. A field is left undefined when the build did not read it from Dalux.
 */
export interface DocumentAccess {
  projectId?: string;
  fileAreaId?: string;
  folderId?: string;
  /** Folders above `folderId`, root first. */
  folderAncestorIds?: string[];
}

// File-area indexes

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
  access?: DocumentAccess;
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

export interface IndexSummary {
  indexId: string;
  scope: IndexScope;
  fileCount: number;
  chunkCount: number;
  updatedAt: string;
  mode: 'embeddings' | 'lexical';
  sizeBytes: number;
}

// Task indexes

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
  access?: DocumentAccess;
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

// Reference-docs indexes

export interface DocsManifestEntry {
  /** Path within the repo, e.g. "docs/laws/example-law.md". */
  path: string;
  /** Git blob SHA at the time this document was indexed. */
  revisionKey: string;
  format: string;
  chunkCount: number;
  note?: string;
  indexedAt: string;
}

export interface FailedDoc {
  path: string;
  /** Revision that failed, so a later edit to the same file is retried. */
  revisionKey: string;
  error: string;
}

export interface DocsIndexManifest {
  indexId: string;
  scope: DocsRepoScope;
  createdAt: string;
  updatedAt: string;
  /** Null when the index was built without an embeddings key (lexical search only). */
  embedding: { model: string; dimensions: number } | null;
  /** Keyed by repo path. */
  docs: Record<string, DocsManifestEntry>;
  failed: FailedDoc[];
}

export interface IndexedDoc {
  path: string;
  chunks: TextChunk[];
}

export interface DocsIndexSummary {
  indexId: string;
  scope: DocsRepoScope;
  docCount: number;
  chunkCount: number;
  updatedAt: string;
  mode: 'embeddings' | 'lexical';
  sizeBytes: number;
}
