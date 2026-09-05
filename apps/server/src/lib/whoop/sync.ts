/**
 * One bounded chunk of Whoop history.
 *
 * The backfill is 90 days, chunked and resumable, because a Vercel Hobby
 * function has 300 s and Whoop pages 25 records at a time. Every call spends
 * at most a page budget and about twenty seconds, writes what it got, moves
 * the cursor, and answers `done: false` so the app calls again. A cancelled
 * sync therefore loses nothing: the cursor is the progress.
 *
 * The access token is fetched through `ensureAccessToken`, which refreshes
 * inside the connection row's lock, so a sync that starts five minutes before
 * expiry rotates the pair once and never races a second caller.
 */

import { z } from 'zod';
import type { Database } from '../../db/client';
import type { WhoopErrorKind, WhoopStatusResponse, WhoopSyncResponse } from '../api-contract';
import { WHOOP_BACKFILL_DAYS, WHOOP_PAGE_LIMIT, WHOOP_SYNC_MAX_PAGES } from '../api-contract';
import { errorMessage, log } from '../logger';
import { WHOOP_PATHS, WhoopApiError, whoopPage } from './api';
import {
  clearTokens,
  ensureConnection,
  markConnectionError,
  patchConnection,
  readConnection,
  toStatusResponse,
} from './connection';
import { relinkSessions } from './match';
import {
  countImportedDays,
  deleteAllMirrors,
  upsertCycles,
  upsertRecoveries,
  upsertSleeps,
  upsertWorkouts,
} from './mirrors';
import {
  cycleV2,
  recoveryV2,
  sleepV2,
  toCycleRow,
  toRecoveryRow,
  toSleepRow,
  toWorkoutRow,
  workoutV2,
} from './records';
import { ensureAccessToken, markAccessTokenStale, revokeAccess } from './tokens';

export interface SyncOptions {
  /** Backfill start; defaults to 90 days before now, or last sync minus 48 h. */
  readonly since?: Date;
  readonly maxPages?: number;
  readonly now?: Date;
  /** Wall clock this call may spend before it saves the cursor and returns. */
  readonly budgetMs?: number;
}

/** About twenty seconds of work, well inside a Vercel function's life. */
export const SYNC_BUDGET_MS = 20_000;

/** How long to wait before trying again after Whoop was simply unwell. */
export const RETRY_AFTER_MS = 15 * 60 * 1000;

const DAY_MS = 86_400_000;
/** A reconnect re-reads two days, because a recovery can be edited after the fact. */
const OVERLAP_MS = 48 * 60 * 60 * 1000;

const KINDS = ['cycle', 'sleep', 'recovery', 'workout'] as const;
type SyncKind = (typeof KINDS)[number];

const pageToken = z.string().nullable().default(null);
const finished = z.boolean().default(false);

const cursorState = z.object({
  startAt: z.string(),
  endAt: z.string(),
  tokens: z.object({
    cycle: pageToken,
    sleep: pageToken,
    recovery: pageToken,
    workout: pageToken,
  }),
  done: z.object({ cycle: finished, sleep: finished, recovery: finished, workout: finished }),
});

interface Cursor {
  startAt: string;
  endAt: string;
  tokens: Record<SyncKind, string | null>;
  done: Record<SyncKind, boolean>;
}

function freshCursor(startAt: Date, endAt: Date): Cursor {
  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    tokens: { cycle: null, sleep: null, recovery: null, workout: null },
    done: { cycle: false, sleep: false, recovery: false, workout: false },
  };
}

