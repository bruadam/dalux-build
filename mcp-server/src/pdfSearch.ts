import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

export function cacheDirFor(fileId: string): string {
  const dir = path.join(tmpdir(), 'dalux-mcp', 'files', fileId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface TextChunk {
  page: number;
  text: string;
}

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

/** Split a page's text into overlapping chunks, mirroring the chunk size used by the Python RAG pipeline. */
function chunkPageText(page: number, text: string): TextChunk[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE, normalized.length);
    chunks.push({ page, text: normalized.slice(start, end) });
    if (end === normalized.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

export async function extractChunks(pdfFilePath: string): Promise<TextChunk[]> {
  const buffer = readFileSync(pdfFilePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.flatMap((p) => chunkPageText(p.num, p.text));
  } finally {
    await parser.destroy();
  }
}

export interface ScoredChunk extends TextChunk {
  score: number;
}

function keywordScore(text: string, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const lower = text.toLowerCase();
  return terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0) / terms.length;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embed(texts: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI embeddings request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { data: { embedding: number[]; index: number }[] };
  return body.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/**
 * Rank chunks against `query`. Uses OpenAI embeddings for real semantic
 * search when `OPENAI_API_KEY` is set; otherwise falls back to a simple
 * keyword-overlap score so the tool still works with zero extra config.
 */
export async function searchChunks(chunks: TextChunk[], query: string, topK: number): Promise<ScoredChunk[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && chunks.length) {
    const [queryEmbedding, ...chunkEmbeddings] = await embed([query, ...chunks.map((c) => c.text)], apiKey);
    return chunks
      .map((chunk, i) => ({ ...chunk, score: cosineSimilarity(queryEmbedding, chunkEmbeddings[i]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  return chunks
    .map((chunk) => ({ ...chunk, score: keywordScore(chunk.text, query) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
