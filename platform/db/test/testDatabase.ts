import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createDb, type Db } from '../src/db';
import { DB_ROLES, runMigrations, type DbRole } from '../src/migrate';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://migrator:migrator@localhost:54329/platform_test';
const ROLE_PASSWORD = 'test-password';

export interface TestDatabase {
  url: (role: DbRole | 'migrator') => string;
  owner: Pool;
  as: (role: DbRole) => Db;
  drop: () => Promise<void>;
}

/** Pool.end() does not wait for backends to exit, and WITH (FORCE) would make them error. */
async function dropWhenIdle(admin: Pool, name: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.query(`DROP DATABASE ${name}`);
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '55006' || attempt === 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** Creates an empty database, migrates it, and opens pools per role. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `test_${randomUUID().replace(/-/g, '')}`;
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);

  const url = (role: DbRole | 'migrator') => {
    const parsed = new URL(ADMIN_URL);
    parsed.pathname = `/${name}`;
    if (role !== 'migrator') {
      parsed.username = role;
      parsed.password = ROLE_PASSWORD;
    }
    return parsed.toString();
  };

  await runMigrations(url('migrator'), Object.fromEntries(DB_ROLES.map((role) => [role, ROLE_PASSWORD])));

  const owner = new Pool({ connectionString: url('migrator') });
  const dbs = new Map<DbRole, Db>();
  const as = (role: DbRole) => {
    if (!dbs.has(role)) dbs.set(role, createDb(url(role)));
    return dbs.get(role)!;
  };

  return {
    url,
    owner,
    as,
    drop: async () => {
      await Promise.all([owner.end(), ...[...dbs.values()].map((db) => db.$client.end())]);
      await dropWhenIdle(admin, name);
      await admin.end();
    },
  };
}
