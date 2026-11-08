import { sql } from 'drizzle-orm';
import { listMemory, toVectorLiteral, withAccount, type Db, type MemoryEntry, type MemoryKind, type MemoryScope } from '@dalux-platform/db';

/** Candidates taken from each ranking before they are merged. */
const CANDIDATES = 20;
/** Reciprocal-rank-fusion constant: how much a first place beats a second. */
const RRF_K = 60;

export interface MemoryHit {
  entry: MemoryEntry;
  score: number;
}

export interface MemorySearchRequest {
  query: string;
  kind?: MemoryKind;
  topK: number;
  /** The query's embedding; without one only full-text search runs. */
  embedding?: readonly number[];
}

/**
 * Hybrid search over one project's current entries: pgvector cosine distance (exact, since a person's entries
 * for a project are capped) and full-text search on the same `simple` config as the document chunks, merged by
 * reciprocal rank fusion. Runs as the owner, so row-level security applies. `score` is 1 for a first place in
 * every ranking used.
 */
export async function searchMemory(db: Db, scope: MemoryScope, request: MemorySearchRequest): Promise<MemoryHit[]> {
  const where = sql`account_id = ${scope.accountId} and connection_id = ${scope.connectionId} and project_id = ${scope.projectId}
    and superseded_by is null ${request.kind ? sql`and kind = ${request.kind}` : sql``}`;

  const rankings = await withAccount(db, scope.accountId, async (tx) => {
    const lexical = await tx.execute<{ id: string }>(sql`
      with q as (
        select (select string_agg(quote_literal(lexeme), ' | ')
                from unnest(tsvector_to_array(to_tsvector('simple', ${request.query}))) as lexeme)::tsquery as query
      )
      select m.id from memory_entries m, q
      where ${where} and m.tsv @@ q.query
      order by ts_rank_cd(m.tsv, q.query, 1) desc, m.updated_at desc
      limit ${CANDIDATES}`);
    const semantic = request.embedding
      ? await tx.execute<{ id: string }>(sql`
          select id from memory_entries
          where ${where} and embedding is not null
          order by embedding <=> ${toVectorLiteral(request.embedding)}::vector
          limit ${CANDIDATES}`)
      : { rows: [] };
    return { lexical: lexical.rows, semantic: semantic.rows, used: request.embedding ? 2 : 1 };
  });

  const scores = new Map<string, number>();
  for (const ranking of [rankings.lexical, rankings.semantic]) {
    ranking.forEach((row, rank) => scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1)));
  }
  const best = [...scores].sort((a, b) => b[1] - a[1]).slice(0, request.topK);
  if (!best.length) return [];

  const { entries } = await listMemory(db, scope, { ids: best.map(([id]) => id), limit: best.length });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const top = rankings.used / (RRF_K + 1);
  return best.flatMap(([id, score]) => {
    const entry = byId.get(id);
    return entry ? [{ entry, score: Number((score / top).toFixed(3)) }] : [];
  });
}
