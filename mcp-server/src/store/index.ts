import { createDb } from '@dalux-platform/db';
import { currentContext } from '../access/requestScope';
import { docsFileStore } from './file/docsStore';
import { fileAreaFileStore } from './file/fileAreaStore';
import { taskFileStore } from './file/taskStore';
import { postgresIndexStores } from './postgres';
import type { IndexStores } from './types';

const fileStores: IndexStores = { fileAreas: fileAreaFileStore, tasks: taskFileStore, docs: docsFileStore };
let searchStores = fileStores;
let buildStores = fileStores;
let accountStores: { search: IndexStores; build: IndexStores } | undefined;

/**
 * In platform mode, callers with an account use the Postgres stores; callers
 * without one (header mode) keep temporary file indexes, kept apart per
 * credentials by the context's file namespace (see cachePaths).
 */
function forCaller(): { search: IndexStores; build: IndexStores } {
  return accountStores && currentContext().account ? accountStores : { search: searchStores, build: buildStores };
}

/** The index stores searches, listings and index tools read and write through. */
export function indexStores(): IndexStores {
  return forCaller().search;
}

/** The index stores builders read and write through; they see every document of an index. */
export function buildIndexStores(): IndexStores {
  return forCaller().build;
}

/** Platform mode: the stores for callers with an account. */
export function setAccountIndexStores(search: IndexStores, build: IndexStores): void {
  accountStores = { search, build };
}

/** Replace the file stores, e.g. with the platform's Postgres store. */
export function setIndexStores(search: IndexStores, build: IndexStores = search): void {
  searchStores = search;
  buildStores = build;
}

/**
 * Platform mode (DATABASE_URL set): Postgres stores for callers with an account,
 * reading as the `mcp` role and writing as the `worker` role (DATABASE_URL_WORKER).
 * Otherwise the file stores.
 */
export function initIndexStores(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.DATABASE_URL) return;
  if (!env.DATABASE_URL_WORKER) throw new Error('DATABASE_URL_WORKER is required when DATABASE_URL is set.');
  const { search, build } = postgresIndexStores({ mcp: createDb(env.DATABASE_URL), worker: createDb(env.DATABASE_URL_WORKER) });
  setAccountIndexStores(search, build);
}
