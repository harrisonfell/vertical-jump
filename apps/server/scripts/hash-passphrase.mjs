/**
 * Prints the APP_PASSPHRASE_HASH for a passphrase, for the Vercel dashboard.
 *
 * Run it in a terminal of your own, not in a shared transcript, because the
 * passphrase is typed in the clear:
 *
 *   node apps/server/scripts/hash-passphrase.mjs
 *
 * It asks for the passphrase, prints the scrypt hash in the format the server
 * checks against, and never writes either anywhere. The hash is safe to paste
 * into Vercel as APP_PASSPHRASE_HASH; the passphrase is what you sign in with
 * at /login.
 */

import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const N = 16384;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;

function hash(value) {
  const salt = randomBytes(16);
  const derived = scryptSync(value, salt, KEY_LENGTH, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Passphrase: ', (answer) => {
  rl.close();
  const value = answer.trim();
  if (value.length < 8) {
    process.stderr.write('Use at least 8 characters.\n');
    process.exit(1);
  }
  process.stdout.write(`\nAPP_PASSPHRASE_HASH=${hash(value)}\n`);
});
