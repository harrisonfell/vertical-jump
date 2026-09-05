/**
 * The one place the server talks to Whoop.
 *
 * Every call, including the token endpoint, goes through `whoopFetch`, so
 * fixture mode, rate-limit handling and logging exist once. Whoop has no
 * sandbox: the owner's own band is the test environment, so WHOOP_FIXTURE=1
 * replays JSON recorded from the first week out of fixtures/whoop/ and every
 * path below can be developed without a wrist on the network.
 *
 * Pagination is Whoop's: `limit` at most 25, `nextToken` to continue, `start`
 * inclusive and `end` exclusive. Rate limits are 100 a minute and 10,000 a
 * day, and a 429 comes back as an error carrying the instant to retry at, so
 * the Settings screen can say "Rate limited, next sync at 7:02".
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isFixtureMode } from '../env';
import { log } from '../logger';
import type { WhoopErrorKind } from '../api-contract';
import { WHOOP_PAGE_LIMIT } from '../api-contract';

export const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';

/** Every scope the app asks for. `offline` is what makes a refresh token. */
export const WHOOP_SCOPES = [
  'read:recovery',
  'read:cycles',
  'read:sleep',
  'read:workout',
  'read:profile',
  'read:body_measurement',
  'offline',
] as const;

export const WHOOP_SCOPE_STRING = WHOOP_SCOPES.join(' ');

/** The v2 collections this server reads. Nothing else is called. */
export const WHOOP_PATHS = {
  cycle: '/v2/cycle',
  recovery: '/v2/recovery',
  sleep: '/v2/activity/sleep',
  workout: '/v2/activity/workout',
  profile: '/v2/user/profile/basic',
  body: '/v2/user/measurement/body',
  access: '/v2/user/access',
} as const;

export function cycleRecoveryPath(cycleId: string): string {
  return `/v2/cycle/${encodeURIComponent(cycleId)}/recovery`;
}

export function cycleSleepPath(cycleId: string): string {
  return `/v2/cycle/${encodeURIComponent(cycleId)}/sleep`;
}

/** One cycle, by id. A webhook names an id, so every kind needs a single read. */
export function cyclePath(cycleId: string): string {
  return `/v2/cycle/${encodeURIComponent(cycleId)}`;
}

export function sleepPath(sleepId: string): string {
  return `/v2/activity/sleep/${encodeURIComponent(sleepId)}`;
}

export function workoutPath(workoutId: string): string {
  return `/v2/activity/workout/${encodeURIComponent(workoutId)}`;
}

/* ---------------------------------------------------------------- errors */

/** Which endpoint said no. Only the token endpoint can mean the grant is gone. */
export type WhoopErrorSource = 'token' | 'data';

/** Carries the kind the app's copy switches on, and when to try again. */
export class WhoopApiError extends Error {
  readonly kind: WhoopErrorKind;
  readonly status: number;
  readonly nextAt: string | null;
  readonly source: WhoopErrorSource;

  constructor(
    kind: WhoopErrorKind,
    message: string,
    status = 0,
    nextAt: string | null = null,
    source: WhoopErrorSource = 'data',
  ) {
    super(message);
    this.name = 'WhoopApiError';
    this.kind = kind;
    this.status = status;
    this.nextAt = nextAt;
    this.source = source;
  }
}

/**
 * How long a 429 asks us to wait, as an instant. Defaults to a minute.
 *
 * RFC 9110 allows either a number of seconds or an HTTP date, and a rate limit
 * that names an instant more than a minute out was being under-waited, so the
 * Settings line said the wrong "next sync at" and the next call was refused
 * again.
 */
export function retryAt(header: string | null, now: Date): string {
  if (header !== null) {
    const trimmed = header.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds > 0) {
      return new Date(now.getTime() + seconds * 1000).toISOString();
    }
    const named = Date.parse(trimmed);
    if (Number.isFinite(named) && named > now.getTime()) return new Date(named).toISOString();
  }
  return new Date(now.getTime() + 60_000).toISOString();
}

/* --------------------------------------------------------------- fixtures */

/**
 * Which recorded file answers which path, and how. Fixture mode is exact, not
 * clever: an unmapped path is an error, so a new call site cannot silently
 * pass. Collection paths page and filter the recorded records the way Whoop
 * does, so a 90 day backfill really does take several calls against fixtures.
 */
interface FixtureLookup {
  readonly file: string;
  /** Collections answer a page; a single object answers one record. */
  readonly paged: boolean;
  /** Which field of a record the id in the path matches. */
  readonly pick?: { readonly field: string; readonly value: string };
}

const ONE = {
  cycle: /^\/v2\/cycle\/([^/]+)$/,
  cycleRecovery: /^\/v2\/cycle\/([^/]+)\/recovery$/,
  cycleSleep: /^\/v2\/cycle\/([^/]+)\/sleep$/,
  sleep: /^\/v2\/activity\/sleep\/([^/]+)$/,
  workout: /^\/v2\/activity\/workout\/([^/]+)$/,
} as const;

