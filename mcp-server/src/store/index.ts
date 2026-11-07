import { createDb } from '@dalux-platform/db';
import { docsFileStore } from './file/docsStore';
import { fileAreaFileStore } from './file/fileAreaStore';
import { taskFileStore } from './file/taskStore';
import { postgresIndexStores } from './postgres';
import type { IndexStores } from './types';

const fileStores: IndexStores = { fileAreas: fileAreaFileStore, tasks: taskFileStore, docs: docsFileStore };
let searchStores = fileStores;
let buildStores = fileStores;

/** The index stores searches, listings and index tools read and write through. */
export function indexStores(): IndexStores {
  return searchStores;
}

/** The index stores builders read and write through; they see every document of an index. */
export function buildIndexStores(): IndexStores {
  return buildStores;
}

/** Replace the file stores, e.g. with the platform's Postgres store. */
export function setIndexStores(search: IndexStores, build: IndexStores = search): void {
  searchStores = search;
  buildStores = build;
}

/**
 * Platform mode (DATABASE_URL set): Postgres stores, reading as the `mcp` role
 * and writing as the `worker` role (DATABASE_URL_WORKER). Otherwise the file stores.
 */
export function initIndexStores(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.DATABASE_URL) return;
  if (!env.DATABASE_URL_WORKER) throw new Error('DATABASE_URL_WORKER is required when DATABASE_URL is set.');
  const { search, build } = postgresIndexStores({ mcp: createDb(env.DATABASE_URL), worker: createDb(env.DATABASE_URL_WORKER) });
  setIndexStores(search, build);
}
