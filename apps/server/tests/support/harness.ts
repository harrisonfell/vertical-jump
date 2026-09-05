/**
 * The test harness: a real Postgres, in process, and a request builder.
 *
 * pglite is Postgres compiled to wasm, so a handler under test runs the SQL
 * Neon will run with nothing installed and no DATABASE_URL. The route handlers
 * read their database through one seam (`setDatabaseForTests`), so nothing is
 * mocked: the assertions are about rows, not about calls.
 *
 * One database per worker, truncated between tests rather than rebuilt.
 * Booting wasm Postgres and running the migration costs about two seconds, and
 * paying that per test starves the rest of the suite of a core; truncating
 * costs milliseconds and isolates just as well, because every table goes.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { NextRequest } from 'next/server';
import * as schema from '../../src/db/schema';
import type { Database } from '../../src/db/client';
import { hashSecret } from '../../src/lib/crypto';
import { resetEnvCache } from '../../src/lib/env';
import { setDatabaseForTests } from '../../src/lib/routes/db';
import { resetRateLimits } from '../../src/lib/routes/rateLimit';
import { applyMigrations } from './migrations';

/** The passphrase the fake environment's hash was made from. */
export const TEST_PASSPHRASE = 'the owner passphrase';

/** 32 bytes, base64: SESSION_SECRET is checked for entropy, not for length. */
export const TEST_SESSION_SECRET = 'RUiDvHrJ0mQ8k3PZ1xN7aLcT5eWbYs2OgFn6UhQ4tMc=';

/** scrypt is deliberately slow, so the same hash is reused across a file. */
let passphraseHash: string | null = null;

/**
 * pglite's drizzle handle is the same query builder over a different driver.
 * The handlers are typed against the postgres.js one, so this names it as that
 * rather than threading a second type through every signature.
 */
function asDatabase(value: ReturnType<typeof drizzle<typeof schema>>): Database {
  return value as unknown as Database;
}

interface Booted {
  readonly client: PGlite;
  readonly db: Database;
  readonly tables: readonly string[];
}

let booted: Booted | null = null;

async function boot(): Promise<Booted> {
  const client = new PGlite();
  const handle = drizzle(client, { schema });
  await applyMigrations(handle);
  const found = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  return {
    client,
    db: asDatabase(handle),
    tables: found.rows.map((row) => `"${row.table_name}"`),
  };
}

/** Every table emptied, so one test never reads another test's rows. */
async function truncate(state: Booted): Promise<void> {
  if (state.tables.length === 0) return;
  await state.client.exec(`TRUNCATE TABLE ${state.tables.join(', ')} RESTART IDENTITY CASCADE`);
}

/** A migrated database of its own, for a test that wants to hold the handle. */
export async function freshDb(): Promise<Database> {
  return (await boot()).db;
}

/** A database wired into the route handlers, with an environment they can read. */
export async function harness(): Promise<Database> {
  booted = booted ?? (await boot());
  await truncate(booted);
  setDatabaseForTests(booted.db);
  resetRateLimits();

  passphraseHash = passphraseHash ?? hashSecret(TEST_PASSPHRASE);
  process.env['DATABASE_URL'] = 'postgres://unused/in-tests';
  process.env['WHOOP_CLIENT_ID'] = 'test-client';
  process.env['WHOOP_CLIENT_SECRET'] = 'test-secret';
  process.env['WHOOP_REDIRECT_URI'] = 'https://vert.test/api/whoop/callback';
  process.env['APP_PASSPHRASE_HASH'] = passphraseHash;
  process.env['SESSION_SECRET'] = TEST_SESSION_SECRET;
  process.env['PUBLIC_BASE_URL'] = 'https://vert.test';
  process.env['WHOOP_FIXTURE'] = '1';
  process.env['TOKEN_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
  delete process.env['TOKEN_ENCRYPTION_KEY_PREVIOUS'];
  resetEnvCache();
  return booted.db;
}

export function teardown(): void {
  setDatabaseForTests(null);
  resetRateLimits();
  resetEnvCache();
}

export interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly bearer?: string;
  readonly cookie?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A request the handlers accept. The origin is https, as Vercel's would be. */
export function request(path: string, options: RequestOptions = {}): NextRequest {
  const headers = new Headers(options.headers);
  if (options.bearer !== undefined) headers.set('authorization', `Bearer ${options.bearer}`);
  if (options.cookie !== undefined) headers.set('cookie', options.cookie);
  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers.set('content-type', 'application/json');
  }
  const init: RequestInit = { method: options.method ?? 'GET', headers };
  if (body !== undefined) init.body = body;
  return new Request(`https://vert.test${path}`, init) as unknown as NextRequest;
}

/** The parsed JSON body, typed by the caller because the shapes are contracts. */
export async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** "vert_session=..." from a Set-Cookie header, ready to send back. */
export function cookieFrom(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}
