import { createDb, type Db } from '@dalux-platform/db';

const globalForDb = globalThis as unknown as { platformDb?: Db };

/** One pool per server process, connected as the `web` database role. */
export function db(): Db {
  globalForDb.platformDb ??= createDb(process.env.DATABASE_URL ?? '');
  return globalForDb.platformDb;
}
