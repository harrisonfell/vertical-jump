import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '../../../lib/api-contract';
import { clearedSessionCookie, cookieValue, readSession, revokeSessions } from '../../../lib/auth';
import { env } from '../../../lib/env';
import { log } from '../../../lib/logger';
import { database } from '../../../lib/routes/db';
import { isSecureRequest } from '../../../lib/routes/guard';
import { json } from '../../../lib/routes/respond';

/**
 * Sign out. Public on purpose: clearing a cookie needs no proof, and a session
 * that has already expired must still be able to tidy itself away.
 *
 * Clearing the cookie is not enough on its own. The session token is checked
 * on its signature and its expiry alone, so a copy that leaked would keep
 * working for the rest of its thirty days after the owner signed out. A real
 * sign-out therefore also moves the server's "sessions valid from" instant, and
 * every token minted before it stops being accepted. A caller with no valid
 * cookie only gets the cookie cleared, so a stranger cannot sign the owner out.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const cookie = cookieValue(request.headers.get('cookie'), SESSION_COOKIE);
  const now = new Date();
  if (readSession(cookie, env().SESSION_SECRET, now) !== null) {
    await revokeSessions(database(), now);
    log.info('logout.ok', {});
  }
  return json({ ok: true }, 200, { 'set-cookie': clearedSessionCookie(isSecureRequest(request)) });
}
