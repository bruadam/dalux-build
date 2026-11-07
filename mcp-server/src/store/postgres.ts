/**
 * Postgres index store for the platform (tables of @dalux-platform/db).
 *
 * Reads run as the `mcp` role inside withAccount(), so row-level security hides
 * the documents and chunks the caller may not see; a manifest therefore lists
 * only visible documents. Writes, and the reads index builds rely on, run as
 * the `worker` role, which sees every row. Indexes belong to the request's
 * connection; the tools' index id is stored as `external_id`.
 */

import { sql, type SQL } from 'drizzle-orm';
import { withAccount, type Db, type Tx } from '@dalux-platform/db';
import { currentContext } from '../access/requestScope';
import type {
  ChunkSearchRequest,
  ChunkSearchResult,
  DocsIndexManifest,
  DocsIndexSummary,
  IndexManifest,
  IndexStore,
  IndexStores,
  IndexSummary,
  IndexedDoc,
  IndexedDocument,
  IndexedTask,
  TaskIndexManifest,
  TaskIndexSummary,
  DocumentAccess,
} from './types';

type Kind = 'file' | 'task' | 'docs';

interface ManifestBase {
  indexId: string;
  scope: unknown;
  createdAt: string;
  updatedAt: string;
  embedding: { model: string; dimensions: number } | null;
}

interface Counts {
  documentCount: number;
  chunkCount: number;
  sizeBytes: number;
}

/** How one kind of index maps onto the shared tables. */
interface KindMapping<Manifest extends ManifestBase, Document extends { chunks: object[] }, Summary> {
  kind: Kind;
  entries(manifest: Manifest): Record<string, { revisionKey: string; chunkCount: number }>;
  buildState(manifest: Manifest): Record<string, unknown>;
  manifest(base: ManifestBase, entries: Record<string, never>, buildState: Record<string, never>): Manifest;
  summary(base: ManifestBase, counts: Counts): Summary;
  documentId(document: Document): string;
  title(document: Document): string | null;
  access(document: Document): DocumentAccess | undefined;
  scopeArea(scope: unknown): { projectId: string | null; fileAreaId: string | null };
}

const mode = (base: ManifestBase) => (base.embedding ? 'embeddings' : 'lexical') as 'embeddings' | 'lexical';

const fileMapping: KindMapping<IndexManifest, IndexedDocument, IndexSummary> = {
  kind: 'file',
  entries: (manifest) => manifest.files,
  buildState: (manifest) => ({ skipped: manifest.skipped, failed: manifest.failed }),
  manifest: (base, files, state) => ({
    ...(base as IndexManifest),
    files,
    skipped: state.skipped ?? [],
    failed: state.failed ?? [],
  }),
  summary: (base, counts) => ({
    indexId: base.indexId,
    scope: base.scope as IndexManifest['scope'],
    fileCount: counts.documentCount,
    chunkCount: counts.chunkCount,
    updatedAt: base.updatedAt,
    mode: mode(base),
    sizeBytes: counts.sizeBytes,
  }),
  documentId: (document) => document.fileId,
  title: (document) => document.fileName,
  access: (document) => document.access,
  scopeArea: (scope) => {
    const { projectId, fileAreaId } = scope as IndexManifest['scope'];
    return { projectId, fileAreaId };
  },
};

const taskMapping: KindMapping<TaskIndexManifest, IndexedTask, TaskIndexSummary> = {
  kind: 'task',
  entries: (manifest) => manifest.tasks,
  buildState: () => ({}),
  manifest: (base, tasks) => ({ ...(base as TaskIndexManifest), tasks }),
  summary: (base, counts) => ({
    indexId: base.indexId,
    scope: base.scope as TaskIndexManifest['scope'],
    taskCount: counts.documentCount,
    chunkCount: counts.chunkCount,
    updatedAt: base.updatedAt,
    mode: mode(base),
    sizeBytes: counts.sizeBytes,
  }),
  documentId: (document) => document.taskId,
  title: () => null,
  access: (document) => document.access,
  scopeArea: (scope) => ({ projectId: (scope as TaskIndexManifest['scope']).projectId, fileAreaId: null }),
};

