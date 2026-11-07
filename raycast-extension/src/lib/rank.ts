/**
 * Client-side keyword ranking for list commands.
 *
 * Every query term must match at least one field (AND). Each match scores by
 * how well it matches (whole token > token prefix > substring), the field's
 * weight, and the term's rarity across the list (BM25-style IDF), so a rare
 * drawing number outranks a common word. The whole query found verbatim in a
 * field earns a bonus, which keeps identifiers like "A-101" on top.
 */

export interface RankField {
  text: string | null | undefined;
  weight: number;
}

const TOKEN_MATCH = 1;
const PREFIX_MATCH = 0.7;
const SUBSTRING_MATCH = 0.4;

export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFC").trim();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

interface PreparedField {
  text: string;
  tokens: string[];
  weight: number;
}

function prepare(fields: RankField[]): PreparedField[] {
  return fields
    .filter((field): field is { text: string; weight: number } => Boolean(field.text))
    .map((field) => ({ text: normalize(field.text), tokens: tokenize(field.text), weight: field.weight }));
}

function termMatch(field: PreparedField, term: string): number {
  if (!field.text.includes(term)) return 0;
  if (field.tokens.includes(term)) return TOKEN_MATCH;
  if (field.tokens.some((token) => token.startsWith(term))) return PREFIX_MATCH;
  return SUBSTRING_MATCH;
}

/**
 * Returns the items matching every term of `query`, best first. An empty
 * query returns the items unchanged.
 */
export function rankItems<T>(items: readonly T[], query: string, fieldsOf: (item: T) => RankField[]): T[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [...items];
  const phrase = normalize(query);

  const prepared = items.map((item) => prepare(fieldsOf(item)));
  const documentFrequency = terms.map(
    (term) => prepared.filter((fields) => fields.some((field) => field.text.includes(term))).length,
  );
  const idf = documentFrequency.map((df) => Math.log(1 + (items.length - df + 0.5) / (df + 0.5)));

  const scored: { item: T; score: number; index: number }[] = [];
  prepared.forEach((fields, index) => {
    let score = 0;
    for (let t = 0; t < terms.length; t += 1) {
      const best = Math.max(0, ...fields.map((field) => termMatch(field, terms[t]) * field.weight));
      if (best === 0) return;
      score += best * idf[t];
    }
    for (const field of fields) {
      if (field.text === phrase) score += field.weight * 2;
      else if (field.text.includes(phrase)) score += field.weight;
    }
    scored.push({ item: items[index], score, index });
  });

  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.item);
}
