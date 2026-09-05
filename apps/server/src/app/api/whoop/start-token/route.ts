import type { NextRequest } from 'next/server';
import { env } from '../../../../lib/env';
import { log } from '../../../../lib/logger';
import { database } from '../../../../lib/routes/db';
import { guard } from '../../../../lib/routes/guard';
import { fail, json } from '../../../../lib/routes/respond';
import { mintStartTicket } from '../../../../lib/whoop/startTicket';

/**
 * POST /api/whoop/start-token
 *
 * The first call of the app's connect flow. The phone spends the ticket this
 * hands back in `/api/whoop/start?t=`, because the system authentication
 * session opens a URL and cannot carry an Authorization header, and the device
 * secret must never ride a query string.
 *
 * Bearer only: the web build has a session cookie, which the browser attaches
 * to the start URL on its own, so it needs no ticket.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  const db = database();
  const caller = await guard(db, request, 'bearer');
  if (!caller.ok) return caller.response;
  if (caller.principal.kind !== 'device') {
    return fail(403, 'wrong_credential', 'This needs the paired app.');
  }

  const minted = await mintStartTicket(
    db,
    caller.principal.deviceId,
    env().SESSION_SECRET,
    new Date(),
  );
  log.info('whoop.start_token', { deviceId: caller.principal.deviceId });
  return json({ token: minted.token, expiresAt: minted.expiresAt.toISOString() });
}
