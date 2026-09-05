import type { NextRequest } from 'next/server';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { json } from '../../../../lib/routes/respond';
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

export async function POST(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'either');
  if (!caller.ok) return caller.response;

  const now = new Date();
  const result = await runWhoopSync(db, { now });

  if (result.lastError === 'rate_limited') {
    return json(result, 429, { 'retry-after': String(retryAfterS(result.nextRetryAt, now)) });
  }
  return json(result);
}
