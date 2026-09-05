// Type-checks every workspace project in sequence. Works under PowerShell and bash.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const projects = ['packages/engine', 'apps/mobile', 'apps/server'];
const tsc = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

let failed = false;
for (const project of projects) {
  process.stdout.write(`typecheck ${project}\n`);
  const result = spawnSync(tsc, ['-p', join(root, project, 'tsconfig.json')], {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