const docsMapping: KindMapping<DocsIndexManifest, IndexedDoc, DocsIndexSummary> = {
  kind: 'docs',
  entries: (manifest) => manifest.docs,
  buildState: (manifest) => ({ failed: manifest.failed }),
  manifest: (base, docs, state) => ({ ...(base as DocsIndexManifest), docs, failed: state.failed ?? [] }),
  summary: (base, counts) => ({
    indexId: base.indexId,
    scope: base.scope as DocsIndexManifest['scope'],
    docCount: counts.documentCount,
    chunkCount: counts.chunkCount,
    updatedAt: base.updatedAt,
    mode: mode(base),
    sizeBytes: counts.sizeBytes,
  }),
  documentId: (document) => document.path,
  title: (document) => document.path,
  access: () => undefined,
  scopeArea: () => ({ projectId: null, fileAreaId: null }),
};

/** Candidate rows the approximate (HNSW) scan hands to the per-document limit. */
const annCandidates = (topK: number) => Math.max(topK * 4, 40);

function requestConnectionId(): string {
  const connection = currentContext().connection;
  if (!connection) throw new Error('The Postgres index store needs a connection in the request context.');
  return connection.id;
}

function requestAccountId(): string {
  const account = currentContext().account;
  if (!account) throw new Error('The Postgres index store needs an account in the request context.');
  return account.id;
}

/** A Postgres text[] literal; JSON string escaping matches the array literal syntax. */
function textArray(values: readonly string[]): string {
  return `{${values.map((value) => JSON.stringify(value)).join(',')}}`;
}

function toVector(values: readonly number[]): string {
  return JSON.stringify(values);
}

/** The `folder_ancestor_ids` column runs from the top folder down to and including the document's folder. */
function folderPath(access: DocumentAccess | undefined): string[] {
  if (!access?.folderId) return [];
  return [...(access.folderAncestorIds ?? []), access.folderId];
}

interface IndexRow {
  id: string;
  external_id: string;
  scope: unknown;
  embedding_model: string | null;
  embedding_dimensions: number | null;
  /** JSON timestamps (to_json), since the driver hands back timestamptz as text. */
  created_at: string;
  updated_at: string;
  build_state?: Record<string, never>;
}

function manifestBase(row: IndexRow): ManifestBase {
  return {
    indexId: row.external_id,
    scope: row.scope,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    embedding:
      row.embedding_model && row.embedding_dimensions
        ? { model: row.embedding_model, dimensions: row.embedding_dimensions }
        : null,
  };
}

async function rows<T>(tx: Tx | Db, query: SQL): Promise<T[]> {
  return (await tx.execute(query)).rows as T[];
}

