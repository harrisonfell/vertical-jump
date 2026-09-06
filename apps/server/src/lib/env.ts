/**
 * Environment, read once and validated.
 *
 * Nothing here is read at module load, because `next build` must succeed on a
 * machine with no secrets: every route handler calls `env()` at request time
 * instead. A missing variable is a startup error with the variable named, not
 * an undefined threaded through three call sites.
 */

import { z } from 'zod';

/** At least 32 bytes of real entropy once decoded, not 32 typed characters. */
function decodedBytes(value: string): number {
  const base64 = Buffer.from(value, 'base64');
  if (base64.length > 0 && base64.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')) {
    return base64.length;
  }
  const hex = /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0 ? value.length / 2 : 0;
  return Math.max(hex, 0);
}

/** Exactly 32 bytes, base64. Anything else is a startup error, not a 500 later. */
const encryptionKey = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: 'must be exactly 32 bytes, base64 encoded',
  });

/** Optional, and an empty value in the dashboard counts as unset. */
const optional = () =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value));

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /**
   * The Whoop app, once it exists. Sign-in, pairing and the database sync do
   * not need it, so the three are optional here and `whoopEnv()` is what the
   * Whoop paths read: a missing value answers "not set up" on those paths
   * rather than refusing every path on the server.
   */
  WHOOP_CLIENT_ID: optional(),
  WHOOP_CLIENT_SECRET: optional(),
  WHOOP_REDIRECT_URI: optional(),
  APP_PASSPHRASE_HASH: z.string().min(1),
  /**
   * At least 32 bytes of entropy. `min(32)` on the string would accept a
   * 32 character passphrase as an HMAC key for both the session cookie and the
   * Whoop OAuth state, so the decoded length is what is checked.
   */
  SESSION_SECRET: z
    .string()
    .refine((value) => decodedBytes(value) >= 32, {
      message: 'must be at least 32 bytes of entropy, base64 or hex encoded',
    }),
  PUBLIC_BASE_URL: z.string().min(1),
  WHOOP_FIXTURE: z
    .enum(['0', '1'])
    .default('0')
    .transform((value) => value === '1'),
  /** 32 bytes, base64. AES-256-GCM for the stored Whoop tokens. */
  TOKEN_ENCRYPTION_KEY: encryptionKey,
  /** The key before the last rotation. Decrypt only, and optional. */
  TOKEN_ENCRYPTION_KEY_PREVIOUS: encryptionKey.optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached !== null) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Server environment is incomplete: ${missing}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Tests and the fixture path set their own values, then clear the cache. */
export function resetEnvCache(): void {
  cached = null;
}

export interface WhoopEnv {
  readonly WHOOP_CLIENT_ID: string;
  readonly WHOOP_CLIENT_SECRET: string;
  readonly WHOOP_REDIRECT_URI: string;
}

/** Thrown by a Whoop path on a server whose Whoop app is not set up yet. */
export class WhoopNotConfiguredError extends Error {
  constructor() {
    super('Whoop is not set up on this server yet. See .env.example.');
    this.name = 'WhoopNotConfiguredError';
  }
}

/** True once all three Whoop values are set. */
export function whoopConfigured(): boolean {
  const config = env();
  return (
    config.WHOOP_CLIENT_ID !== undefined &&
    config.WHOOP_CLIENT_SECRET !== undefined &&
    config.WHOOP_REDIRECT_URI !== undefined
  );
}

/** The three Whoop values, or a `WhoopNotConfiguredError` when any is missing. */
export function whoopEnv(): WhoopEnv {
  const config = env();
  if (
    config.WHOOP_CLIENT_ID === undefined ||
    config.WHOOP_CLIENT_SECRET === undefined ||
    config.WHOOP_REDIRECT_URI === undefined
  ) {
    throw new WhoopNotConfiguredError();
  }
  return {
    WHOOP_CLIENT_ID: config.WHOOP_CLIENT_ID,
    WHOOP_CLIENT_SECRET: config.WHOOP_CLIENT_SECRET,
    WHOOP_REDIRECT_URI: config.WHOOP_REDIRECT_URI,
  };
}

/** True when Whoop calls replay fixtures/whoop/*.json instead of the network. */
export function isFixtureMode(): boolean {
  return process.env['WHOOP_FIXTURE'] === '1';
}
