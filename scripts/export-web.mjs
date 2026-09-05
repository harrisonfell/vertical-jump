// Exports the static web bundle from apps/mobile into apps/mobile/dist.
//
// This is the standalone export, for a look at the built web app on its own.
// The deploy uses apps/server/scripts/build-web.mjs instead, which exports into
// apps/server/public/app with EXPO_PUBLIC_SERVER_URL empty so the bundle talks
// to the origin that serves it.
//
// Extra arguments pass straight through, so `npm run export:web -- --output-dir
// dist-check` works.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const passthrough = process.argv.slice(2);
const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', ...passthrough], {
  stdio: 'inherit',
  cwd: join(root, 'apps', 'mobile'),
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
