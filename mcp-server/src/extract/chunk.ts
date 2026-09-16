/**
 * Shared chunking primitives.
 *
 * Chunk size/overlap match the Python RAG pipeline
 * (`dalux_build/ai/rag/vectorstore.py`), so passages retrieved through either
 * path read the same and embeddings stay comparable.
 */

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 150;

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Split one continuous blob of text into overlapping windows. */
export function splitText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  const step = Math.max(1, chunkSize - overlap);
  const out: string[] = [];
  for (let start = 0; start < normalized.length; start += step) {
    out.push(normalized.slice(start, start + chunkSize));
    if (start + chunkSize >= normalized.length) break;
  }
  return out;
}

export interface PackedChunk {
  text: string;
  /** Indexes into the input `lines` array, inclusive — used to build a location label. */
  firstLine: number;
  lastLine: number;
}

/**
 * Pack already-meaningful lines (paragraphs, spreadsheet rows) into chunks
 * without cutting a line in half, repeating the tail of the previous chunk for
 * overlap. A single line longer than `chunkSize` becomes its own chunk rather
 * than being split, so a long paragraph stays intelligible.
 */
export function packLines(
  lines: readonly string[],
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): PackedChunk[] {
  const chunks: PackedChunk[] = [];
  // Blank lines are dropped, so each buffered line carries its own source index
  // rather than the range being inferred from the buffer length.
  let buffer: { text: string; index: number }[] = [];
  let length = 0;

  const flush = () => {
    if (!buffer.length) return;
    chunks.push({
      text: buffer.map((line) => line.text).join('\n'),
      firstLine: buffer[0].index,
      lastLine: buffer[buffer.length - 1].index,
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i].trim();
    if (!text) continue;

    if (length > 0 && length + text.length + 1 > chunkSize) {
      flush();
      // Carry back whole trailing lines until `overlap` characters are covered,
      // so a passage split mid-table keeps its immediate context.
      const carried: { text: string; index: number }[] = [];
      let carriedLength = 0;
      for (let j = buffer.length - 1; j >= 0 && carriedLength < overlap; j -= 1) {
        const candidate = carriedLength + buffer[j].text.length + 1;
        // Never carry so much that the next chunk starts out nearly full —
        // one very long line would otherwise repeat in every chunk after it.
        if (carried.length && candidate > chunkSize / 2) break;
        carried.unshift(buffer[j]);
        carriedLength = candidate;
      }
      if (carriedLength > chunkSize / 2) {
        carried.length = 0;
        carriedLength = 0;
      }
      buffer = carried;
      length = carriedLength;
    }

    buffer.push({ text, index: i });
    length += text.length + 1;
  }

  flush();
  return chunks;
}
