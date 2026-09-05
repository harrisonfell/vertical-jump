/**
 * Exports the Expo web bundle into this project's `public/app`.
 *
 * One Vercel project serves both halves of Vert: the route handlers under
 * `/api` and the web app on every other path. That is not a preference, it is
 * what makes the credentials work. The browser's session cookie is set on this
 * origin and is only sent back to this origin, and the paired phone's Bearer
 * goes to the same host it was paired against, so a second domain for the web
 * build would mean a third-party cookie and a second CORS surface for no gain.
 *
 * `EXPO_PUBLIC_SERVER_URL` is therefore exported as "/", which the app's
 * transport reads as this origin: it strips to an empty base, so every request
 * goes out as a relative path. It cannot be exported as the empty string,
 * because Metro inlines an empty EXPO_PUBLIC_ value as undefined, and undefined
 * already means "no server at all" to a native build. The phone's EAS build is
 * the one that carries an absolute origin.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(serverDir));
const mobileDir = join(repoRoot, 'apps', 'mobile');

/** Served at `/app/...`, which is where next.config.mjs rewrites every route. */
export const WEB_OUTPUT_DIR = join(serverDir, 'public', 'app');

/** The routes the rewrites depend on. A missing one is a broken deploy, loudly. */
const REQUIRED = [
  'index.html',
  'plan.html',
  'progress.html',
  'clearance.html',
  'pair.html',
  'login.html',
  'privacy.html',
  '+not-found.html',
  'setup/gate.html',
  'setup/one.html',
  'setup/two.html',
  'setup/three.html',
  'setup/build.html',
  'session/[id].html',
  'settings/index.html',
  'settings/whoop.html',
  'settings/import.html',
];

export function buildWeb() {
  // Expo writes into the directory as it goes; a stale export from a previous
  // build would otherwise leave routes behind that no longer exist.
  rmSync(WEB_OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(dirname(WEB_OUTPUT_DIR), { recursive: true });

  const relativeOut = resolve(WEB_OUTPUT_DIR);
  const result = spawnSync(
    'npx',
    ['expo', 'export', '--platform', 'web', '--output-dir', relativeOut],
    {
      cwd: mobileDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        // Same origin. See the note at the top of this file.
        EXPO_PUBLIC_SERVER_URL: '/',
        // The deployed app reads the athlete's own database, never a fixture.
        EXPO_PUBLIC_FIXTURE: '',
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(`expo export failed with status ${result.status ?? 'unknown'}.`);
  }

  const missing = REQUIRED.filter((route) => !existsSync(join(WEB_OUTPUT_DIR, route)));
  if (missing.length > 0) {
    throw new Error(
      `The web export is missing ${missing.length} route(s) the rewrites need: ${missing.join(', ')}.`,
    );
  }
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  try {
    buildWeb();
    process.stdout.write(`Exported the web app into ${WEB_OUTPUT_DIR}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
