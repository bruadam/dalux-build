import { packLines, splitText } from '../src/extract/chunk';
import { bm25Scores, cosineSimilarity, tokenize } from '../src/search/rank';

describe('chunking', () => {
  it('splits a long blob into overlapping windows', () => {
    const text = 'a'.repeat(2500);
    const chunks = splitText(text, 1000, 150);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(1000);
    // Each window starts 850 characters on, so 150 characters repeat.
    expect(chunks[2].length).toBe(2500 - 2 * 850);
  });

  it('collapses whitespace so PDF line breaks do not fragment a sentence', () => {
    expect(splitText('The  contractor\n\nshall   provide\tscaffolding.')).toEqual([
      'The contractor shall provide scaffolding.',
    ]);
  });

  it('never cuts a line in half, and reports the lines each chunk covers', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `Row ${i}: ${'x'.repeat(60)}`);

    const chunks = packLines(lines, 300, 80);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const line of chunk.text.split('\n')) {
        expect(lines).toContain(line);
      }
      expect(chunk.firstLine).toBeLessThanOrEqual(chunk.lastLine);
    }
    expect(chunks[0].firstLine).toBe(0);
    expect(chunks[chunks.length - 1].lastLine).toBe(39);
  });

  it('keeps line numbering honest when blank lines are dropped', () => {
    const chunks = packLines(['first', '', '', 'second'], 1000, 100);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ text: 'first\nsecond', firstLine: 0, lastLine: 3 });
  });
});

describe('lexical ranking', () => {
  it('splits on punctuation but keeps digits, which drawing and standard numbers need', () => {
    expect(tokenize('EN 1992-1-1 (C30/37) — beton')).toEqual(['en', '1992', '1', '1', 'c30', '37', 'beton']);
  });

  it('ranks the passage that actually contains the rare query terms first', () => {
    const documents = [
      'The contractor shall provide temporary fencing around the site.',
      'All doors in escape routes shall achieve fire rating EI60.',
      'Fire extinguishers shall be inspected annually.',
    ];

    const scores = bm25Scores(documents, 'fire rating EI60');

    expect(scores[1]).toBeGreaterThan(scores[2]);
    expect(scores[2]).toBeGreaterThan(scores[0]);
    // Absolute, not normalised to the best hit: the full-term match stands
    // clear of the weak-match band (< 0.3) without being flattered to 1.0.
    expect(scores[1]).toBeGreaterThan(0.35);
    expect(scores[1]).toBeLessThan(1);
  });

  it('keeps a weak match visibly weak instead of flattering it to 1.0', () => {
    const documents = [
      'The site hoarding shall be maintained in good order.',
      'Deliveries are scheduled weekly.',
    ];

    // "terms" appears once, in a sentence about nothing like payment.
    const scores = bm25Scores(documents, 'payment terms retention bond');

    expect(Math.max(...scores)).toBeLessThan(0.3);
  });

  it('scores every document zero when nothing matches, rather than ranking noise', () => {
    expect(bm25Scores(['concrete', 'steel'], 'timber cladding')).toEqual([0, 0]);
  });

  it('discounts terms that appear in every document', () => {
    const documents = Array.from({ length: 5 }, (_, i) => `shall ${i === 0 ? 'ventilation' : 'generic'} clause`);

    const common = bm25Scores(documents, 'shall');
    const rare = bm25Scores(documents, 'ventilation');

    // A term in one document out of five separates it cleanly; one present in
    // all five carries almost no information and must score far lower.
    expect(rare[0]).toBeGreaterThan(0.3);
    expect(rare.slice(1)).toEqual([0, 0, 0, 0]);
    expect(Math.max(...common)).toBeLessThan(rare[0] / 2);
    expect(new Set(common).size).toBe(1);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('treats a zero vector as unrelated instead of dividing by zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
