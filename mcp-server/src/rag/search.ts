/**
 * Cross-document search over a temporary file-area index.
 *
 * Brute-force cosine over every chunk vector — no ANN index. At the scale this
 * server indexes (a folder or file area: thousands, not millions, of chunks)
 * a linear scan is a few milliseconds, and it keeps the on-disk format a plain
 * array of floats that any later process can re-read without a database.
 */

import { EMBEDDING_MODEL, bm25Scores, cosineSimilarity, embedTexts, embeddingsAvailable, rankingModeWarning, type RankMode } from '../search/rank';
import type { TextChunk } from '../extract';
import { indexStores } from '../store';
import type { IndexManifest } from '../store/types';

export interface SearchMatch extends TextChunk {
  fileId: string;
  fileName: string;
  score: number;
}

export interface IndexSearchOptions {
  topK?: number;
  /** Cap on matches from any single document, so one verbose file cannot fill the answer. */
  perFileLimit?: number | null;
  /** Case-insensitive substring filter on the file name. */
  fileNameContains?: string;
  fileIds?: string[];
}

export interface IndexSearchResult {
  indexId: string;
  mode: RankMode;
  query: string;
  filesSearched: number;
  chunksSearched: number;
  matches: SearchMatch[];
  warnings: string[];
}

interface Candidate {
  fileId: string;
  fileName: string;
  chunk: TextChunk;
  vector: Float32Array | null;
}

function selectFiles(manifest: IndexManifest, options: IndexSearchOptions): string[] {
  const wanted = options.fileIds?.length ? new Set(options.fileIds) : null;
  const needle = options.fileNameContains?.toLowerCase();
  return Object.keys(manifest.files).filter(
    (fileId) =>
      (!wanted || wanted.has(fileId)) && (!needle || manifest.files[fileId].fileName.toLowerCase().includes(needle)),
  );
}

function rankingWarnings(embedding: IndexManifest['embedding'], missingVectors: boolean): string[] {
  const warnings: string[] = [];
  if (embedding && embedding.model !== EMBEDDING_MODEL) {
    warnings.push('Embedding model changed — ranking lexically until the index is rebuilt.');
  }
  const rankingWarning = rankingModeWarning(Boolean(embedding));
  if (rankingWarning) warnings.push(rankingWarning);
  if (missingVectors) {
    warnings.push(
      'Some documents have no embeddings (indexed before the key was set) — ranking lexically so scores stay comparable. Re-run build_file_area_index with refresh=true to embed them.',
    );
  }
  return warnings;
}

async function collectCandidates(
  manifest: IndexManifest,
  options: IndexSearchOptions,
): Promise<{ candidates: Candidate[]; filesSearched: number; missingVectors: boolean }> {
  const store = indexStores().fileAreas;
  const dimensions = manifest.embedding?.dimensions ?? 0;

  const candidates: Candidate[] = [];
  let filesSearched = 0;
  let missingVectors = false;

  for (const fileId of selectFiles(manifest, options)) {
    const document = await store.readDocument(manifest.indexId, fileId);
    if (!document) continue;
    const vectors = dimensions ? await store.readVectors(manifest.indexId, fileId, dimensions) : null;
    if (dimensions && (!vectors || vectors.length !== document.chunks.length)) missingVectors = true;

    filesSearched += 1;
    document.chunks.forEach((chunk, i) => {
      candidates.push({
        fileId,
        fileName: document.fileName,
        chunk,
        vector: vectors?.[i] ?? null,
      });
    });
  }

  return { candidates, filesSearched, missingVectors };
}

function applyPerFileLimit(matches: SearchMatch[], topK: number, perFileLimit: number | null): SearchMatch[] {
  if (perFileLimit === null) return matches.slice(0, topK);
  const perFile = new Map<string, number>();
  const kept: SearchMatch[] = [];
  for (const match of matches) {
    const used = perFile.get(match.fileId) ?? 0;
    if (used >= perFileLimit) continue;
    perFile.set(match.fileId, used + 1);
    kept.push(match);
    if (kept.length >= topK) break;
  }
  return kept;
}

export async function searchIndex(
  indexId: string,
  query: string,
  options: IndexSearchOptions = {},
): Promise<IndexSearchResult> {
  const manifest = await indexStores().fileAreas.readManifest(indexId);
  if (!manifest) {
    throw new Error(
      `No index "${indexId}" on this server. Build one with build_file_area_index first ` +
        '(indexes live in the OS temp directory and do not survive a restart of the machine).',
    );
  }

  const topK = options.topK ?? 8;
  const perFileLimit = options.perFileLimit === undefined ? 3 : options.perFileLimit;
  const store = indexStores().fileAreas;
  if (store.search) {
    const fileIds = selectFiles(manifest, options);
    const semanticWanted = manifest.embedding?.model === EMBEDDING_MODEL && embeddingsAvailable();
    const { missingVectors, matches } = await store.search(indexId, {
      query,
      embedQuery: semanticWanted ? async () => (await embedTexts([query]))[0] : null,
      topK,
      perDocumentLimit: perFileLimit,
      documentIds: options.fileIds?.length || options.fileNameContains ? fileIds : undefined,
    });
    return {
      indexId,
      mode: semanticWanted && !missingVectors ? 'embeddings' : 'lexical',
      query,
      filesSearched: fileIds.length,
      chunksSearched: fileIds.reduce((total, fileId) => total + manifest.files[fileId].chunkCount, 0),
      matches: matches.map((match) => ({
        ...match.chunk,
        fileId: match.documentId,
        fileName: manifest.files[match.documentId].fileName,
        score: match.score,
      })),
      warnings: rankingWarnings(manifest.embedding, missingVectors),
    };
  }

  const warnings: string[] = [];
  const { candidates, filesSearched, missingVectors } = await collectCandidates(manifest, options);
  if (!candidates.length) {
    return { indexId, mode: 'lexical', query, filesSearched, chunksSearched: 0, matches: [], warnings };
  }

  const semantic = manifest.embedding?.model === EMBEDDING_MODEL && embeddingsAvailable() && !missingVectors;
  warnings.push(...rankingWarnings(manifest.embedding, missingVectors));

  let scored: SearchMatch[];
  if (semantic) {
    const [queryVector] = await embedTexts([query]);
    scored = candidates.map((candidate) => ({
      ...candidate.chunk,
      fileId: candidate.fileId,
      fileName: candidate.fileName,
      score: candidate.vector ? cosineSimilarity(queryVector, Array.from(candidate.vector)) : 0,
    }));
  } else {
    const scores = bm25Scores(candidates.map((candidate) => candidate.chunk.text), query);
    scored = candidates
      .map((candidate, i) => ({
        ...candidate.chunk,
        fileId: candidate.fileId,
        fileName: candidate.fileName,
        score: scores[i],
      }))
      .filter((match) => match.score > 0);
  }

  scored.sort((a, b) => b.score - a.score);

  return {
    indexId,
    mode: semantic ? 'embeddings' : 'lexical',
    query,
    filesSearched,
    chunksSearched: candidates.length,
    matches: applyPerFileLimit(scored, topK, perFileLimit),
    warnings,
  };
}
