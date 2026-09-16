/**
 * Ranking for document search.
 *
 * With `OPENAI_API_KEY` set, chunks are ranked by cosine similarity of
 * embeddings (real semantic search). Without it, ranking falls back to BM25 —
 * still useful for the code-like identifiers that dominate construction
 * documents (drawing numbers, "C30/37", "EN 1992-1-1"), where lexical matching
 * often beats embeddings anyway, and it needs no API key at all.
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

/** Batch size and per-input truncation keeping requests inside the model's limits. */
const EMBED_BATCH = 96;
const MAX_EMBED_CHARS = 8000;

export type RankMode = 'embeddings' | 'lexical';

export function embeddingsAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function embedTexts(texts: readonly string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  if (!texts.length) return [];

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const batch = texts.slice(start, start + EMBED_BATCH).map((text) => text.slice(0, MAX_EMBED_CHARS));
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI embeddings request failed: HTTP ${response.status} ${detail.slice(0, 200)}`);
    }
    const body = (await response.json()) as { data: { embedding: number[]; index: number }[] };
    vectors.push(...body.data.sort((a, b) => a.index - b.index).map((item) => item.embedding));
  }
  return vectors;
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
