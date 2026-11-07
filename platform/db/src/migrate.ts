import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { escapeLiteral, Pool } from 'pg';

export const MIGRATIONS_FOLDER = path.join(__dirname, '..', 'drizzle');

export const DB_ROLES = ['web', 'mcp', 'worker'] as const;
export type DbRole = (typeof DB_ROLES)[number];

export const ROLE_PASSWORD_ENV: Record<DbRole, string> = {
  web: 'PLATFORM_DB_WEB_PASSWORD',
  mcp: 'PLATFORM_DB_MCP_PASSWORD',
  worker: 'PLATFORM_DB_WORKER_PASSWORD',
};

/**
 * Applies pending migrations as the owner (`migrator`) and enables login for
 * each role that has a password. Roles without a password stay NOLOGIN.
 */
export async function runMigrations(
  connectionString: string,
  rolePasswords: Partial<Record<DbRole, string>> = {},
): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    for (const role of DB_ROLES) {
      const password = rolePasswords[role];
      if (password) await pool.query(`ALTER ROLE ${role} LOGIN PASSWORD ${escapeLiteral(password)}`);
    }
  } finally {
    await pool.end();
  }
}
