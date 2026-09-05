/**
 * The whole logger.
 *
 * One line of JSON per event on stdout, which is what Vercel's log drain
 * wants, and never a raw `console.log` in a handler. Secrets never reach it:
 * pass ids and counts, not tokens or passphrases.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

type Field = string | number | boolean | null | undefined;

export interface LogFields {
  readonly [key: string]: Field;
}

/** Keys whose values are replaced with "[redacted]" whatever they hold. */
const SECRET_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'accessToken',
  'refreshToken',
  'secret',
  'deviceSecret',
  'passphrase',
  'signature',
  'code',
]);

function redact(fields: LogFields): Record<string, Field> {
  const out: Record<string, Field> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SECRET_KEYS.has(key) ? '[redacted]' : value;
  }
  return out;
}

function write(level: Level, event: string, fields: LogFields): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...redact(fields) });
  process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (event: string, fields: LogFields = {}): void => write('debug', event, fields),
  info: (event: string, fields: LogFields = {}): void => write('info', event, fields),
  warn: (event: string, fields: LogFields = {}): void => write('warn', event, fields),
  error: (event: string, fields: LogFields = {}): void => write('error', event, fields),
};

/** Turns an unknown catch value into something safe to log. */
export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === 'string' ? cause : 'unknown error';
}