function pickOne(file: string, field: string, raw: string | undefined): FixtureLookup {
  return { file, paged: false, pick: { field, value: decodeURIComponent(raw ?? '') } };
}

function fixtureFor(path: string): FixtureLookup | null {
  switch (path) {
    case WHOOP_TOKEN_URL:
      return { file: 'token.json', paged: false };
    case WHOOP_PATHS.profile:
      return { file: 'profile.json', paged: false };
    case WHOOP_PATHS.body:
      return { file: 'body.json', paged: false };
    case WHOOP_PATHS.cycle:
      return { file: 'cycle.json', paged: true };
    case WHOOP_PATHS.recovery:
      return { file: 'recovery.json', paged: true };
    case WHOOP_PATHS.sleep:
      return { file: 'sleep.json', paged: true };
    case WHOOP_PATHS.workout:
      return { file: 'workout.json', paged: true };
    default:
      break;
  }
  const cycleRecovery = ONE.cycleRecovery.exec(path);
  if (cycleRecovery !== null) return pickOne('recovery.json', 'cycle_id', cycleRecovery[1]);
  const cycleSleep = ONE.cycleSleep.exec(path);
  if (cycleSleep !== null) return pickOne('sleep.json', 'cycle_id', cycleSleep[1]);
  const sleep = ONE.sleep.exec(path);
  if (sleep !== null) return pickOne('sleep.json', 'id', sleep[1]);
  const workout = ONE.workout.exec(path);
  if (workout !== null) return pickOne('workout.json', 'id', workout[1]);
  const cycle = ONE.cycle.exec(path);
  if (cycle !== null) return pickOne('cycle.json', 'id', cycle[1]);
  return null;
}

/** Both the app root (next dev, next build) and the repo root (vitest). */
function fixtureDirs(): string[] {
  const override = process.env['WHOOP_FIXTURE_DIR'];
  const dirs = [join(process.cwd(), 'fixtures', 'whoop'), join(process.cwd(), 'apps', 'server', 'fixtures', 'whoop')];
  return override === undefined || override === '' ? dirs : [override, ...dirs];
}

