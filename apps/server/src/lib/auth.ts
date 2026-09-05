/**
 * Who is calling: a paired device with a Bearer secret, or the owner's web
 * session cookie. There are no accounts, so "who" is only ever "the owner,
 * from this device" or "the owner, in a browser".
 *
 * Two rules run through the whole file. Only hashes are stored, so a dumped
 * table hands nobody a credential and every comparison goes through
 * `verifySecret`, which is constant time. And the failure counter lives in one
 * Postgres row rather than in the client, so the wait the copy promises is the
 * wait the server actually enforces, whichever surface asked.
 */

import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { LOCKOUT_AFTER, LOCKOUT_SECONDS, SESSION_COOKIE } from './api-contract';
import { hashSecret, randomPairCode, randomSecret, sign, unsign, verifySecret } from './crypto';
import { env } from './env';
import type { Database } from '../db/client';
import { LOGIN_ATTEMPT_ID, deviceSecret, loginAttempt, pairCode } from '../db/tables/account';

export type Principal =
  | { readonly kind: 'device'; readonly deviceId: string }
  | { readonly kind: 'web' };

export interface SessionPayload {
  readonly sub: 'owner';
  /** Seconds since the epoch. */
  readonly exp: number;
  /** When it was minted, in seconds. Compared against `sessions_valid_from`. */
  readonly iat: number;
  /** Random per sign-in, so every login mints a cookie unlike the last one. */
  readonly jti: string;
}

export const SESSION_TTL_S = 30 * 24 * 60 * 60;

/** The Set-Cookie value: httpOnly, SameSite=Lax, secure, path /. */
export function sessionCookie(value: string, maxAgeS: number, secure = true): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeS))}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedSessionCookie(secure = true): string {
  return sessionCookie('', 0, secure);
}

/**
 * A fresh cookie, never an extension of the old one: signing in again rotates
 * the session, so a token that leaked cannot be kept alive by a later login.
 */
export function mintSession(secret: string, now: Date = new Date()): string {
  const payload: SessionPayload = {
    sub: 'owner',
    exp: Math.floor(now.getTime() / 1000) + SESSION_TTL_S,
    iat: Math.floor(now.getTime() / 1000),
    jti: randomSecret(9),
  };
  return sign(JSON.stringify(payload), secret);
}

/** The payload back, or null when the signature is wrong or the time is up. */
export function readSession(
  token: string | undefined,
  secret: string,
  now: Date = new Date(),
): SessionPayload | null {
  if (token === undefined || token === '') return null;
  const raw = unsign(token, secret);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const payload = parsed as Partial<SessionPayload>;
  if (payload.sub !== 'owner' || typeof payload.exp !== 'number') return null;
  if (payload.exp * 1000 <= now.getTime()) return null;
  return {
    sub: 'owner',
    exp: payload.exp,
    iat: typeof payload.iat === 'number' ? payload.iat : 0,
    jti: typeof payload.jti === 'string' ? payload.jti : '',
  };
}

/** The cookie header, split. Returns undefined when this cookie is absent. */
export function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** "Authorization: Bearer <secret>", or undefined. */
export function bearerToken(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/* ------------------------------------------------------------- lockout */

export interface LockoutState {
  readonly failureCount: number;
  readonly lockedUntil: Date | null;
}

/** Whole seconds left on the wait, 0 once it has run out. */
export function lockoutRemainingS(state: LockoutState, now: Date = new Date()): number {
  if (state.lockedUntil === null) return 0;
  return Math.max(0, Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000));
}

export function isLocked(state: LockoutState, now: Date = new Date()): boolean {
  return lockoutRemainingS(state, now) > 0;
}

/** The state after one failure: the fifth in a row starts the 60 s wait. */
export function afterFailure(state: LockoutState, now: Date = new Date()): LockoutState {
  const failureCount = state.failureCount + 1;
  if (failureCount < LOCKOUT_AFTER) return { failureCount, lockedUntil: null };
  return { failureCount, lockedUntil: new Date(now.getTime() + LOCKOUT_SECONDS * 1000) };
}

export const CLEARED_LOCKOUT: LockoutState = { failureCount: 0, lockedUntil: null };

/**
 * The one login_attempt row, read for this instant.
 *
 * A wait that has run out clears the count as well as the wait: the sixth
 * attempt after a served sixty seconds starts a fresh five, it does not lock
 * again immediately.
 */
export async function readLockout(db: Database, now: Date = new Date()): Promise<LockoutState> {
  const rows = await db
    .select()
    .from(loginAttempt)
    .where(eq(loginAttempt.id, LOGIN_ATTEMPT_ID))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return CLEARED_LOCKOUT;
  const state: LockoutState = { failureCount: row.failureCount, lockedUntil: row.lockedUntil };
  if (state.lockedUntil !== null && !isLocked(state, now)) return CLEARED_LOCKOUT;
  return state;
}

