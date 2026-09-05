// Exports the static web bundle from apps/mobile into apps/mobile/dist.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const result = spawnSync('npx', ['expo', 'export', '--platform', 'web'], {
  stdio: 'inherit',
  cwd: join(root, 'apps', 'mobile'),
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
