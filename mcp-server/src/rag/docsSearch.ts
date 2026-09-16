/**
 * Cross-document search over a temporary docs-repo index (docsStore.ts) — the
 * GitHub-sourced sibling of rag/search.ts (file-area indexes).
 */

import { bm25Scores, cosineSimilarity, embedTexts, embeddingsAvailable, type RankMode } from '../search/rank';
import type { TextChunk } from '../extract';
import { readDocument, readManifest, readVectors, type DocsIndexManifest } from './docsStore';

export interface DocsSearchMatch extends TextChunk {
  path: string;
  score: number;
}

export interface DocsIndexSearchOptions {
  topK?: number;
  /** Cap on matches from any single document, so one verbose file cannot fill the answer. */
  perDocLimit?: number | null;
  /** Case-insensitive substring filter on the repo path. */
  pathContains?: string;
}

export interface DocsIndexSearchResult {
  indexId: string;
  mode: RankMode;
  query: string;
  docsSearched: number;
  chunksSearched: number;
  matches: DocsSearchMatch[];
  warnings: string[];
}

interface Candidate {
  path: string;
  chunk: TextChunk;
  vector: Float32Array | null;
}

function collectCandidates(
  manifest: DocsIndexManifest,
  options: DocsIndexSearchOptions,
): { candidates: Candidate[]; docsSearched: number; missingVectors: boolean } {
  const needle = options.pathContains?.toLowerCase();
  const dimensions = manifest.embedding?.dimensions ?? 0;

  const candidates: Candidate[] = [];
  let docsSearched = 0;
  let missingVectors = false;

  for (const docPath of Object.keys(manifest.docs)) {
    if (needle && !docPath.toLowerCase().includes(needle)) continue;

    const document = readDocument(manifest.indexId, docPath);
    if (!document) continue;
    const vectors = dimensions ? readVectors(manifest.indexId, docPath, dimensions) : null;
    if (dimensions && (!vectors || vectors.length !== document.chunks.length)) missingVectors = true;

    docsSearched += 1;
    document.chunks.forEach((chunk, i) => {
      candidates.push({ path: docPath, chunk, vector: vectors?.[i] ?? null });
    });
  }

  return { candidates, docsSearched, missingVectors };
}

function applyPerDocLimit(matches: DocsSearchMatch[], topK: number, perDocLimit: number | null): DocsSearchMatch[] {
  if (perDocLimit === null) return matches.slice(0, topK);
  const perDoc = new Map<string, number>();
  const kept: DocsSearchMatch[] = [];
  for (const match of matches) {
    const used = perDoc.get(match.path) ?? 0;
    if (used >= perDocLimit) continue;
    perDoc.set(match.path, used + 1);
    kept.push(match);
    if (kept.length >= topK) break;
  }
  return kept;
}

export async function searchDocsIndex(
  indexId: string,
  query: string,
  options: DocsIndexSearchOptions = {},
): Promise<DocsIndexSearchResult> {
  const manifest = readManifest(indexId);
  if (!manifest) {
    throw new Error(`No docs index "${indexId}" on this server. Build one with \`npm run docs:build\` first.`);
  }

  const topK = options.topK ?? 8;
  const perDocLimit = options.perDocLimit === undefined ? 3 : options.perDocLimit;
  const warnings: string[] = [];

  const { candidates, docsSearched, missingVectors } = collectCandidates(manifest, options);
  if (!candidates.length) {
    return { indexId, mode: 'lexical', query, docsSearched, chunksSearched: 0, matches: [], warnings };
  }

  const semantic = Boolean(manifest.embedding) && embeddingsAvailable() && !missingVectors;
  if (manifest.embedding && !embeddingsAvailable()) {
    warnings.push('OPENAI_API_KEY is not set — ranking lexically (BM25) instead of semantically.');
  }
  if (missingVectors) {
    warnings.push(
      'Some documents have no embeddings (indexed before the key was set) — ranking lexically so scores stay comparable. Re-run `npm run docs:build -- --refresh` to embed them.',
    );
  }

  let scored: DocsSearchMatch[];
  if (semantic) {
    const [queryVector] = await embedTexts([query]);
    scored = candidates.map((candidate) => ({
      ...candidate.chunk,
      path: candidate.path,
      score: candidate.vector ? cosineSimilarity(queryVector, Array.from(candidate.vector)) : 0,
    }));
  } else {
    const scores = bm25Scores(candidates.map((candidate) => candidate.chunk.text), query);
    scored = candidates
      .map((candidate, i) => ({ ...candidate.chunk, path: candidate.path, score: scores[i] }))
      .filter((match) => match.score > 0);
  }

  scored.sort((a, b) => b.score - a.score);

  return {
    indexId,
    mode: semantic ? 'embeddings' : 'lexical',
    query,
    docsSearched,
    chunksSearched: candidates.length,
    matches: applyPerDocLimit(scored, topK, perDocLimit),
    warnings,
  };
}
