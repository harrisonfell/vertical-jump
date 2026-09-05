/**
 * The migrations, applied the way a deploy applies them.
 *
 * The suite used to read `drizzle/0000_init.sql` and exec its statements, which
 * proved the SQL parses and nothing else: it could not see a second migration,
 * and it never exercised the journal that decides what has already run. This
 * uses drizzle's own migrator, so a test database and a real one are brought up
 * the same way and `npm run db:migrate` is the path under test.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';

const here = dirname(fileURLToPath(import.meta.url));

/** The folder holding the SQL and the journal drizzle-kit maintains. */
export const MIGRATIONS_FOLDER = join(here, '..', '..', 'drizzle');

/** Applies whatever this database has not run. Running it twice is a no-op. */
export async function applyMigrations(db: PgliteDatabase<Record<string, unknown>>): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
