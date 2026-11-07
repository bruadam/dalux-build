/**
 * The one gate for sending document or task text to Mistral: consistency fact
 * extraction and judging (consistency/model.ts) and embeddings for semantic
 * ranking (search/rank.ts). Needs MISTRAL_API_KEY and the operator's explicit
 * opt-in DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO=true.
 */

/** Why text may not be sent to Mistral, or null when it may. */
export function mistralUnavailableReason(): string | null {
  if (!process.env.MISTRAL_API_KEY) return 'MISTRAL_API_KEY is not set';
  if (process.env.DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO !== 'true') {
    return 'DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO is not "true", so document text is not sent to Mistral';
  }
  return null;
}

export function mistralAllowed(): boolean {
  return mistralUnavailableReason() === null;
}

export const SEMANTIC_RANKING_OFF =
  'Semantic ranking is off: set DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO=true (and MISTRAL_API_KEY) to send text to Mistral.';

/**
 * The warning for a lexical-only result, when it is worth one: the operator set
 * MISTRAL_API_KEY but not the opt-in, or the index holds embeddings it can no longer use.
 */
export function semanticRankingWarning(hasStoredEmbeddings = false): string | undefined {
  if (mistralAllowed()) return undefined;
  return hasStoredEmbeddings || process.env.MISTRAL_API_KEY ? SEMANTIC_RANKING_OFF : undefined;
}
