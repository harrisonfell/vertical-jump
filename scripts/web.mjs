// Starts the Expo web dev server inside apps/mobile.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const result = spawnSync('npx', ['expo', 'start', '--web'], {
  stdio: 'inherit',
  cwd: join(root, 'apps', 'mobile'),
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