/** The counter and the wait, written back to the single row. */
export async function writeLockout(
  db: Database,
  state: LockoutState,
  now: Date = new Date(),
): Promise<void> {
  const lastFailureAt = state.failureCount > 0 ? now : null;
  await db
    .insert(loginAttempt)
    .values({
      id: LOGIN_ATTEMPT_ID,
      failureCount: state.failureCount,
      lockedUntil: state.lockedUntil,
      lastFailureAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: loginAttempt.id,
      set: {
        failureCount: state.failureCount,
        lockedUntil: state.lockedUntil,
        lastFailureAt,
        updatedAt: now,
      },
    });
}

/**
 * One more wrong answer. Returns the seconds to wait, 0 until the fifth.
 *
 * One statement, because a read followed by a write loses updates: twenty
 * guesses racing each other used to leave the counter on one and the lockout
 * never engaged, which made a six digit code brute-forceable inside its ten
 * minute life. The increment, the expiry of a served wait, and the decision to
 * lock all happen inside the same UPDATE, so every guess costs exactly one.
 */
export async function noteFailure(db: Database, now: Date = new Date()): Promise<number> {
  const until = new Date(now.getTime() + LOCKOUT_SECONDS * 1000);
  // A wait that has already run out starts a fresh five rather than locking
  // again on the next attempt, which is the rule readLockout reads by.
  const next = sql`case when ${loginAttempt.lockedUntil} is not null and ${loginAttempt.lockedUntil} <= ${now}
      then 1 else ${loginAttempt.failureCount} + 1 end`;

  const written = await db
    .insert(loginAttempt)
    .values({
      id: LOGIN_ATTEMPT_ID,
      failureCount: 1,
      lockedUntil: LOCKOUT_AFTER <= 1 ? until : null,
      lastFailureAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: loginAttempt.id,
      set: {
        failureCount: next,
        lockedUntil: sql`case when (${next}) >= ${LOCKOUT_AFTER} then ${until}::timestamptz else null end`,
        lastFailureAt: now,
        updatedAt: now,
      },
    })
    .returning({ failureCount: loginAttempt.failureCount, lockedUntil: loginAttempt.lockedUntil });

  const row = written[0];
  if (row === undefined) return 0;
  return lockoutRemainingS({ failureCount: row.failureCount, lockedUntil: row.lockedUntil }, now);
}

/* -------------------------------------------------------- session epoch */

/**
 * Signing out, and any other reason to stop trusting every cookie already out
 * there. There is one owner, so one instant is the whole revocation list.
 */
export async function revokeSessions(db: Database, now: Date = new Date()): Promise<void> {
  await db
    .insert(loginAttempt)
    .values({ id: LOGIN_ATTEMPT_ID, sessionsValidFrom: now, updatedAt: now })
    .onConflictDoUpdate({
      target: loginAttempt.id,
      set: { sessionsValidFrom: now, updatedAt: now },
    });
}

/** Signing in trusts cookies again, starting with the one it just minted. */
export async function allowSessions(db: Database, now: Date = new Date()): Promise<void> {
  await db
    .insert(loginAttempt)
    .values({ id: LOGIN_ATTEMPT_ID, sessionsValidFrom: null, updatedAt: now })
    .onConflictDoUpdate({
      target: loginAttempt.id,
      set: { sessionsValidFrom: null, updatedAt: now },
    });
}

async function sessionsValidFrom(db: Database): Promise<Date | null> {
  const rows = await db
    .select({ from: loginAttempt.sessionsValidFrom })
    .from(loginAttempt)
    .where(eq(loginAttempt.id, LOGIN_ATTEMPT_ID))
    .limit(1);
  return rows[0]?.from ?? null;
}

/** A right answer wipes the count, so five failures always means five in a row. */
export async function clearFailures(db: Database, now: Date = new Date()): Promise<void> {
  await writeLockout(db, CLEARED_LOCKOUT, now);
}

/* ----------------------------------------------------------- principal */

export interface PrincipalOptions {
  readonly now?: Date;
  /** Tests pass their own; production reads SESSION_SECRET. */
  readonly sessionSecret?: string;
}

/**
 * The device the Bearer secret names, or null.
 *
 * The secret is handed out as `<deviceId>.<random>`, so the row is fetched by
 * id and exactly one scrypt runs. It used to be an opaque string, which meant
 * one scrypt per paired device on every request that carried any Authorization
 * header: unauthenticated, uncapped work that blocks the event loop and grows
 * with the number of devices. The id in front of the dot is not a secret and
 * proves nothing on its own; the comparison behind it is still constant time.
 */
