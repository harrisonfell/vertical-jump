/**
 * The one line at the top of every handler that needs a caller.
 *
 * Two credentials, one meaning. `bearer` is the paired phone, `session` is the
 * owner's browser, `either` is anything that proves it is the owner. A path
 * that wants one and is handed the other answers 403 rather than 401, because
 * the caller is known and simply not the one this path is for, and the app's
 * transport treats both as "re-authorise" anyway.
 */

import type { NextResponse } from 'next/server';
import type { Database } from '../../db/client';
import { bearerToken, principalFor, type Principal, type PrincipalOptions } from '../auth';
import { BEARER_FAIL_LIMIT, BEARER_KEY, BEARER_WINDOW_MS, rateLimitStatus, recordAttempt } from './rateLimit';
import { fail } from './respond';

export type Credential = 'session' | 'bearer' | 'either';

/**
 * The window a failed bearer counts against: the device id in front of the
 * dot, which is a lookup key and not a secret. A token that is not even shaped
 * like one shares a single window.
 */
function bearerKey(token: string | undefined): string {
  if (token === undefined) return BEARER_KEY;
  const dot = token.indexOf('.');
  return dot <= 0 ? BEARER_KEY : `${BEARER_KEY}:${token.slice(0, dot)}`;
}

export type Guarded =
  | { readonly ok: true; readonly principal: Principal }
  | { readonly ok: false; readonly response: NextResponse };

export async function guard(
  db: Database,
  request: Request,
  need: Credential,
  options: PrincipalOptions = {},
): Promise<Guarded> {
  // A bearer costs a scrypt, so a run of failures is capped before the work
  // happens rather than after it. Only failures count, and the window is per
  // device id, so a stranger guessing against one id cannot shut a paired
  // phone out of its own server.
  const bearer = bearerToken(request.headers.get('authorization'));
  const key = bearerKey(bearer);
  if (bearer !== undefined) {
    const verdict = rateLimitStatus(key, BEARER_FAIL_LIMIT, BEARER_WINDOW_MS);
    if (!verdict.ok) {
      return {
        ok: false,
        response: fail(429, 'rate_limited', 'Too many attempts. Wait a moment.', verdict.retryAfterS),
      };
    }
  }

  const principal = await principalFor(db, request.headers, options);
  if (principal === null) {
    if (bearer !== undefined) recordAttempt(key, BEARER_WINDOW_MS);
    return {
      ok: false,
      response: fail(401, 'unauthorized', 'Pair this device, or sign in on the web.'),
    };
  }
  if (need === 'bearer' && principal.kind !== 'device') {
    return { ok: false, response: fail(403, 'wrong_credential', 'This needs the paired app.') };
  }
  if (need === 'session' && principal.kind !== 'web') {
    return {
      ok: false,
      response: fail(403, 'wrong_credential', 'This needs the web review, signed in.'),
    };
  }
  return { ok: true, principal };
}

/** The device id when the caller is a phone, null when it is the browser. */
export function deviceIdOf(principal: Principal): string | null {
  return principal.kind === 'device' ? principal.deviceId : null;
}

/** Where an op pushed by this caller came from. */
export function originOf(principal: Principal): 'device' | 'web' {
  return principal.kind === 'device' ? 'device' : 'web';
}

/**
 * Https behind Vercel's proxy, http on a local machine: the cookie follows.
 *
 * The request's own scheme decides first. `x-forwarded-proto` is a request
 * header a client can set, and trusting it ahead of the scheme let a caller
 * send `x-forwarded-proto: http` on an https request and be handed a session
 * cookie without `Secure`. It is consulted only when the URL itself is http,
 * which is the local-development case, and only a loopback host is allowed to
 * end up insecure.
 */
export function isSecureRequest(request: Request): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return true;
  }
  if (url.protocol === 'https:') return true;
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded !== null && forwarded.split(',')[0]?.trim() === 'https') return true;
  return url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '[::1]';
}

/**
 * Whether a state-changing GET was navigated to from somewhere else.
 *
 * `/api/whoop/start` is a GET the phone opens in the system browser, so it
 * cannot carry a header or a body, and the session cookie is SameSite=Lax,
 * which a browser attaches to a top-level navigation from any site. Without
 * this an attacker's page could force a Whoop reconnect on the owner's session
 * and choose where the callback lands. `Sec-Fetch-Site` is set by every
 * browser that would attach the cookie; a request without it (curl, the app's
 * own auth session) never had a cookie to abuse.
 */
export function isCrossSiteNavigation(request: Request, baseUrl: string): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
    return true;
  }
  const origin = request.headers.get('origin');
  if (origin === null || origin === 'null') return false;
  try {
    return new URL(origin).origin !== new URL(baseUrl).origin;
  } catch {
    return true;
  }
}
