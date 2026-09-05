import type { NextRequest } from 'next/server';
import { pairClaimRequest } from '../../../../lib/api-contract';
import { claimPairCode } from '../../../../lib/auth';
import { log } from '../../../../lib/logger';
import { database } from '../../../../lib/routes/db';
import { LOGIN_LIMIT, LOGIN_WINDOW_MS, rateLimit } from '../../../../lib/routes/rateLimit';
import { badRequest, fail, json } from '../../../../lib/routes/respond';

/**
 * The phone claims the code and keeps the secret it is handed once.
 *
 * Public, because a phone that has never paired has nothing to prove itself
 * with. What stands in for authentication is the code: six digits, ten
 * minutes, single use, and five wrong guesses buy a sixty second wait counted
 * in Postgres, so the wait survives a cold start and both surfaces read it.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESSAGES: Readonly<Record<'wrong_code' | 'expired' | 'locked', string>> = {
  wrong_code: 'That code is not the one on the web review.',
  expired: 'That code has expired. Start a new pairing on the web review.',
  locked: 'Too many wrong codes. Try again in a moment.',
};

export async function POST(request: NextRequest): Promise<Response> {
  const limit = rateLimit('pair.claim', LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'Too many attempts. Wait a moment.', limit.retryAfterS);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('The request body is not JSON.');
  }
  const parsed = pairClaimRequest.safeParse(body);
  if (!parsed.success) return badRequest('A claim needs a six digit code and a device name.');

  const db = database();
  const outcome = await claimPairCode(db, parsed.data);
  if (!outcome.ok) {
    log.warn('pair.claim.refused', { error: outcome.error, retryAfterS: outcome.retryAfterS });
    return fail(401, outcome.error, MESSAGES[outcome.error], outcome.retryAfterS);
  }

  log.info('pair.claim.paired', { deviceId: outcome.deviceId });
  return json({
    deviceSecret: outcome.deviceSecret,
    deviceId: outcome.deviceId,
    pairedAt: outcome.pairedAt.toISOString(),
  });
}