async function readFixtureFile(name: string): Promise<unknown> {
  for (const dir of fixtureDirs()) {
    try {
      return JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown;
    } catch {
      continue;
    }
  }
  throw new WhoopApiError('api_down', `Whoop fixture ${name} could not be read.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordsOf(body: unknown): Record<string, unknown>[] {
  if (!isRecord(body) || !Array.isArray(body['records'])) return [];
  return body['records'].filter(isRecord);
}

/** A record's own instant: `start` for a cycle, sleep or workout, else `created_at`. */
function recordInstant(record: Record<string, unknown>): number | null {
  const raw = record['start'] ?? record['created_at'];
  if (typeof raw !== 'string') return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whoop's window: `start` inclusive, `end` exclusive, applied to fixtures too. */
function withinWindow(
  record: Record<string, unknown>,
  start: string | undefined,
  end: string | undefined,
): boolean {
  const at = recordInstant(record);
  if (at === null) return true;
  if (start !== undefined && at < Date.parse(start)) return false;
  if (end !== undefined && at >= Date.parse(end)) return false;
  return true;
}

type FixtureQuery = Readonly<Record<string, string | number | undefined>>;

function asString(value: string | number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

/**
 * The recorded answer for one request. Collections are sliced by `nextToken`
 * (which is simply the offset) and by the same limit Whoop enforces, so a
 * fixture backfill is chunked and resumable exactly like the real one.
 */
async function readFixture(path: string, query: FixtureQuery): Promise<unknown> {
  if (path === WHOOP_PATHS.access) return null;
  const lookup = fixtureFor(path);
  if (lookup === null) {
    throw new WhoopApiError('api_down', `No Whoop fixture is recorded for ${path}.`);
  }
  const body = await readFixtureFile(lookup.file);

  if (lookup.pick !== undefined) {
    const wanted = lookup.pick;
    const found = recordsOf(body).find((record) => String(record[wanted.field]) === wanted.value);
    if (found === undefined) {
      throw new WhoopApiError('api_down', `Whoop fixture ${lookup.file} has no ${wanted.value}.`);
    }
    return found;
  }
  if (!lookup.paged) return body;

  const all = recordsOf(body).filter((record) =>
    withinWindow(record, asString(query['start']), asString(query['end'])),
  );
  const rawOffset = Number(query['nextToken'] ?? 0);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  const rawLimit = Number(query['limit'] ?? WHOOP_PAGE_LIMIT);
  const limit = Math.min(
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : WHOOP_PAGE_LIMIT,
    WHOOP_PAGE_LIMIT,
  );
  const slice = all.slice(offset, offset + limit);
  const next = offset + limit < all.length ? String(offset + limit) : null;
  return { records: slice, next_token: next };
}

/* ---------------------------------------------------------------- request */

export interface WhoopFetchOptions {
  /** A v2 path such as /v2/recovery, or the full token URL. */
  readonly path: string;
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly token?: string;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  /** Form body for the token endpoint; Whoop's OAuth is form encoded. */
  readonly form?: Readonly<Record<string, string>>;
  readonly now?: Date;
}

function urlFor(options: WhoopFetchOptions): string {
  const base = options.path.startsWith('http') ? options.path : `${WHOOP_API_BASE}${options.path}`;
  const url = new URL(base);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * One request. Returns parsed JSON, or throws a WhoopApiError whose kind the
 * caller stores on the connection row as `lastError`.
 */
export async function whoopFetch(options: WhoopFetchOptions): Promise<unknown> {
  const now = options.now ?? new Date();
  const key = options.path.startsWith('http') ? options.path : options.path;
  const source: WhoopErrorSource = options.path === WHOOP_TOKEN_URL ? 'token' : 'data';

  if (isFixtureMode()) {
    log.debug('whoop.fixture', { path: key });
    return readFixture(key, options.query ?? {});
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
  if (options.form !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded';

  let response: Response;
  try {
    response = await fetch(urlFor(options), {
      method: options.method ?? (options.form === undefined ? 'GET' : 'POST'),
      headers,
      body: options.form === undefined ? undefined : new URLSearchParams(options.form).toString(),
      cache: 'no-store',
    });
  } catch {
    throw new WhoopApiError('network', 'Could not reach Whoop.', 0, null, source);
  }

  if (response.status === 429) {
    const nextAt = retryAt(response.headers.get('retry-after'), now);
    log.warn('whoop.rate_limited', { path: key, nextAt });
    throw new WhoopApiError('rate_limited', 'Whoop rate limited this app.', 429, nextAt, source);
  }
  // A 401 or a 403 from a data endpoint is a stale access token or a scope
  // answer, not a dead grant: it carries its source so the caller refreshes
  // and retries instead of throwing the refresh token away.
  if (response.status === 401 || response.status === 403) {
    throw new WhoopApiError('needs_reauth', 'Whoop rejected the token.', response.status, null, source);
  }
  if (response.status === 204) return null;
  if (!response.ok) {
    log.warn('whoop.error', { path: key, status: response.status });
    throw new WhoopApiError('api_down', `Whoop answered ${response.status}.`, response.status, null, source);
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new WhoopApiError('api_down', 'Whoop answered with something that is not JSON.');
  }
}

/** The same request, parsed by a schema. A shape surprise is an api_down. */
export async function whoopFetchParsed<T>(
  options: WhoopFetchOptions,
  schema: z.ZodType<T>,
): Promise<T> {
  const body = await whoopFetch(options);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    log.warn('whoop.shape', { path: options.path, issues: parsed.error.issues.length });
    throw new WhoopApiError('api_down', `Whoop answered an unexpected shape for ${options.path}.`);
  }
  return parsed.data;
}

/* -------------------------------------------------------------- paging */

/** Whoop's envelope: a page of records and the token for the next one. */
export function pageSchema<T>(record: z.ZodType<T>): z.ZodType<{
  records: T[];
  next_token: string | null;
}> {
  return z.object({
    records: z.array(record).default([]),
    next_token: z.string().nullable().default(null),
  }) as unknown as z.ZodType<{ records: T[]; next_token: string | null }>;
}

export interface WhoopPageQuery {
  readonly token: string;
  /** Inclusive. */
  readonly start?: string;
  /** Exclusive. */
  readonly end?: string;
  readonly limit?: number;
  readonly nextToken?: string | null;
}

export interface WhoopPage<T> {
  readonly records: readonly T[];
  readonly nextToken: string | null;
}

/** One page, at most 25 records, which is Whoop's own ceiling. */
export async function whoopPage<T>(
  path: string,
  query: WhoopPageQuery,
  record: z.ZodType<T>,
  now?: Date,
): Promise<WhoopPage<T>> {
  const page = await whoopFetchParsed(
    {
      path,
      token: query.token,
      query: {
        limit: Math.min(query.limit ?? WHOOP_PAGE_LIMIT, WHOOP_PAGE_LIMIT),
        start: query.start,
        end: query.end,
        nextToken: query.nextToken ?? undefined,
      },
      ...(now === undefined ? {} : { now }),
    },
    pageSchema(record),
  );
  return { records: page.records, nextToken: page.next_token };
}

/**
 * Pages until Whoop runs out or `maxPages` is reached, whichever comes first.
 * The cursor comes back so the caller can resume: a sync call is bounded so a
 * Vercel function never runs long, and the backfill is resumable by design.
 */
export async function whoopCollect<T>(
  path: string,
  query: WhoopPageQuery,
  record: z.ZodType<T>,
  maxPages: number,
): Promise<{ records: T[]; nextToken: string | null; pages: number }> {
  const records: T[] = [];
  let cursor = query.nextToken ?? null;
  let pages = 0;
  while (pages < maxPages) {
    const page = await whoopPage(path, { ...query, nextToken: cursor }, record);
    records.push(...page.records);
    pages += 1;
    const previous = cursor;
    cursor = page.nextToken;
    // A token that does not move would page for ever; treat it as the end.
    if (cursor === null || cursor === previous) {
      cursor = null;
      break;
    }
  }
  return { records, nextToken: cursor, pages };
}
