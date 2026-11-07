#!/usr/bin/env node
import { DB_ROLES, ROLE_PASSWORD_ENV, runMigrations } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL (the migrator role) is required');
  process.exit(1);
}

const passwords = Object.fromEntries(DB_ROLES.map((role) => [role, process.env[ROLE_PASSWORD_ENV[role]]]));

runMigrations(url, passwords).then(
  () => console.log('migrations applied'),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
