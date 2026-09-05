/**
 * A real Postgres and a fake Whoop, in process, for the Whoop suite.
 *
 * pglite is Postgres compiled to wasm, so every Whoop test runs the migration
 * Neon will run with nothing installed and no DATABASE_URL. The Whoop side is
 * either fixture mode (the recorded JSON in fixtures/whoop) or a fetch stub,
 * because Whoop has no sandbox: the owner's own band is the test environment.
 *
 * This file is deliberately standalone rather than sharing the route harness:
 * these tests drive the library directly and want the environment and the
 * network under their own control.
 */

import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { resetEnvCache } from '../../src/lib/env';
import { applyMigrations } from './migrations';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** The migrations, applied to a fresh in-process Postgres. */
export async function freshDb(): Promise<TestDb> {
  const db = drizzle(new PGlite(), { schema });
  await applyMigrations(db);
  return db;
}

/**
 * pglite's drizzle handle is the same query builder over a different driver;
 * the library is typed against the postgres.js one and never asks which.
 */
export function asDatabase(db: TestDb): Database {
  return db as unknown as Database;
}

/** Every table the Whoop suite writes to, emptied between tests. */
const TABLES = [
  'whoop_connection',
  'whoop_oauth_state',
  'whoop_cycle',
  'whoop_recovery',
  'whoop_sleep',
  'whoop_workout',
  'whoop_mirror_deletion',
  'whoop_start_ticket',
  'session_workout_link',
  'webhook_event',
  'session',
  'session_event',
  'set_log',
].join(', ');

/**
 * A clean database without booting another one. Starting Postgres in wasm
 * costs a second or two, so the suite pays that once a file and truncates
 * between tests instead.
 */
export async function resetDb(db: TestDb): Promise<void> {
  await db.$client.exec(`truncate ${TABLES} restart identity cascade`);
}

export const TEST_ENCRYPTION_KEY = randomBytes(32).toString('base64');

/** Everything env() insists on, with fixtures off unless a test asks. */
export function setTestEnv(overrides: Readonly<Record<string, string>> = {}): void {
  const values: Record<string, string> = {
    DATABASE_URL: 'postgres://unused/test',
    WHOOP_CLIENT_ID: 'test-client-id',
    WHOOP_CLIENT_SECRET: 'test-client-secret',
    WHOOP_REDIRECT_URI: 'https://vert.example/api/whoop/callback',
    APP_PASSPHRASE_HASH: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
    SESSION_SECRET: 'RUiDvHrJ0mQ8k3PZ1xN7aLcT5eWbYs2OgFn6UhQ4tMc=',
    PUBLIC_BASE_URL: 'https://vert.example',
    TOKEN_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    WHOOP_FIXTURE: '0',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  resetEnvCache();
}

export interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

export interface FetchStub {
  readonly calls: FetchCall[];
  restore(): void;
}

/** Replaces global fetch with a handler, and records every call it saw. */
export function stubFetch(handler: (call: FetchCall) => Promise<Response> | Response): FetchStub {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? init.body : null;
    const call: FetchCall = { url, method: init?.method ?? 'GET', body };
    calls.push(call);
    return handler(call);
  }) as typeof globalThis.fetch;
  return {
    calls,
    restore(): void {
      globalThis.fetch = original;
    },
  };
}

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A token endpoint answer, with a rotated refresh token every time. */
export function tokenBody(suffix: string, expiresIn = 3600): Record<string, unknown> {
  return {
    access_token: `access-${suffix}`,
    refresh_token: `refresh-${suffix}`,
    expires_in: expiresIn,
    scope: 'read:recovery read:cycles read:sleep read:workout read:profile offline',
    token_type: 'bearer',
  };
}
