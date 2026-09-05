import type { NextRequest } from 'next/server';
import { loginRequest } from '../../../lib/api-contract';
import {
  SESSION_TTL_S,
  allowSessions,
  clearFailures,
  isLocked,
  lockoutRemainingS,
  mintSession,
  noteFailure,
  readLockout,
  sessionCookie,
} from '../../../lib/auth';
import { verifySecret } from '../../../lib/crypto';
import { env } from '../../../lib/env';
import { log } from '../../../lib/logger';
import { database } from '../../../lib/routes/db';
import { isSecureRequest } from '../../../lib/routes/guard';
import { LOGIN_LIMIT, LOGIN_WINDOW_MS, rateLimit } from '../../../lib/routes/rateLimit';
import { badRequest, fail, json } from '../../../lib/routes/respond';

/**
 * The web build's single-owner passphrase. No accounts, one owner.
 *
 * Only the scrypt hash is on the server, the comparison is constant time, and
 * the failure counter is the same Postgres row the pairing claim counts in, so
 * five wrong answers on either surface buy the same sixty seconds. A right
 * answer always mints a fresh cookie rather than extending the old one, so a
 * session that leaked cannot be kept alive by signing in again.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const limit = rateLimit('login', LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'Too many attempts. Wait a moment.', limit.retryAfterS);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('The request body is not JSON.');
  }
  const parsed = loginRequest.safeParse(body);
  if (!parsed.success) return badRequest('Type the passphrase.');

  const db = database();
  const now = new Date();
  const lockout = await readLockout(db, now);
  if (isLocked(lockout, now)) {
    const retryAfterS = lockoutRemainingS(lockout, now);
    return fail(401, 'locked', `Try again in ${retryAfterS} s.`, retryAfterS);
  }

  if (!verifySecret(parsed.data.passphrase, env().APP_PASSPHRASE_HASH)) {
    const retryAfterS = await noteFailure(db, now);
    log.warn('login.wrong', { retryAfterS });
    return retryAfterS > 0
      ? fail(401, 'locked', `Try again in ${retryAfterS} s.`, retryAfterS)
      : fail(401, 'wrong_passphrase', 'Wrong passphrase.', 0);
  }

  await clearFailures(db, now);
  // Signing in trusts cookies again, starting with the one minted below: the
  // last sign-out set an instant that refuses everything older than itself.
  await allowSessions(db, now);
  const token = mintSession(env().SESSION_SECRET, now);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_S * 1000).toISOString();
  log.info('login.ok', { expiresAt });

  return json({ ok: true, expiresAt }, 200, {
    'set-cookie': sessionCookie(token, SESSION_TTL_S, isSecureRequest(request)),
  });
}