function createStore<Manifest extends ManifestBase, Document extends { chunks: object[] }, Summary>(
  mapping: KindMapping<Manifest, Document, Summary>,
  pools: { mcp: Db; worker: Db },
  view: 'caller' | 'worker',
): IndexStore<Manifest, Document, Summary> {
  const { kind } = mapping;

  /** Read through row-level security as the caller, or as the worker for index builds. */
  const read = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
    view === 'caller' ? withAccount(pools.mcp, requestAccountId(), fn) : pools.worker.transaction(fn);

  const indexColumns = view === 'caller' ? sql`` : sql`, build_state`;

  async function findIndex(tx: Tx, indexId: string): Promise<IndexRow | null> {
    const [row] = await rows<IndexRow>(
      tx,
      sql`select id, external_id, scope, embedding_model, embedding_dimensions,
                 to_json(created_at) as created_at, to_json(updated_at) as updated_at${indexColumns}
          from indexes
          where connection_id = ${requestConnectionId()} and kind = ${kind} and external_id = ${indexId}`,
    );
    return row ?? null;
  }

  async function ensureIndex(tx: Tx, indexId: string, area: { projectId: string | null; fileAreaId: string | null }) {
    await tx.execute(
      sql`insert into indexes (connection_id, kind, external_id, project_id, file_area_id, scope)
          values (${requestConnectionId()}, ${kind}, ${indexId}, ${area.projectId}, ${area.fileAreaId}, '{}')
          on conflict (connection_id, kind, external_id) do nothing`,
    );
    const [row] = await rows<{ id: string }>(
      tx,
      sql`select id from indexes where connection_id = ${requestConnectionId()} and kind = ${kind} and external_id = ${indexId}`,
    );
    return row.id;
  }

  async function lexical(tx: Tx, index: string, request: ChunkSearchRequest, documentFilter: SQL) {
    return rows<Hit>(
      tx,
      sql`with q as (
            select (select string_agg(quote_literal(lexeme), ' | ')
                    from unnest(tsvector_to_array(to_tsvector('simple', ${request.query}))) as lexeme)::tsquery as query
          ),
          ranked as (
            select d.dalux_id, c.text, c.location, ts_rank_cd(c.tsv, q.query, 1) as raw,
                   row_number() over (partition by c.document_id order by ts_rank_cd(c.tsv, q.query, 1) desc, c.ordinal) as nth
            from chunks c join documents d on d.id = c.document_id, q
            where c.index_id = ${index} and c.tsv @@ q.query ${documentFilter}
          )
          select dalux_id, text, location, raw / (raw + ${LEXICAL_SATURATION}) as score
          from ranked
          where ${request.perDocumentLimit}::int is null or nth <= ${request.perDocumentLimit}::int
          order by score desc
          limit ${request.topK}`,
    );
  }

  async function semantic(tx: Tx, index: string, request: ChunkSearchRequest, documentFilter: SQL, vector: string, exact: boolean) {
    const candidates = exact
      ? sql``
      : sql`order by c.embedding <=> ${vector}::vector limit ${annCandidates(request.topK)}`;
    return rows<Hit>(
      tx,
      sql`with candidates as materialized (
            select c.document_id, c.ordinal, c.text, c.location, c.embedding <=> ${vector}::vector as distance
            from chunks c
            where c.index_id = ${index} and c.embedding is not null
              and c.document_id in (select d.id from documents d where d.index_id = ${index} ${documentFilter})
            ${candidates}
          ),
          ranked as (
            select d.dalux_id, a.text, a.location, 1 - a.distance as score,
                   row_number() over (partition by a.document_id order by a.distance, a.ordinal) as nth
            from candidates a join documents d on d.id = a.document_id
          )
          select dalux_id, text, location, score
          from ranked
          where ${request.perDocumentLimit}::int is null or nth <= ${request.perDocumentLimit}::int
          order by score desc
          limit ${request.topK}`,
    );
  }

  return {
    readManifest: (indexId) =>
      read(async (tx) => {
        const index = await findIndex(tx, indexId);
        if (!index) return null;
        const documents = await rows<{ dalux_id: string; entry: never }>(
          tx,
          sql`select dalux_id, metadata->'entry' as entry from documents where index_id = ${index.id} and metadata ? 'entry'`,
        );
        const entries = Object.fromEntries(documents.map((row) => [row.dalux_id, row.entry])) as Record<string, never>;
        return mapping.manifest(manifestBase(index), entries, index.build_state ?? {});
      }),

    writeManifest: (manifest) =>
      pools.worker.transaction(async (tx) => {
        const area = mapping.scopeArea(manifest.scope);
        const id = await ensureIndex(tx, manifest.indexId, area);
        const entries = mapping.entries(manifest);
        await tx.execute(
          sql`update indexes set
                scope = ${JSON.stringify(manifest.scope)}::jsonb,
                project_id = ${area.projectId}, file_area_id = ${area.fileAreaId},
                embedding_model = ${manifest.embedding?.model ?? null},
                embedding_dimensions = ${manifest.embedding?.dimensions ?? null},
                build_state = ${JSON.stringify(mapping.buildState(manifest))}::jsonb,
                created_at = ${manifest.createdAt}, updated_at = ${manifest.updatedAt}
              where id = ${id}`,
        );
        await tx.execute(
          sql`update documents d set revision = e.value->>'revisionKey', metadata = d.metadata || jsonb_build_object('entry', e.value)
              from jsonb_each(${JSON.stringify(entries)}::jsonb) e
              where d.index_id = ${id} and d.dalux_id = e.key`,
        );
        await tx.execute(
          sql`update documents set metadata = metadata - 'entry'
              where index_id = ${id} and metadata ? 'entry'
                and not (${JSON.stringify(entries)}::jsonb ? dalux_id)`,
        );
      }),

    readDocument: (indexId, documentId) =>
      read(async (tx) => {
        const [document] = await rows<{ id: string; fields: Omit<Document, 'chunks'> }>(
          tx,
          sql`select d.id, d.metadata->'document' as fields
              from documents d join indexes i on i.id = d.index_id
              where i.connection_id = ${requestConnectionId()} and i.kind = ${kind} and i.external_id = ${indexId}
                and d.dalux_id = ${documentId}`,
        );
        if (!document) return null;
        const chunks = await rows<{ text: string; location: object }>(
          tx,
          sql`select text, location from chunks where document_id = ${document.id} order by ordinal`,
        );
        return { ...document.fields, chunks: chunks.map((chunk) => ({ ...chunk.location, text: chunk.text })) } as unknown as Document;
      }),

    writeDocument: (indexId, document, vectors) =>
      pools.worker.transaction(async (tx) => {
        const access = mapping.access(document);
        const index = await ensureIndex(tx, indexId, {
          projectId: access?.projectId ?? null,
          fileAreaId: access?.fileAreaId ?? null,
        });
        const { chunks, ...fields } = document;
        const texts = chunks.map((chunk) => (chunk as { text: string }).text);
        const sizeBytes =
          texts.reduce((total, text) => total + Buffer.byteLength(text), 0) +
          (vectors ?? []).reduce((total, vector) => total + vector.length * 4, 0);
        const embedded = chunks.length === 0 || vectors?.length === chunks.length;
        const folders = textArray(folderPath(access));
        const [row] = await rows<{ id: string; connection_id: string }>(
          tx,
          sql`insert into documents (index_id, connection_id, kind, dalux_id, title, project_id, file_area_id, folder_id, folder_ancestor_ids, metadata)
              select ${index}, i.connection_id, ${kind}, ${mapping.documentId(document)}, ${mapping.title(document)},
                     ${access?.projectId ?? null}, ${access?.fileAreaId ?? null}, ${access?.folderId ?? null},
                     ${folders}::text[],
                     jsonb_build_object('document', ${JSON.stringify(fields)}::jsonb, 'sizeBytes', ${sizeBytes}::bigint, 'embedded', ${embedded}::boolean)
              from indexes i where i.id = ${index}
              on conflict (index_id, dalux_id) do update set
                title = excluded.title, project_id = excluded.project_id, file_area_id = excluded.file_area_id,
                folder_id = excluded.folder_id, folder_ancestor_ids = excluded.folder_ancestor_ids,
                metadata = excluded.metadata || case when documents.metadata ? 'entry'
                  then jsonb_build_object('entry', documents.metadata->'entry') else '{}' end,
                updated_at = now()
              returning id, connection_id`,
        );
        await tx.execute(sql`delete from chunks where document_id = ${row.id}`);
        if (!chunks.length) return;
        const records = chunks.map((chunk, ordinal) => {
          const { text, ...location } = chunk as { text: string };
          return { ordinal, text, location, embedding: vectors?.[ordinal] ? toVector(vectors[ordinal]) : null };
        });
        await tx.execute(
          sql`insert into chunks (document_id, index_id, connection_id, kind, project_id, file_area_id, folder_ancestor_ids, ordinal, text, location, embedding)
              select ${row.id}, ${index}, ${row.connection_id}, ${kind}, ${access?.projectId ?? null}, ${access?.fileAreaId ?? null},
                     ${folders}::text[], r.ordinal, r.text, r.location, r.embedding::vector
              from jsonb_to_recordset(${JSON.stringify(records)}::jsonb)
                as r(ordinal int, text text, location jsonb, embedding text)`,
        );
      }),

    readVectors: (indexId, documentId) =>
      read(async (tx) => {
        const vectors = await rows<{ embedding: string | null }>(
          tx,
          sql`select c.embedding::text as embedding
              from chunks c join documents d on d.id = c.document_id join indexes i on i.id = d.index_id
              where i.connection_id = ${requestConnectionId()} and i.kind = ${kind} and i.external_id = ${indexId}
                and d.dalux_id = ${documentId}
              order by c.ordinal`,
        );
        if (!vectors.length || vectors.some((row) => row.embedding === null)) return null;
        return vectors.map((row) => Float32Array.from(JSON.parse(row.embedding!) as number[]));
      }),

    deleteDocument: (indexId, documentId) =>
      pools.worker
        .execute(
          sql`delete from documents d using indexes i
              where i.id = d.index_id and i.connection_id = ${requestConnectionId()} and i.kind = ${kind}
                and i.external_id = ${indexId} and d.dalux_id = ${documentId}`,
        )
        .then(() => undefined),

    dropIndex: async (indexId) => {
      const result = await pools.worker.execute(
        sql`delete from indexes where connection_id = ${requestConnectionId()} and kind = ${kind} and external_id = ${indexId}`,
      );
      return (result.rowCount ?? 0) > 0;
    },

    listIndexes: () =>
      read(async (tx) => {
        const indexes = await rows<IndexRow & { documents: number; chunks: number; size_bytes: number }>(
          tx,
          sql`select i.id, i.external_id, i.scope, i.embedding_model, i.embedding_dimensions,
                     to_json(i.created_at) as created_at, to_json(i.updated_at) as updated_at,
                     count(d.id)::int as documents,
                     coalesce(sum((d.metadata->'entry'->>'chunkCount')::int), 0)::int as chunks,
                     coalesce(sum((d.metadata->>'sizeBytes')::bigint), 0)::float8 as size_bytes
              from indexes i
              left join documents d on d.index_id = i.id and d.metadata ? 'entry'
              where i.connection_id = ${requestConnectionId()} and i.kind = ${kind}
              group by i.id
              order by i.updated_at desc`,
        );
        return indexes.map((row) =>
          mapping.summary(manifestBase(row), {
            documentCount: row.documents,
            chunkCount: row.chunks,
            sizeBytes: row.size_bytes,
          }),
        );
      }),

    search: (indexId, request) =>
      read(async (tx) => {
        const index = await findIndex(tx, indexId);
        if (!index) return { missingVectors: false, matches: [] };
        // Only documents the manifest lists, as in the file store.
        const documentFilter = request.documentIds
          ? sql`and d.metadata ? 'entry' and d.dalux_id = any(${textArray(request.documentIds)}::text[])`
          : sql`and d.metadata ? 'entry'`;

        let missingVectors = false;
        if (request.embedQuery) {
          const [missing] = await rows<{ missing: boolean }>(
            tx,
            sql`select exists (
                  select 1 from documents d
                  where d.index_id = ${index.id} and d.metadata->>'embedded' = 'false' ${documentFilter}
                ) as missing`,
          );
          missingVectors = missing.missing;
        }

        let hits: Hit[];
        if (request.embedQuery && !missingVectors) {
          const vector = toVector(await request.embedQuery());
          await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
          hits = await semantic(tx, index.id, request, documentFilter, vector, false);
          // Row-level security and the filters drop rows after the HNSW scan;
          // when that leaves the answer short, rank the visible rows exactly.
          if (hits.length < request.topK) hits = await semantic(tx, index.id, request, documentFilter, vector, true);
        } else {
          hits = await lexical(tx, index.id, request, documentFilter);
        }

        return {
          missingVectors,
          matches: hits.map((hit) => ({
            documentId: hit.dalux_id,
            chunk: { ...hit.location, text: hit.text } as never,
            score: Number(hit.score),
          })),
        };
      }) as Promise<ChunkSearchResult<never>>,
  };
}

interface Hit {
  dalux_id: string;
  text: string;
  location: object;
  score: number;
}

/**
 * Maps ts_rank_cd (0.1 per matching term occurrence, divided by 1 + log of the
 * chunk length) through `raw / (raw + saturation)`: an absolute scale like the
 * BM25 mapping in search/rank.ts, never "top hit = 1.0". One mention in a short
 * chunk scores ~0.2, three query terms ~0.45.
 */
const LEXICAL_SATURATION = 0.2;

/** Stores for searches (the caller's view, through row-level security) and for index builds (the worker's view). */
export function postgresIndexStores(pools: { mcp: Db; worker: Db }): { search: IndexStores; build: IndexStores } {
  const stores = (view: 'caller' | 'worker'): IndexStores => ({
    fileAreas: createStore(fileMapping, pools, view),
    tasks: createStore(taskMapping, pools, view),
    docs: createStore(docsMapping, pools, view),
  });
  return { search: stores('caller'), build: stores('worker') };
}
