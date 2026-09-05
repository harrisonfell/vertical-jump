import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { fail, json } from '../../../../lib/routes/respond';
import { runWhoopSync } from '../../../../lib/whoop/sync';

/**
 * POST /api/whoop/sync
 *
 * One bounded chunk. The app calls it on open, after a connect, and from the
 * Sync now button, and calls it again while `done` is false: the 90 day
 * backfill is chunked and resumable, so progress is the cursor rather than a
 * long-running function.
 *
 * A rate limit answers 429 with Retry-After and the same status body, so the
 * screen can say "Rate limited, next sync at 7:02" from either one.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Vercel Hobby allows 300 s; one chunk aims at about twenty. */
export const maxDuration = 60;

function retryAfterS(nextRetryAt: string | null, now: Date): number {
  if (nextRetryAt === null) return 60;
  const at = Date.parse(nextRetryAt);
  if (!Number.isFinite(at)) return 60;
  return Math.max(1, Math.ceil((at - now.getTime()) / 1000));
}

async function syncNow(db: ReturnType<typeof database>): Promise<Response> {
  const now = new Date();
  const result = await runWhoopSync(db, { now });

  if (result.lastError === 'rate_limited') {
    return json(result, 429, { 'retry-after': String(retryAfterS(result.nextRetryAt, now)) });
  }
  return json(result);
}

export async function POST(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;
  return syncNow(db);
}

/** Compares without leaking where two strings first differ. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * GET /api/whoop/sync
 *
 * The daily cron, and only the cron. Vercel calls it once a day with
 * `Authorization: Bearer $CRON_SECRET`, which is the one credential this path
 * takes: there is no session and no paired device behind a scheduled call, so
 * the guard used by POST has nothing to check. With `CRON_SECRET` unset the
 * path is closed rather than open, because an open sync endpoint is a way to
 * spend the athlete's Whoop rate limit from outside.
 *
 * One chunk per call, same as POST. A ninety day backfill therefore finishes
 * over several days of crons unless the app opens sooner, which is the intended
 * trade on Hobby: cron runs once a day and functions are bounded.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const expected = process.env['CRON_SECRET'];
  if (expected === undefined || expected === '') {
    return fail(503, 'cron_disabled', 'Set CRON_SECRET to enable the daily sync.');
  }

  const header = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  const given = header.startsWith(prefix) ? header.slice(prefix.length) : '';
  if (!sameSecret(given, expected)) {
    return fail(401, 'unauthorized', 'This path is the daily cron.');
  }

  return syncNow(database());
}
