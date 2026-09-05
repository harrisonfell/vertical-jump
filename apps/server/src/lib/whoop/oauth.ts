/**
 * The OAuth handshake, minus the tokens.
 *
 * The phone never holds a Whoop token: it opens this server's start URL in the
 * system authentication session, Whoop redirects to the server's https
 * callback, and the server bounces back to `vert://whoop/connected`. So the
 * only thing that has to survive the round trip is the state, which is an HMAC
 * over the caller and a nonce with a ten minute life. It is also stored, so it
 * can be spent exactly once.
 *
 * Whoop requires the state to be at least 8 characters and does not support
 * PKCE, which is why the state carries the whole job of binding the callback
 * to the caller who started it.
 */

import { z } from 'zod';
import { randomSecret, sign, unsign } from '../crypto';
import { APP_CONNECTED_REDIRECT, WEB_CONNECTED_REDIRECT } from '../api-contract';
import { WHOOP_AUTH_URL, WHOOP_SCOPE_STRING } from './api';

/** Long enough to finish a login, short enough that a leaked URL is dead. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Brief section 06: what the screen says when the owner backs out of Whoop. */
export const CONNECTION_CANCELLED_MESSAGE = 'Connection cancelled, nothing changed.';

export type CallerKind = 'device' | 'web';

/** The only custom scheme a redirect may name: the app's own. */
const APP_SCHEME = 'vert://';

const statePayload = z.object({
  /** Who asked: the phone, or the browser. */
  p: z.enum(['device', 'web']),
  /** Which paired device, when it was the phone. */
  d: z.string().nullable(),
  /** Nonce, so two starts from the same caller never collide. */
  n: z.string().min(8),
  /** Seconds since the epoch. */
  exp: z.number().int().positive(),
});

export type StatePayload = z.infer<typeof statePayload>;

/** "<payload>.<hmac>", at least 8 characters by a wide margin. */
export function mintState(
  caller: CallerKind,
  deviceId: string | null,
  secret: string,
  now: Date = new Date(),
): string {
  const payload: StatePayload = {
    p: caller,
    d: deviceId,
    n: randomSecret(12),
    exp: Math.floor((now.getTime() + STATE_TTL_MS) / 1000),
  };
  return sign(JSON.stringify(payload), secret);
}

/** The payload back, or null when the signature is wrong or the time is up. */
export function readState(
  state: string,
  secret: string,
  now: Date = new Date(),
): StatePayload | null {
  const raw = unsign(state, secret);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const result = statePayload.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.exp * 1000 <= now.getTime()) return null;
  return result.data;
}

/** Where Whoop sends the owner to say yes. */
export function authorizeUrl(options: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
}): string {
  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('scope', WHOOP_SCOPE_STRING);
  url.searchParams.set('state', options.state);
  return url.toString();
}

/** A base to resolve a path against. Only its origin is ever compared. */
const RELATIVE_BASE = 'https://redirect.invalid';

/** Backslashes and control characters: a browser folds the first into a slash. */
function hasHostileCharacter(raw: string): boolean {
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Where the callback is allowed to land: the app's own scheme, or a path on
 * this server. Anything else is refused and replaced with the caller's default,
 * because a redirect parameter that accepts any URL is an open redirect.
 *
 * "Starts with a slash and not two" is not enough. `/\evil.example` passes
 * that reading and every browser's URL parser folds the backslash into a
 * slash, so the browser resolves it to `https://evil.example`. The candidate is
 * therefore resolved the way a browser would and kept only when it still names
 * this origin.
 */
export function safeRedirect(
  raw: string | undefined,
  caller: CallerKind,
  base: string = RELATIVE_BASE,
): string {
  const fallback = caller === 'device' ? APP_CONNECTED_REDIRECT : WEB_CONNECTED_REDIRECT;
  if (raw === undefined || raw === '') return fallback;
  if (hasHostileCharacter(raw)) return fallback;
  if (raw.startsWith(APP_SCHEME)) return raw;
  if (!raw.startsWith('/')) return fallback;
  try {
    const resolved = new URL(raw, base);
    if (resolved.origin !== new URL(base).origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}

/** Appends query parameters to a custom scheme URL or a path, without parsing it. */
export function withParams(target: string, params: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams(params).toString();
  if (query === '') return target;
  return `${target}${target.includes('?') ? '&' : '?'}${query}`;
}
