/**
 * Applies every migration in drizzle/ that this database has not run.
 *
 * The deploy path used to be `drizzle-kit push` by hand and nothing else: one
 * migration file with 26 bare CREATE TABLEs, no journal applied at runtime, so
 * a second deploy against a live database was a guess. drizzle's own migrator
 * keeps a `__drizzle_migrations` table and decides what has run, which makes
 * running this twice a no-op and makes adding a migration a normal thing to do.
 *
 * Run it as `npm run db:migrate -w @vert/server` with DATABASE_URL set.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;

if (url === undefined || url === '') {
  process.stderr.write('DATABASE_URL is not set. See .env.example.\n');
  process.exit(1);
}

// One connection, no prepared statements: a pooled Neon endpoint refuses them.
const sql = postgres(url, { max: 1, prepare: false });
try {
  await migrate(drizzle(sql), { migrationsFolder: join(here, '..', 'drizzle') });
  process.stdout.write('migrations applied\n');
} finally {
  await sql.end();
}
