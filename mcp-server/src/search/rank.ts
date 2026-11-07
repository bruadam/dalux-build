/**
 * Ranking for document search.
 *
 * With `MISTRAL_API_KEY` set, chunks are ranked by cosine similarity of
 * embeddings (real semantic search). Without it, ranking falls back to BM25 —
 * still useful for the code-like identifiers that dominate construction
 * documents (drawing numbers, "C30/37", "EN 1992-1-1"), where lexical matching
 * often beats embeddings anyway, and it needs no API key at all.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const EMBEDDING_MODEL = 'mistral-embed';
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Request sizing for mistral-embed (8k-token context per input). Batches are
 * capped by total characters as well as by count: Mistral rejects a request
 * whose inputs add up to too many tokens, and 96 full-size chunks would.
 * Budgets assume ~3 characters per token, a safe figure for the Danish,
 * Norwegian and German text common in Dalux projects.
 */
const EMBED_BATCH = 96;
const EMBED_BATCH_CHARS = 32_000;
const MAX_EMBED_CHARS = 8000;

/** The SDK does not retry by default; one rate-limit response would otherwise abort a whole index build. */
const EMBED_RETRY = {
  strategy: 'backoff',
  backoff: { initialInterval: 1000, maxInterval: 30_000, exponent: 2, maxElapsedTime: 120_000 },
  retryConnectionErrors: true,
} as const;

export type RankMode = 'embeddings' | 'lexical';

export interface EmbeddingUsage {
  calls: number;
  tokens: number;
  /** True when at least one response had no usage and its tokens were estimated (characters / 3). */
  estimated: boolean;
}

interface EmbeddingSession {
  apiKey: string | null;
  usage: EmbeddingUsage;
}

const embeddingSession = new AsyncLocalStorage<EmbeddingSession>();

/**
 * Runs `fn` with an explicit embedding key instead of `MISTRAL_API_KEY`, and
 * counts the tokens its embedding calls use. The platform worker passes the
 * admin's key from the settings (setting it is the consent to send document
 * text to the provider); `null` means lexical only, with no env fallback.
 */
export async function withEmbeddingKey<T>(
  apiKey: string | null,
  fn: () => Promise<T>,
): Promise<{ result: T; usage: EmbeddingUsage }> {
  const usage: EmbeddingUsage = { calls: 0, tokens: 0, estimated: false };
  const result = await embeddingSession.run({ apiKey, usage }, fn);
  return { result, usage };
}

function embeddingKey(): string | null {
  const session = embeddingSession.getStore();
  return session ? session.apiKey : process.env.MISTRAL_API_KEY || null;
}

export function embeddingsAvailable(): boolean {
  return Boolean(embeddingKey());
}

export async function embedTexts(texts: readonly string[]): Promise<number[][]> {
  const apiKey = embeddingKey();
  if (!apiKey) throw new Error('MISTRAL_API_KEY is not set.');
  const usage = embeddingSession.getStore()?.usage;
  if (!texts.length) return [];

  const { Mistral } = await import('@mistralai/mistralai');
  const client = new Mistral({ apiKey, retryConfig: EMBED_RETRY });
  const vectors: number[][] = [];
  for (const batch of embeddingBatches(texts)) {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      inputs: batch,
    });
    if (usage) {
      usage.calls += 1;
      const tokens = response.usage?.promptTokens;
      if (tokens === undefined) usage.estimated = true;
      usage.tokens += tokens ?? Math.ceil(batch.reduce((total, input) => total + input.length, 0) / 3);
    }
    const items = [...response.data].sort((a, b) => (a.index ?? -1) - (b.index ?? -1));
    if (items.length !== batch.length || items.some((item, index) =>
      item.index !== index || !item.embedding?.length || item.embedding.some((value) => !Number.isFinite(value))
    )) {
      throw new Error('Mistral returned incomplete or invalid embeddings.');
    }
    vectors.push(...items.map((item) => item.embedding!));
  }
  return vectors;
}

function* embeddingBatches(texts: readonly string[]): Generator<string[]> {
  let batch: string[] = [];
  let chars = 0;
  for (const text of texts) {
    const input = text.slice(0, MAX_EMBED_CHARS);
    if (batch.length && (batch.length === EMBED_BATCH || chars + input.length > EMBED_BATCH_CHARS)) {
      yield batch;
      batch = [];
      chars = 0;
    }
    batch.push(input);
    chars += input.length;
  }
  if (batch.length) yield batch;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * Maps a raw BM25 score into 0..1 through `raw / (raw + SATURATION)`.
 *
 * Deliberately *not* normalised by the best score in the set: dividing by the
 * maximum makes the top hit of a query nothing matches look like a perfect
 * 1.000, and an agent shown 1.000 will quote it. With a fixed saturation point
 * a weak lexical overlap scores ~0.15 and a strong multi-term one ~0.7, so the
 * number means something on its own.
 */
const BM25_SATURATION = 3;

/** BM25 scores for `query` against each document, on a 0..1 scale. */
export function bm25Scores(documents: readonly string[], query: string): number[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (!documents.length || !queryTerms.length) return documents.map(() => 0);

  const termFrequencies = documents.map((document) => {
    const counts = new Map<string, number>();
    for (const term of tokenize(document)) counts.set(term, (counts.get(term) ?? 0) + 1);
    return counts;
  });
  const lengths = termFrequencies.map((counts) => [...counts.values()].reduce((a, b) => a + b, 0));
  const averageLength = lengths.reduce((a, b) => a + b, 0) / documents.length || 1;

  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const documentFrequency = termFrequencies.reduce((n, counts) => n + (counts.has(term) ? 1 : 0), 0);
    // The +1 smoothed form, so a term present in every document scores ~0
    // rather than going negative.
    idf.set(term, Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5)));
  }

  return termFrequencies.map((counts, i) => {
    let raw = 0;
    for (const term of queryTerms) {
      const frequency = counts.get(term) ?? 0;
      if (!frequency) continue;
      const denominator = frequency + BM25_K1 * (1 - BM25_B + (BM25_B * lengths[i]) / averageLength);
      raw += (idf.get(term) ?? 0) * ((frequency * (BM25_K1 + 1)) / denominator);
    }
    return raw / (raw + BM25_SATURATION);
  });
}
