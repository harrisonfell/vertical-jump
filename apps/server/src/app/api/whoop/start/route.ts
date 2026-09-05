import { NextResponse, type NextRequest } from 'next/server';
import { WHOOP_START_TOKEN_PARAM, whoopStartQuery } from '../../../../lib/api-contract';
import { whoopOauthState } from '../../../../db/tables/whoop';
import { env } from '../../../../lib/env';
import { log } from '../../../../lib/logger';
import { database } from '../../../../lib/routes/db';
import { deviceIdOf, guard, isCrossSiteNavigation } from '../../../../lib/routes/guard';
import { badRequest, fail, json } from '../../../../lib/routes/respond';
import { ensureConnection, patchConnection } from '../../../../lib/whoop/connection';
import { STATE_TTL_MS, authorizeUrl, mintState, safeRedirect } from '../../../../lib/whoop/oauth';
import { spendStartTicket } from '../../../../lib/whoop/startTicket';
import type { Principal } from '../../../../lib/auth';

/**
 * GET /api/whoop/start
 *
 * The phone opens this in the system authentication session and a browser
 * follows it as a link, so the default answer is a 302 to Whoop. The app asks
 * for `?response=json` instead, because it wants the URL to hand to the auth
 * session itself.
 *
 * The state is minted here, signed, stored, and spent once at the callback. It
 * carries who started the connection, which is how the callback knows whether
 * to come back to `vert://whoop/connected` or to the web settings page.
 *
 * Two ways to prove who is asking. The phone spends the single-use ticket it
 * minted at `/api/whoop/start-token`, because the system browser cannot carry
 * a header. The browser sends its session cookie, and because that cookie is
 * SameSite=Lax a top-level navigation from any site would carry it too, so a
 * cookie-authenticated start must also look like it came from here: this is a
 * GET that mints state and moves the connection to "connecting", and an
 * attacker's page must not be able to trigger it.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A 302 written by hand, because the phone's target is a custom scheme. */
function bounce(target: string): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: { location: target, 'cache-control': 'no-store' },
  });
}

/** The app asks for JSON explicitly; a browser gets the redirect. */
function wantsJson(request: Request, response: string): boolean {
  if (response === 'json') return true;
  const accept = request.headers.get('accept');
  return accept !== null && accept.trim().toLowerCase().startsWith('application/json');
}

export async function GET(request: NextRequest): Promise<Response> {
  const db = database();

  const url = new URL(request.url);
  const parsed = whoopStartQuery.safeParse({
    redirect: url.searchParams.get('redirect') ?? undefined,
    response: url.searchParams.get('response') ?? undefined,
    t: url.searchParams.get(WHOOP_START_TOKEN_PARAM) ?? undefined,
  });
  if (!parsed.success) return badRequest('That start request is not a shape this path takes.');

  const config = env();
  const now = new Date();

  let principal: Principal;
  if (parsed.data.t !== undefined) {
    const deviceId = await spendStartTicket(db, parsed.data.t, config.SESSION_SECRET, now);
    if (deviceId === null) {
      log.warn('whoop.start_ticket_refused', {});
      return fail(401, 'unauthorized', 'That start link has expired. Try Connect again.');
    }
    principal = { kind: 'device', deviceId };
  } else {
    if (isCrossSiteNavigation(request, config.PUBLIC_BASE_URL)) {
      return fail(403, 'wrong_credential', 'Start the connection from the Whoop settings screen.');
    }
    const caller = await guard(db, request, 'either');
    if (!caller.ok) return caller.response;
    principal = caller.principal;
  }
  const kind = principal.kind;
  const deviceId = deviceIdOf(principal);
  const redirect = safeRedirect(parsed.data.redirect, kind, config.PUBLIC_BASE_URL);
  const state = mintState(kind, deviceId, config.SESSION_SECRET, now);

  await db.insert(whoopOauthState).values({
    state,
    principal: kind,
    deviceId,
    redirect,
    createdAt: now,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });

  // A connection that has never been made, or one the owner is repairing,
  // reads as "Finishing connection" while the browser is away. A live one is
  // left alone: an abandoned reconnect must not blank a working link.
  const row = await ensureConnection(db, now);
  if (row.status === 'disconnected' || row.status === 'revoked' || row.status === 'error') {
    await patchConnection(db, { status: 'connecting', lastError: null }, now);
  }

  const target = authorizeUrl({
    clientId: config.WHOOP_CLIENT_ID,
    redirectUri: config.WHOOP_REDIRECT_URI,
    state,
  });

  return wantsJson(request, parsed.data.response) ? json({ url: target, state }) : bounce(target);
}