function parseCursor(raw: string | null): Cursor | null {
  if (raw === null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const result = cursorState.safeParse(parsed);
  if (!result.success) return null;
  const cursor = freshCursor(new Date(result.data.startAt), new Date(result.data.endAt));
  cursor.startAt = result.data.startAt;
  cursor.endAt = result.data.endAt;
  for (const kind of KINDS) {
    cursor.tokens[kind] = result.data.tokens[kind] ?? null;
    cursor.done[kind] = result.data.done[kind] ?? false;
  }
  return cursor;
}

/** The first collection still owing pages. Null when the chunk is finished. */
function phaseOf(cursor: Cursor): SyncKind | null {
  return KINDS.find((kind) => !cursor.done[kind]) ?? null;
}

interface StepResult {
  readonly count: number;
  readonly nextToken: string | null;
}

interface StepInput {
  readonly db: Database;
  readonly token: string;
  readonly cursor: string | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly at: string;
  /** The call's clock, so a 429 names an instant relative to it. */
  readonly now: Date;
}

/** One page of one collection, written straight into its mirror. */
const STEPS: Readonly<Record<SyncKind, (input: StepInput) => Promise<StepResult>>> = {
  async cycle(input) {
    const page = await whoopPage(
      WHOOP_PATHS.cycle,
      { token: input.token, start: input.startAt, end: input.endAt, limit: WHOOP_PAGE_LIMIT, nextToken: input.cursor },
      cycleV2,
      input.now,
    );
    await upsertCycles(input.db, page.records.map((record) => toCycleRow(record, input.at)));
    return { count: page.records.length, nextToken: page.nextToken };
  },
  async sleep(input) {
    const page = await whoopPage(
      WHOOP_PATHS.sleep,
      { token: input.token, start: input.startAt, end: input.endAt, limit: WHOOP_PAGE_LIMIT, nextToken: input.cursor },
      sleepV2,
      input.now,
    );
    await upsertSleeps(input.db, page.records.map((record) => toSleepRow(record, input.at)));
    return { count: page.records.length, nextToken: page.nextToken };
  },
  async recovery(input) {
    const page = await whoopPage(
      WHOOP_PATHS.recovery,
      { token: input.token, start: input.startAt, end: input.endAt, limit: WHOOP_PAGE_LIMIT, nextToken: input.cursor },
      recoveryV2,
      input.now,
    );
    await upsertRecoveries(input.db, page.records.map((record) => toRecoveryRow(record, input.at)));
    return { count: page.records.length, nextToken: page.nextToken };
  },
  async workout(input) {
    const page = await whoopPage(
      WHOOP_PATHS.workout,
      { token: input.token, start: input.startAt, end: input.endAt, limit: WHOOP_PAGE_LIMIT, nextToken: input.cursor },
      workoutV2,
      input.now,
    );
    await upsertWorkouts(input.db, page.records.map((record) => toWorkoutRow(record, input.at)));
    return { count: page.records.length, nextToken: page.nextToken };
  },
};

/**
 * The local date the imported-days count starts at: the same 90 day floor the
 * backfill window uses, so the counter and the window can never disagree.
 */
function backfillFloor(now: Date): string {
  return new Date(now.getTime() - WHOOP_BACKFILL_DAYS * DAY_MS).toISOString().slice(0, 10);
}

function syncResponse(
  status: WhoopStatusResponse,
  extra: { daysImported: number; imported: number; nextCursor: string | null; done: boolean },
): WhoopSyncResponse {
  return { ...status, ...extra };
}

/**
 * What a failure means for the grant.
 *
 * Only the token endpoint can say the grant is gone. A 401 or a 403 from a
 * data endpoint is a stale access token, a scope answer, or a transient
 * permission error, and treating it as `needs_reauth` used to delete the
 * refresh token and force a full reconnect when one refresh would have fixed
 * it.
 */
function kindOf(cause: unknown): WhoopErrorKind {
  if (!(cause instanceof WhoopApiError)) return 'api_down';
  if (cause.kind === 'needs_reauth' && cause.source === 'data') return 'api_down';
  return cause.kind;
}

/** True when one refresh and one retry is worth trying before giving up. */
function isStaleToken(cause: unknown): boolean {
  return cause instanceof WhoopApiError && cause.kind === 'needs_reauth' && cause.source === 'data';
}

/** Whoop said no. The kind decides whether this is weather or a dead grant. */
async function failed(
  db: Database,
  cause: unknown,
  imported: number,
  cursor: Cursor | null,
  now: Date,
): Promise<WhoopSyncResponse> {
  const kind = kindOf(cause);
  const nextAt =
    cause instanceof WhoopApiError && cause.nextAt !== null
      ? new Date(cause.nextAt)
      : kind === 'needs_reauth'
        ? null
        : new Date(now.getTime() + RETRY_AFTER_MS);
  // The pages this call already walked are progress, and a rate limit is
  // exactly the wrong moment to throw them away and fetch them again.
  if (cursor !== null) {
    await patchConnection(db, { backfillCursor: JSON.stringify(cursor) }, now);
  }
  const row = await markConnectionError(db, kind, nextAt, now);
  log.warn('whoop.sync_failed', { kind, message: errorMessage(cause) });
  return syncResponse(toStatusResponse(row), {
    daysImported: 0,
    imported,
    nextCursor: cursor === null ? null : phaseOf(cursor),
    done: false,
  });
}

/**
 * Runs one chunk: cycles, sleeps, recoveries, workouts, then the cursor.
 *
 * Sleeps are read before recoveries so a recovery's sleep is already local
 * when a webhook later has to resolve sleep to cycle to recovery.
 */
export async function runWhoopSync(
  db: Database,
  options: SyncOptions = {},
): Promise<WhoopSyncResponse> {
  const now = options.now ?? new Date();
  const budgetMs = options.budgetMs ?? SYNC_BUDGET_MS;
  const maxPages = options.maxPages ?? WHOOP_SYNC_MAX_PAGES;
  const startedAt = Date.now();

  const row = await ensureConnection(db, now);
  if (row.refreshTokenCipher === null) {
    return syncResponse(toStatusResponse(row), {
      daysImported: 0,
      imported: 0,
      nextCursor: null,
      done: true,
    });
  }

  const floor = backfillFloor(now);
  const daysBefore = await countImportedDays(db, floor);

  let token: string;
  try {
    token = await ensureAccessToken(db, now);
  } catch (cause) {
    return failed(db, cause, 0, null, now);
  }

  const stored = parseCursor(row.backfillCursor);
  const windowStart =
    options.since ??
    (row.lastSyncAt === null
      ? new Date(now.getTime() - WHOOP_BACKFILL_DAYS * DAY_MS)
      : new Date(row.lastSyncAt.getTime() - OVERLAP_MS));
  const cursor = stored ?? freshCursor(windowStart, now);
  const at = now.toISOString();

  let imported = 0;
  let workoutsWritten = 0;
  let pages = 0;

  const runChunk = async (bearer: string): Promise<void> => {
    for (const kind of KINDS) {
      while (!cursor.done[kind]) {
        if (pages >= maxPages || Date.now() - startedAt >= budgetMs) break;
        const step = await STEPS[kind]({
          db,
          token: bearer,
          cursor: cursor.tokens[kind],
          startAt: cursor.startAt,
          endAt: cursor.endAt,
          at,
          now,
        });
        pages += 1;
        imported += step.count;
        if (kind === 'workout') workoutsWritten += step.count;
        const previous = cursor.tokens[kind];
        cursor.tokens[kind] = step.nextToken;
        // A token that does not move would page for ever; treat it as the end.
        if (step.nextToken === null || step.nextToken === previous) cursor.done[kind] = true;
      }
      if (pages >= maxPages || Date.now() - startedAt >= budgetMs) break;
    }
  };

  try {
    await runChunk(token);
  } catch (cause) {
    if (!isStaleToken(cause)) return failed(db, cause, imported, cursor, now);
    // Whoop rejected the access token a data call was carrying. That is worth
    // exactly one refresh and one retry; the grant itself is gone only when the
    // token endpoint says so.
    try {
      await markAccessTokenStale(db, now);
      await runChunk(await ensureAccessToken(db, now));
    } catch (second) {
      return failed(db, second, imported, cursor, now);
    }
  }

  if (workoutsWritten > 0) {
    await relinkSessions(db, { from: new Date(cursor.startAt), to: now, now });
  }

  const daysAfter = await countImportedDays(db, floor);
  const done = phaseOf(cursor) === null;

  const updated = await patchConnection(
    db,
    {
      status: done ? 'connected' : 'importing',
      backfillCursor: done ? null : JSON.stringify(cursor),
      backfillDaysDone: daysAfter,
      backfillDaysTotal: WHOOP_BACKFILL_DAYS,
      lastError: null,
      nextRetryAt: null,
      ...(done ? { lastSyncAt: now } : {}),
    },
    now,
  );

  log.info('whoop.sync', { pages, imported, days: daysAfter, done });

  return syncResponse(toStatusResponse(updated), {
    daysImported: Math.max(0, daysAfter - daysBefore),
    imported,
    nextCursor: done ? null : phaseOf(cursor),
    done,
  });
}

/** The connection row as the app reads it. Never throws; a missing row is 'disconnected'. */
export async function readWhoopStatus(db: Database): Promise<WhoopStatusResponse> {
  return toStatusResponse(await readConnection(db));
}

/** Forgets the connection here. Whoop keeps the grant until /revoke. */
export async function disconnectWhoop(
  db: Database,
  now: Date = new Date(),
): Promise<WhoopStatusResponse> {
  const row = await clearTokens(db, 'disconnected', now);
  log.info('whoop.disconnected', {});
  return toStatusResponse(row);
}

/**
 * DELETE /v2/user/access, then status 'revoked'.
 *
 * The call to Whoop is best effort: if it fails the grant may still be live on
 * Whoop's side, but keeping tokens the owner has asked us to drop would be
 * worse, so they go either way and the state is honest about it.
 */
export async function revokeWhoop(
  db: Database,
  now: Date = new Date(),
): Promise<WhoopStatusResponse> {
  const row = await ensureConnection(db, now);
  let failure = false;
  if (row.refreshTokenCipher !== null) {
    try {
      // Through ensureAccessToken, not straight off the row: an access token
      // lives an hour, so a Revoke pressed any later than that used to send an
      // expired bearer, take the 401, and still report a clean revoke while
      // Whoop kept the grant.
      await revokeAccess(await ensureAccessToken(db, now));
    } catch (cause) {
      failure = true;
      log.warn('whoop.revoke_failed', { message: errorMessage(cause) });
    }
  }
  const cleared = await clearTokens(db, 'revoked', now);
  if (!failure) return toStatusResponse(cleared);
  // The tokens are gone from here either way, but the owner is told the grant
  // may still be live at Whoop rather than promised a clean revoke.
  return toStatusResponse(await patchConnection(db, { lastError: 'api_down' }, now));
}

/** Deletes every mirror row and leaves its tombstone. The connection row stays. */
export async function deleteWhoopMirrors(
  db: Database,
  now: Date = new Date(),
): Promise<{ cycles: number; recoveries: number; sleeps: number; workouts: number }> {
  const deleted = await deleteAllMirrors(db, now);
  await patchConnection(db, { backfillCursor: null, backfillDaysDone: 0 }, now);
  log.info('whoop.data_deleted', deleted);
  return deleted;
}

/** After a fresh exchange: 90 days are owed and the first chunk can start. */
export { beginBackfill } from './connection';
