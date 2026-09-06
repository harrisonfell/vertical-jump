/**
 * The whole deploy in one command: export the web app, then build Next.
 *
 * Order matters. Next copies `public/` into the deployment during `next build`,
 * so the Expo export has to land before it runs, or the rewrites would point at
 * files that are not in the output.
 *
 * This is a node script rather than two chained npm scripts because the same
 * command has to run under PowerShell, Git Bash, and Vercel's Linux builder.
 */

import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWeb } from './build-web.mjs';

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  buildWeb();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

// The database migrations, applied by the deploy that ships the code that
// needs them. Vercel hands the build the same DATABASE_URL the functions get,
// and the migrator records what it ran, so a deploy with nothing new is a
// no-op. A build with no database (a fork, a machine with no secrets) still
// builds; it just does not migrate.
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl !== undefined && databaseUrl !== '') {
  const migrated = spawnSync('node', ['scripts/migrate.mjs'], {
    cwd: serverDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (migrated.status !== 0) {
    process.stderr.write('The database migration failed; the deploy stops here.\n');
    process.exit(migrated.status ?? 1);
  }
} else {
  process.stdout.write('DATABASE_URL is not set: skipping the database migration.\n');
}

const next = spawnSync('npx', ['next', 'build'], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(next.status ?? 1);
