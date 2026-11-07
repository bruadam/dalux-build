/**
 * Postgres index store against a real database (platform/compose.test.yaml or
 * any pgvector server in TEST_DATABASE_URL). Skipped when TEST_DATABASE_URL is unset.
 */

import { Client } from 'pg';
import { createDb } from '@dalux-platform/db';
import { runWithContext } from '../src/access/requestScope';
import type { RequestContext } from '../src/access/context';
import { postgresIndexStores } from '../src/store/postgres';
import { setIndexStores } from '../src/store';
import { searchIndex } from '../src/rag/search';
import { searchTaskIndex } from '../src/rag/taskSearch';
import { searchDocsIndex } from '../src/rag/docsSearch';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../src/search/rank';
import type { IndexManifest, IndexStores, IndexedDocument, TaskIndexManifest, DocsIndexManifest } from '../src/store/types';
import { createTestDatabase, type TestDatabase } from '../../platform/db/test/testDatabase';

const embeddings = new Map<string, number[]>();
jest.mock('@mistralai/mistralai', () => ({
  Mistral: jest.fn().mockImplementation(() => ({
    embeddings: {
      create: async ({ inputs }: { inputs: string[] }) => ({
        data: inputs.map((input, index) => ({ index, embedding: embeddings.get(input) ?? axis(0) })),
      }),
    },
  })),
}));

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;
jest.setTimeout(120_000);

/** A unit vector along `dimension`, nudged toward `toward` so neighbours are ordered. */
function axis(dimension: number, toward?: number, weight = 0): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[dimension] = 1;
  if (toward !== undefined) vector[toward] = weight;
  return vector;
}

let t: TestDatabase;
let search: IndexStores;
let build: IndexStores;
const ids: Record<string, string> = {};

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await t.owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(row),
  );
  return rows[0].id;
}

function as<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const context: RequestContext = {
    account: { id: ids[account], role: account === 'admin' ? 'admin' : 'user' },
    connection: { id: ids.conn },
    access: [],
  };
  return runWithContext(context, fn);
}

const scope = {
  projectId: 'P1',
  fileAreaId: 'FA1',
  folderId: null,
  folderPath: null,
  recursive: true,
  extensions: ['pdf'],
  includeDrawings: false,
};

function fileDocument(fileId: string, folders: string[], texts: string[]): IndexedDocument {
  return {
    fileId,
    fileName: `${fileId}.pdf`,
    format: 'pdf',
    chunks: texts.map((text, i) => ({ page: i + 1, location: `p. ${i + 1}`, text })),
    access: {
      projectId: 'P1',
      fileAreaId: 'FA1',
      folderId: folders[folders.length - 1],
      folderAncestorIds: folders.slice(0, -1),
    },
  };
}

function manifestFor(indexId: string, documents: IndexedDocument[], embedding = true): IndexManifest {
  return {
    indexId,
    scope,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    embedding: embedding ? { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS } : null,
    files: Object.fromEntries(
      documents.map((document) => [
        document.fileId,
        {
          fileName: document.fileName,
          revisionKey: `rev-${document.fileId}`,
          format: 'pdf',
          chunkCount: document.chunks.length,
          indexedAt: '2026-11-02T09:00:00.000Z',
        },
      ]),
    ),
    skipped: [{ reason: 'not a supported format', count: 1, examples: ['secret-budget.xlsb'] }],
    failed: [{ fileId: 'X', fileName: 'locked.pdf', revisionKey: 'r', error: 'password protected' }],
  };
}

async function writeIndex(indexId: string, documents: IndexedDocument[], vectors: (number[][] | null)[]) {
  await as('admin', async () => {
    for (const [i, document] of documents.entries()) await build.fileAreas.writeDocument(indexId, document, vectors[i]);
    await build.fileAreas.writeManifest(manifestFor(indexId, documents, vectors.some(Boolean)));
  });
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) return;
  t = await createTestDatabase();
  ({ search, build } = postgresIndexStores({ mcp: t.as('mcp'), worker: t.as('worker') }));
  setIndexStores(search, build);

  ids.conn = await insert('connections', {
    name: 'Acme',
    slug: 'acme',
    base_url: 'https://acme.dalux.com',
    api_key_encrypted: 'v1.x.y',
    api_key_last4: '1234',
  });
  for (const name of ['admin', 'alice', 'bob', 'dave']) {
    ids[name] = await insert('accounts', { type: 'personal', email: `${name}@example.com`, name, status: 'active' });
  }
  const grant = (account: string, scopeColumns: Record<string, string>, capabilities: string[]) =>
    insert('grants', { account_id: ids[account], connection_id: ids.conn, ...scopeColumns, capabilities });
  await grant('alice', { project_id: 'P1' }, ['files:read', 'tasks:read']);
  await grant('bob', { project_id: 'P1', file_area_id: 'FA1', folder_id: 'F2' }, ['files:read']);
  await t.owner.query('SELECT refresh_effective_access()');
});