export async function deviceForSecret(db: Database, token: string): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const id = token.slice(0, dot);
  const rows = await db
    .select({ id: deviceSecret.id, secretHash: deviceSecret.secretHash })
    .from(deviceSecret)
    .where(and(eq(deviceSecret.id, id), isNull(deviceSecret.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return verifySecret(token, row.secretHash) ? row.id : null;
}

/**
 * The caller from the request headers, or null, which every handler turns into
 * a 401.
 */
export async function principalFor(
  db: Database,
  headers: Headers,
  options: PrincipalOptions = {},
): Promise<Principal | null> {
  const token = bearerToken(headers.get('authorization'));
  if (token !== undefined) {
    const deviceId = await deviceForSecret(db, token);
    return deviceId === null ? null : { kind: 'device', deviceId };
  }

  const cookie = cookieValue(headers.get('cookie'), SESSION_COOKIE);
  if (cookie === undefined) return null;
  const secret = options.sessionSecret ?? env().SESSION_SECRET;
  const now = options.now ?? new Date();
  const payload = readSession(cookie, secret, now);
  if (payload === null) return null;
  // Signing out is a server-side fact, not just a cleared cookie: a token
  // minted before the last sign-out is refused however well it is signed.
  const from = await sessionsValidFrom(db);
  if (from !== null && payload.iat * 1000 < from.getTime()) return null;
  return { kind: 'web' };
}

/* ------------------------------------------------------------- pairing */

/** Long enough to walk to the phone, short enough that a shoulder is not a risk. */
export const PAIR_CODE_TTL_S = 600;

/** How long a spent code is kept so "expired" can still be the honest answer. */
export const PAIR_CODE_SWEEP_GRACE_MS = 60 * 60 * 1000;

export interface MintedPairCode {
  readonly code: string;
  readonly expiresAt: Date;
}

/**
 * A fresh six digit code, and the only live one.
 *
 * Every unclaimed code is retired first, expired or not. Leaving them alive
 * meant every press of "Pair a device" added another six digits to the set a
 * guesser could hit, and an abandoned pairing left its code guessable until
 * the next mint happened to sweep it.
 */
export async function mintPairCode(
  db: Database,
  now: Date = new Date(),
  ttlS: number = PAIR_CODE_TTL_S,
): Promise<MintedPairCode> {
  await db.delete(pairCode).where(isNull(pairCode.claimedAt));

  const expiresAt = new Date(now.getTime() + ttlS * 1000);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomPairCode();
    const written = await db
      .insert(pairCode)
      .values({ code, expiresAt, createdAt: now })
      .onConflictDoNothing()
      .returning({ code: pairCode.code });
    if (written.length > 0) return { code, expiresAt };
  }
  throw new Error('Could not mint an unused pairing code.');
}

export type PairClaimOutcome =
  | {
      readonly ok: true;
      readonly deviceId: string;
      readonly deviceSecret: string;
      readonly pairedAt: Date;
    }
  | {
      readonly ok: false;
      readonly error: 'wrong_code' | 'expired' | 'locked';
      readonly retryAfterS: number;
    };

/**
 * Claim a code once.
 *
 * The claim is an UPDATE guarded on `claimed_at IS NULL`, so two phones racing
 * on the same code produce one pairing and one `wrong_code`, not two devices.
 * An expired code costs one of the five exactly as a wrong one does: answering
 * "expired" for free told a guesser that those six digits had once been a real
 * code, which is a distinction worth nothing to the owner and something to
 * everyone else.
 */
export async function claimPairCode(
  db: Database,
  input: { readonly code: string; readonly deviceName: string },
  now: Date = new Date(),
): Promise<PairClaimOutcome> {
  const locked = await readLockout(db, now);
  if (isLocked(locked, now)) {
    return { ok: false, error: 'locked', retryAfterS: lockoutRemainingS(locked, now) };
  }

  // Swept here as well as on mint, so an abandoned pairing's code does not sit
  // in the table until the owner happens to start another one. An hour of
  // grace, so a code that ran out minutes ago can still answer "expired"
  // rather than "wrong code" to the owner who was slow walking to the phone.
  const grace = new Date(now.getTime() - PAIR_CODE_SWEEP_GRACE_MS);
  await db.delete(pairCode).where(and(lt(pairCode.expiresAt, grace), isNull(pairCode.claimedAt)));

  const rows = await db
    .select()
    .from(pairCode)
    .where(eq(pairCode.code, input.code))
    .limit(1);
  const row = rows[0];

  if (row === undefined || row.claimedAt !== null) {
    return { ok: false, error: 'wrong_code', retryAfterS: await noteFailure(db, now) };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: 'expired', retryAfterS: await noteFailure(db, now) };
  }

  const deviceId = `dev_${randomSecret(9)}`;
  const claimed = await db
    .update(pairCode)
    .set({ claimedAt: now, claimedByDeviceId: deviceId })
    .where(and(eq(pairCode.code, input.code), isNull(pairCode.claimedAt)))
    .returning({ code: pairCode.code });
  if (claimed.length === 0) {
    return { ok: false, error: 'wrong_code', retryAfterS: await noteFailure(db, now) };
  }

  // `<deviceId>.<random>`: the id in front is a lookup key, not a credential,
  // so a bearer costs one scrypt instead of one per paired device.
  const secret = `${deviceId}.${randomSecret(32)}`;
  await db.insert(deviceSecret).values({
    id: deviceId,
    name: input.deviceName,
    secretHash: hashSecret(secret),
    pairedAt: now,
    lastSeenAt: now,
  });
  await clearFailures(db, now);

  return { ok: true, deviceId, deviceSecret: secret, pairedAt: now };
}
