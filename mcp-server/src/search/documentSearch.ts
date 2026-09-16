/**
 * Single-document search: extract a file's chunks and rank them against a query.
 *
 * This is the lightweight, one-file-at-a-time complement to the file-area index
 * in `src/rag` — it re-reads the file on every call and keeps nothing but the
 * downloaded original, which is the right trade-off for "what does this one
 * document say about X" and the wrong one for searching a whole file area.
 */

import type { TextChunk } from '../extract';
import { bm25Scores, cosineSimilarity, embedTexts, embeddingsAvailable, type RankMode } from './rank';

export interface ScoredChunk extends TextChunk {
  score: number;
}

/**
 * Above this many chunks, BM25 picks the candidates and embeddings only rerank
 * them. Embedding every chunk of a 600-page specification on each query would
 * cost seconds and real money for a ranking the prefilter barely changes.
 */
const MAX_SEMANTIC_CANDIDATES = 200;

export async function searchChunks(
  chunks: readonly TextChunk[],
  query: string,
  topK: number,
): Promise<{ mode: RankMode; matches: ScoredChunk[] }> {
  if (!chunks.length) return { mode: 'lexical', matches: [] };

  if (!embeddingsAvailable()) {
    const scores = bm25Scores(chunks.map((chunk) => chunk.text), query);
    const matches = chunks
      .map((chunk, i) => ({ ...chunk, score: scores[i] }))
      .filter((chunk) => chunk.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return { mode: 'lexical', matches };
  }

  let candidates = chunks;
  if (chunks.length > MAX_SEMANTIC_CANDIDATES) {
    const scores = bm25Scores(chunks.map((chunk) => chunk.text), query);
    candidates = chunks
      .map((chunk, i) => ({ chunk, score: scores[i] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SEMANTIC_CANDIDATES)
      .map((entry) => entry.chunk);
  }

  const [queryVector, ...chunkVectors] = await embedTexts([query, ...candidates.map((c) => c.text)]);
  const matches = candidates
    .map((chunk, i) => ({ ...chunk, score: cosineSimilarity(queryVector, chunkVectors[i]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return { mode: 'embeddings', matches };
}