afterAll(async () => {
  await t?.drop();
});

describeDb('Postgres index store', () => {
  const documents = [
    fileDocument('root', ['F1'], ['Concrete class C30/37 for all foundations', 'Fire doors EI60 in stairwells']),
    fileDocument('sub', ['F1', 'F2'], ['Roof membrane with insulation', 'Concrete cover 35 mm for exposed walls']),
  ];
  const vectors = [
    [axis(0), axis(1)],
    [axis(2), axis(3)],
  ];

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) return;
    await writeIndex('idx-small', documents, vectors);
  });

  it('round-trips manifests, documents and vectors', async () => {
    const full = manifestFor('idx-small', documents);
    await as('admin', async () => expect(await build.fileAreas.readManifest('idx-small')).toEqual(full));
    await as('alice', async () => {
      expect(await search.fileAreas.readManifest('idx-small')).toEqual({ ...full, skipped: [], failed: [] });
      expect(await search.fileAreas.readDocument('idx-small', 'sub')).toEqual(documents[1]);
      const read = await search.fileAreas.readVectors('idx-small', 'sub', EMBEDDING_DIMENSIONS);
      expect(read?.map((vector) => Array.from(vector))).toEqual(vectors[1]);
      expect(await search.fileAreas.listIndexes()).toEqual([
        expect.objectContaining({ indexId: 'idx-small', fileCount: 2, chunkCount: 4, mode: 'embeddings', scope }),
      ]);
    });
  });

  it('rewriting a document replaces its chunks and keeps its manifest entry', async () => {
    const rewritten = fileDocument('extra', ['F1'], ['one', 'two', 'three']);
    await writeIndex('idx-rewrite', [rewritten], [null]);
    await as('admin', () => build.fileAreas.writeDocument('idx-rewrite', { ...rewritten, chunks: rewritten.chunks.slice(0, 1) }, null));
    await as('alice', async () => {
      expect((await search.fileAreas.readDocument('idx-rewrite', 'extra'))?.chunks).toHaveLength(1);
      expect(Object.keys((await search.fileAreas.readManifest('idx-rewrite'))!.files)).toEqual(['extra']);
      expect(await search.fileAreas.readVectors('idx-rewrite', 'extra', EMBEDDING_DIMENSIONS)).toBeNull();
    });
    await as('admin', async () => {
      await build.fileAreas.deleteDocument('idx-rewrite', 'extra');
      expect(await build.fileAreas.readDocument('idx-rewrite', 'extra')).toBeNull();
      expect(await build.fileAreas.dropIndex('idx-rewrite')).toBe(true);
      expect(await build.fileAreas.dropIndex('idx-rewrite')).toBe(false);
      expect(await build.fileAreas.readManifest('idx-rewrite')).toBeNull();
    });
  });

  it('ranks semantically in Postgres with the same result shape as the file store', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    embeddings.set('membrane', axis(2, 3, 0.5));
    try {
      const result = await as('alice', () => searchIndex('idx-small', 'membrane', { topK: 2 }));
      expect(result).toMatchObject({ mode: 'embeddings', filesSearched: 2, chunksSearched: 4, warnings: [] });
      expect(result.matches.map((match) => match.text)).toEqual([
        'Roof membrane with insulation',
        'Concrete cover 35 mm for exposed walls',
      ]);
      expect(result.matches[0]).toEqual({
        page: 1,
        location: 'p. 1',
        text: 'Roof membrane with insulation',
        fileId: 'sub',
        fileName: 'sub.pdf',
        score: expect.closeTo(1 / Math.sqrt(1.25), 5),
      });
    } finally {
      delete process.env.MISTRAL_API_KEY;
    }
  });

  it('ranks lexically with full-text search on an absolute scale', async () => {
    const result = await as('alice', () => searchIndex('idx-small', 'concrete C30/37', { topK: 5 }));
    expect(result.mode).toBe('lexical');
    expect(result.matches.map((match) => match.fileId)).toEqual(['root', 'sub']);
    const [strong, weak] = result.matches.map((match) => match.score);
    expect(strong).toBeLessThan(1);
    expect(weak).toBeGreaterThan(0);
    expect(weak).toBeLessThan(strong);

    const nothing = await as('alice', () => searchIndex('idx-small', 'asbestos', { topK: 5 }));
    expect(nothing.matches).toEqual([]);
  });

  it('applies the file filters and the per-file limit', async () => {
    const byName = await as('alice', () => searchIndex('idx-small', 'concrete', { fileNameContains: 'SUB' }));
    expect(byName.matches.map((match) => match.fileId)).toEqual(['sub']);
    expect(byName.filesSearched).toBe(1);
    const limited = await as('alice', () => searchIndex('idx-small', 'concrete', { perFileLimit: 1, topK: 5 }));
    expect(limited.matches).toHaveLength(2);
  });

  it('a folder-restricted account only sees documents and counts of its folder (row-level security)', async () => {
    await as('bob', async () => {
      const manifest = await search.fileAreas.readManifest('idx-small');
      expect(Object.keys(manifest!.files)).toEqual(['sub']);
      expect(await search.fileAreas.readDocument('idx-small', 'root')).toBeNull();
      expect(await search.fileAreas.listIndexes()).toEqual([
        expect.objectContaining({ indexId: 'idx-small', fileCount: 1, chunkCount: 2 }),
      ]);
      const result = await searchIndex('idx-small', 'concrete', { topK: 5 });
      expect(result.matches.map((match) => match.fileId)).toEqual(['sub']);
      expect(result.chunksSearched).toBe(2);
    });
    await as('dave', async () => {
      expect(await search.fileAreas.readManifest('idx-small')).toBeNull();
      expect(await search.fileAreas.listIndexes()).toEqual([]);
    });
  });

  it('falls back to lexical ranking while the embedding model differs or vectors are missing', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    try {
      await as('admin', () =>
        build.fileAreas.writeManifest({ ...manifestFor('idx-small', documents), embedding: { model: 'old-model', dimensions: EMBEDDING_DIMENSIONS } }),
      );
      const changed = await as('alice', () => searchIndex('idx-small', 'concrete'));
      expect(changed.mode).toBe('lexical');
      expect(changed.warnings).toContain('Embedding model changed — ranking lexically until the index is rebuilt.');

      await writeIndex('idx-partial', documents, [vectors[0], null]);
      const partial = await as('alice', () => searchIndex('idx-partial', 'concrete'));
      expect(partial.mode).toBe('lexical');
      expect(partial.warnings.join(' ')).toMatch(/Some documents have no embeddings/);
    } finally {
      delete process.env.MISTRAL_API_KEY;
      await as('admin', () => build.fileAreas.writeManifest(manifestFor('idx-small', documents)));
    }
  });

  describe('when row-level security hides most rows', () => {
    const DOCUMENTS = 100;
    const CHUNKS = 20;
    const visible = new Set([37]);

    beforeAll(async () => {
      if (!process.env.TEST_DATABASE_URL) return;
      const many: IndexedDocument[] = [];
      const manyVectors: number[][][] = [];
      for (let d = 0; d < DOCUMENTS; d++) {
        const folders = visible.has(d) ? ['F1', 'F2'] : ['F1', `G${d}`];
        many.push(fileDocument(`doc-${d}`, folders, Array.from({ length: CHUNKS }, (_, c) => `chunk ${d}-${c}`)));
        // Every chunk points near axis 5; hidden ones are the closest, so an
        // approximate scan meets them first.
        manyVectors.push(Array.from({ length: CHUNKS }, (_, c) => axis(5, 10 + c, visible.has(d) ? 2 : 0.1 + c / 1000)));
      }
      await writeIndex('idx-large', many, manyVectors);
    });

    /** What the HNSW scan alone returns to bob (before the store's exact fallback). */
    async function approximateMatchesForBob(): Promise<number> {
      const client = new Client({ connectionString: t.url('mcp') });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.account_id', $1, true)`, [ids.bob]);
        await client.query('SET LOCAL hnsw.iterative_scan = relaxed_order');
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM (SELECT id FROM chunks ORDER BY embedding <=> $1::vector LIMIT 40) s`,
          [JSON.stringify(axis(5))],
        );
        return rows[0].n;
      } finally {
        await client.end();
      }
    }

    const query = () =>
      as('bob', () =>
        search.fileAreas.search!('idx-large', {
          query: 'chunk',
          embedQuery: async () => axis(5),
          topK: 8,
          perDocumentLimit: null,
        }),
      );

    it('returns topK of the visible rows (bob sees 1% of the chunks)', async () => {
      const result = await query();
      expect(result.matches).toHaveLength(8);
      expect(result.matches.every((match) => visible.has(Number(match.documentId.split('-')[1])))).toBe(true);
    });

    it('falls back to exact search when the approximate scan comes back short', async () => {
      const { rows } = await t.owner.query('SELECT current_database() AS name');
      await t.owner.query(`ALTER DATABASE ${rows[0].name} SET hnsw.max_scan_tuples = 50`);
      // Database settings apply to new sessions only.
      const mcp = createDb(t.url('mcp'));
      try {
        expect(await approximateMatchesForBob()).toBeLessThan(8);
        const stores = postgresIndexStores({ mcp, worker: t.as('worker') }).search;
        const result = await as('bob', () =>
          stores.fileAreas.search!('idx-large', {
            query: 'chunk',
            embedQuery: async () => axis(5),
            topK: 8,
            perDocumentLimit: null,
          }),
        );
        expect(result.matches).toHaveLength(8);
      } finally {
        await mcp.$client.end();
        await t.owner.query(`ALTER DATABASE ${rows[0].name} RESET hnsw.max_scan_tuples`);
      }
    });
  });

  it('serves task and docs indexes through the same tables', async () => {
    const taskManifest: TaskIndexManifest = {
      indexId: 'tasks-1',
      scope: { projectId: 'P1', typeId: null, filter: null },
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      embedding: null,
      tasks: {
        T1: { subject: 'Leak', number: '12', usage: 'Defect', revisionKey: 'r1', chunkCount: 1, changeCount: 0, attachmentCount: 0, indexedAt: '2026-11-01T10:00:00.000Z' },
      },
    };
    const docsManifest: DocsIndexManifest = {
      indexId: 'docs-1',
      scope: { owner: 'acme', repo: 'docs', ref: 'main', path: 'docs' },
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      embedding: null,
      docs: {
        'docs/laws/fire.md': { path: 'docs/laws/fire.md', revisionKey: 'b1', format: 'markdown', chunkCount: 1, indexedAt: '2026-11-01T10:00:00.000Z' },
      },
      failed: [],
    };
    await as('admin', async () => {
      await build.tasks.writeDocument('tasks-1', { taskId: 'T1', chunks: [{ location: 'description', text: 'Water leak at roof drain' }], access: { projectId: 'P1' } }, null);
      await build.tasks.writeManifest(taskManifest);
      await build.docs.writeDocument('docs-1', { path: 'docs/laws/fire.md', chunks: [{ page: null, location: '§ 1', text: 'Fire doors shall close automatically' }] }, null);
      await build.docs.writeManifest(docsManifest);
    });

    const tasks = await as('alice', () => searchTaskIndex('tasks-1', 'leak'));
    expect(tasks.matches).toEqual([
      { taskId: 'T1', subject: 'Leak', number: '12', usage: 'Defect', location: 'description', text: 'Water leak at roof drain', score: expect.any(Number) },
    ]);
    expect((await as('bob', () => searchTaskIndex('tasks-1', 'leak').catch((error: Error) => error.message)))).toMatch(/No task index/);

    const docs = await as('dave', () => searchDocsIndex('docs-1', 'fire doors'));
    expect(docs.matches).toEqual([
      { page: null, location: '§ 1', text: 'Fire doors shall close automatically', path: 'docs/laws/fire.md', score: expect.any(Number) },
    ]);
    expect(docs.docsSearched).toBe(1);
  });

  it('lexical scores are absolute: a single-word hit stays low, a multi-word hit scores higher', async () => {
    const weak = await as('alice', () => searchIndex('idx-small', 'fire', { topK: 1 }));
    const strong = await as('alice', () => searchIndex('idx-small', 'fire doors stairwells', { topK: 1 }));
    expect(weak.matches[0].score).toBeLessThan(0.3);
    expect(strong.matches[0].score).toBeGreaterThan(0.4);
    expect(strong.matches[0].score).toBeLessThan(0.9);
  });
});
