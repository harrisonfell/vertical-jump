/**
 * Pairing: the rules, and the two calls that use them.
 *
 * The web review starts a pairing and shows a one-time six digit code; the
 * phone claims it and keeps the device secret the server hands back once, in
 * expo-secure-store, sent as `Authorization: Bearer` from then on. The web
 * build has no secret: it posts the single-owner passphrase and keeps an
 * HttpOnly session cookie. There are no accounts.
 *
 * Five failures earn a 60 s wait, and the counter that matters is the
 * server's. The constants here mirror it so the screen can count the same wait
 * down when the server has already told it how long is left.
 */

import {
  API,
  LOCKOUT_AFTER as CONTRACT_LOCKOUT_AFTER,
  LOCKOUT_SECONDS as CONTRACT_LOCKOUT_SECONDS,
} from '@/data/sync/apiContract';
import { ApiRequestError, apiFetch, writeCredentials } from '@/data/sync/transport';

/** Failures before the wait, brief section 06 "Pairing". */
export const LOCKOUT_AFTER = CONTRACT_LOCKOUT_AFTER;

/** How long that wait lasts. The screen counts it down and then clears it. */
export const LOCKOUT_SECONDS = CONTRACT_LOCKOUT_SECONDS;

/**
 * Whole seconds left on the wait, 0 once it has run out (and 0 when there is
 * no wait). The screen renders this number, so it never promises a wait that
 * has already expired.
 */
export function lockoutRemaining(lockedUntil: number | null, now: number): number {
  if (lockedUntil === null) return 0;
  return Math.max(0, Math.ceil((lockedUntil - now) / 1000));
}

/** The one-time code is six digits. Nothing else is a code. */
export function isSixDigits(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

export type AttemptOutcome = 'none' | 'invalid' | 'wrong' | 'unreachable';

export interface AttemptState {
  readonly outcome: AttemptOutcome;
  readonly failures: number;
}

export interface AttemptCopy {
  /** The value cannot be a code at all: it is not six digits. */
  readonly invalidCode: string;
  readonly wrongCode: string;
  readonly wrongPassphrase: string;
  /** "Try again in 42 s": built with the seconds actually left. */
  readonly locked: string;
  readonly unreachable: string;
}

/**
 * What the form says after an attempt, or null when it says nothing. The
 * typed value is never cleared: the message sits under the field it belongs
 * to and the athlete edits what is already there.
 */
export function attemptMessage(
  state: AttemptState,
  mode: 'pair' | 'login',
  copy: AttemptCopy,
): string | null {
  if (state.outcome === 'unreachable') return copy.unreachable;
  if (state.outcome === 'invalid') return copy.invalidCode;
  if (state.outcome !== 'wrong') return null;
  if (state.failures >= LOCKOUT_AFTER) return copy.locked;
  return mode === 'pair' ? copy.wrongCode : copy.wrongPassphrase;
}

/* ------------------------------------------------------------- the calls */

/**
 * What one attempt did.
 *
 * `lockedForS` is the server's own arithmetic. The screen counts that down
 * rather than starting its own 60 s from scratch, so a wait that is already
 * half spent is not restarted by closing and reopening the screen.
 */
export interface AttemptResult {
  readonly ok: boolean;
  readonly outcome: AttemptOutcome;
  readonly lockedForS: number | null;
}

const OK: AttemptResult = { ok: true, outcome: 'none', lockedForS: null };

function failure(outcome: AttemptOutcome, lockedForS: number | null = null): AttemptResult {
  return { ok: false, outcome, lockedForS };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Seconds the server says are left, or null when it did not name a wait. */
function lockedFor(error: ApiRequestError): number | null {
  const body = error.body;
  if (body === null) return null;
  if (body.error !== 'locked') return null;
  const seconds = body.retryAfterS;
  return seconds === null ? LOCKOUT_SECONDS : Math.max(0, Math.round(seconds));
}

/** A 401 is a wrong value or a wait; anything else is the server being unwell. */
function readAttemptError(caught: unknown): AttemptResult {
  if (!(caught instanceof ApiRequestError)) return failure('unreachable');
  if (caught.kind === 'network') return failure('unreachable');
  if (caught.status === 401 || caught.status === 403) {
    return failure('wrong', lockedFor(caught));
  }
  return failure('unreachable');
}

/**
 * Claims a pairing code and stores the device secret.
 *
 * The secret comes back exactly once, so it is written before this resolves:
 * a caller that succeeds can assume every later request carries a Bearer.
 */
export async function claimPairing(
  code: string,
  deviceName = 'This device',
): Promise<AttemptResult> {
  if (!isSixDigits(code)) return failure('invalid');
  try {
    const body = await apiFetch(API.pairClaim, {
      method: 'POST',
      anonymous: true,
      body: { code: code.trim(), deviceName: deviceName.slice(0, 64) },
    });
    const record = isRecord(body) ? body : {};
    const deviceSecret = record['deviceSecret'];
    const deviceId = record['deviceId'];
    if (typeof deviceSecret !== 'string' || deviceSecret === '') return failure('unreachable');
    if (typeof deviceId !== 'string' || deviceId === '') return failure('unreachable');
    await writeCredentials({ deviceId, deviceSecret });
    return OK;
  } catch (caught) {
    return readAttemptError(caught);
  }
}

/**
 * The web build's single-owner passphrase. The session is an HttpOnly cookie
 * the server sets, so nothing comes back here to store.
 */
export async function loginWithPassphrase(passphrase: string): Promise<AttemptResult> {
  if (passphrase === '') return failure('wrong');
  try {
    await apiFetch(API.login, { method: 'POST', anonymous: true, body: { passphrase } });
    return OK;
  } catch (caught) {
    return readAttemptError(caught);
  }
}

/** One attempt, whichever screen is asking. */
export function submitCredential(mode: 'pair' | 'login', value: string): Promise<AttemptResult> {
  return mode === 'pair' ? claimPairing(value) : loginWithPassphrase(value);
}
