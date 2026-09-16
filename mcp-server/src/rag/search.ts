/**
 * Cross-document search over a temporary file-area index.
 *
 * Brute-force cosine over every chunk vector — no ANN index. At the scale this
 * server indexes (a folder or file area: thousands, not millions, of chunks)
 * a linear scan is a few milliseconds, and it keeps the on-disk format a plain
 * array of floats that any later process can re-read without a database.
 */

import { bm25Scores, cosineSimilarity, embedTexts, embeddingsAvailable, type RankMode } from '../search/rank';
import type { TextChunk } from '../extract';
import { readDocument, readManifest, readVectors, type IndexManifest } from './store';

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

function collectCandidates(
  manifest: IndexManifest,
  options: IndexSearchOptions,
): { candidates: Candidate[]; filesSearched: number; missingVectors: boolean } {
  const wanted = options.fileIds?.length ? new Set(options.fileIds) : null;
  const needle = options.fileNameContains?.toLowerCase();
  const dimensions = manifest.embedding?.dimensions ?? 0;

  const candidates: Candidate[] = [];
  let filesSearched = 0;
  let missingVectors = false;

  for (const fileId of Object.keys(manifest.files)) {
    if (wanted && !wanted.has(fileId)) continue;
    const entry = manifest.files[fileId];
    if (needle && !entry.fileName.toLowerCase().includes(needle)) continue;

    const document = readDocument(manifest.indexId, fileId);
    if (!document) continue;
    const vectors = dimensions ? readVectors(manifest.indexId, fileId, dimensions) : null;
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
  const manifest = readManifest(indexId);
  if (!manifest) {
    throw new Error(
      `No index "${indexId}" on this server. Build one with build_file_area_index first ` +
        '(indexes live in the OS temp directory and do not survive a restart of the machine).',
    );
  }

  const topK = options.topK ?? 8;
  const perFileLimit = options.perFileLimit === undefined ? 3 : options.perFileLimit;
  const warnings: string[] = [];

  const { candidates, filesSearched, missingVectors } = collectCandidates(manifest, options);
  if (!candidates.length) {
    return { indexId, mode: 'lexical', query, filesSearched, chunksSearched: 0, matches: [], warnings };
  }

  const semantic = Boolean(manifest.embedding) && embeddingsAvailable() && !missingVectors;
  if (manifest.embedding && !embeddingsAvailable()) {
    warnings.push('OPENAI_API_KEY is not set — ranking lexically (BM25) instead of semantically.');
  }
  if (missingVectors) {
    warnings.push(
      'Some documents have no embeddings (indexed before the key was set) — ranking lexically so scores stay comparable. Re-run build_file_area_index with refresh=true to embed them.',
    );
  }

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
