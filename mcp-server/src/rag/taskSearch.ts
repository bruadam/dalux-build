/**
 * Cross-task search over a temporary task index (rag/taskStore.ts) — the
 * task-side sibling of rag/search.ts, which searches file-area indexes.
 *
 * Brute-force cosine/BM25 over every chunk, same trade-off as the file-area
 * search: at the scale one project's tasks reach (thousands, not millions,
 * of chunks) a linear scan costs a few milliseconds.
 */

import { bm25Scores, cosineSimilarity, embedTexts, embeddingsAvailable, type RankMode } from '../search/rank';
import { readDocument, readManifest, readVectors, type TaskIndexManifest, type TaskManifestEntry } from './taskStore';

export interface TaskSearchMatch {
  taskId: string;
  subject: string;
  number: string | null;
  usage: string | null;
  location: string;
  text: string;
  score: number;
}

export interface TaskIndexSearchOptions {
  topK?: number;
  /** Cap on matches from any single task, so one long change history cannot fill the answer. */
  perTaskLimit?: number | null;
}

export interface TaskIndexSearchResult {
  indexId: string;
  mode: RankMode;
  query: string;
  tasksSearched: number;
  chunksSearched: number;
  matches: TaskSearchMatch[];
  warnings: string[];
}

interface Candidate {
  taskId: string;
  entry: TaskManifestEntry;
  chunk: { location: string; text: string };
  vector: Float32Array | null;
}

function collectCandidates(manifest: TaskIndexManifest): { candidates: Candidate[]; tasksSearched: number; missingVectors: boolean } {
  const dimensions = manifest.embedding?.dimensions ?? 0;
  const candidates: Candidate[] = [];
  let tasksSearched = 0;
  let missingVectors = false;

  for (const taskId of Object.keys(manifest.tasks)) {
    const entry = manifest.tasks[taskId];
    const document = readDocument(manifest.indexId, taskId);
    if (!document) continue;
    const vectors = dimensions ? readVectors(manifest.indexId, taskId, dimensions) : null;
    if (dimensions && (!vectors || vectors.length !== document.chunks.length)) missingVectors = true;

    tasksSearched += 1;
    document.chunks.forEach((chunk, i) => {
      candidates.push({ taskId, entry, chunk, vector: vectors?.[i] ?? null });
    });
  }

  return { candidates, tasksSearched, missingVectors };
}

function applyPerTaskLimit(matches: TaskSearchMatch[], topK: number, perTaskLimit: number | null): TaskSearchMatch[] {
  if (perTaskLimit === null) return matches.slice(0, topK);
  const perTask = new Map<string, number>();
  const kept: TaskSearchMatch[] = [];
  for (const match of matches) {
    const used = perTask.get(match.taskId) ?? 0;
    if (used >= perTaskLimit) continue;
    perTask.set(match.taskId, used + 1);
    kept.push(match);
    if (kept.length >= topK) break;
  }
  return kept;
}

export async function searchTaskIndex(
  indexId: string,
  query: string,
  options: TaskIndexSearchOptions = {},
): Promise<TaskIndexSearchResult> {
  const manifest = readManifest(indexId);
  if (!manifest) {
    throw new Error(
      `No task index "${indexId}" on this server. Build one with build_task_index first ` +
        '(indexes live in the OS temp directory and do not survive a restart of the machine).',
    );
  }

  const topK = options.topK ?? 10;
  const perTaskLimit = options.perTaskLimit === undefined ? 3 : options.perTaskLimit;
  const warnings: string[] = [];

  const { candidates, tasksSearched, missingVectors } = collectCandidates(manifest);
  if (!candidates.length) {
    return { indexId, mode: 'lexical', query, tasksSearched, chunksSearched: 0, matches: [], warnings };
  }

  const semantic = Boolean(manifest.embedding) && embeddingsAvailable() && !missingVectors;
  if (manifest.embedding && !embeddingsAvailable()) {
    warnings.push('OPENAI_API_KEY is not set — ranking lexically (BM25) instead of semantically.');
  }
  if (missingVectors) {
    warnings.push(
      'Some tasks have no embeddings (indexed before the key was set) — ranking lexically so scores stay comparable. Re-run build_task_index with refresh=true to embed them.',
    );
  }

  const toMatch = (candidate: Candidate, score: number): TaskSearchMatch => ({
    taskId: candidate.taskId,
    subject: candidate.entry.subject,
    number: candidate.entry.number,
    usage: candidate.entry.usage,
    location: candidate.chunk.location,
    text: candidate.chunk.text,
    score,
  });

  let scored: TaskSearchMatch[];
  if (semantic) {
    const [queryVector] = await embedTexts([query]);
    scored = candidates.map((candidate) =>
      toMatch(candidate, candidate.vector ? cosineSimilarity(queryVector, Array.from(candidate.vector)) : 0),
    );
  } else {
    const scores = bm25Scores(candidates.map((candidate) => candidate.chunk.text), query);
    scored = candidates.map((candidate, i) => toMatch(candidate, scores[i])).filter((match) => match.score > 0);
  }

  scored.sort((a, b) => b.score - a.score);

  return {
    indexId,
    mode: semantic ? 'embeddings' : 'lexical',
    query,
    tasksSearched,
    chunksSearched: candidates.length,
    matches: applyPerTaskLimit(scored, topK, perTaskLimit),
    warnings,
  };
}
