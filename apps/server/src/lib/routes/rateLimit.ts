/**
 * A small in-memory limiter for the two guessable paths, login and pair claim.
 *
 * It is not the lockout: the lockout is the owner-facing five failures and
 * sixty seconds, counted in Postgres and shown in the copy. This is the cheap
 * shield in front of it, so a script cannot spend the database's time at all.
 * Per instance and lossy on a cold start, which is the honest limit of a
 * serverless function and still enough for one owner.
 */

const hits = new Map<string, number[]>();

export interface RateLimitVerdict {
  readonly ok: boolean;
  /** Whole seconds until the oldest hit in the window falls out of it. */
  readonly retryAfterS: number;
}

/** Login: ten attempts a minute is far more than a person types. */
export const LOGIN_LIMIT = 10;
export const LOGIN_WINDOW_MS = 60_000;

/**
 * Failed Bearer lookups. Every bearer path used to have no brake at all, so an
 * attacker with no credential could spend the server's scrypt time on
 * /api/device/me, /api/mirrors, /api/sync/push and every Whoop route. Only
 * failures are counted, so a paired phone never meets this.
 */
export const BEARER_FAIL_LIMIT = 20;
export const BEARER_WINDOW_MS = 60_000;
export const BEARER_KEY = 'bearer.fail';

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitVerdict {
  const since = now - windowMs;
  const kept = (hits.get(key) ?? []).filter((at) => at > since);

  if (kept.length >= limit) {
    hits.set(key, kept);
    const oldest = kept[0] ?? now;
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }

  kept.push(now);
  hits.set(key, kept);
  return { ok: true, retryAfterS: 0 };
}

/** The verdict without spending a hit: the check before expensive work. */
export function rateLimitStatus(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitVerdict {
  const since = now - windowMs;
  const kept = (hits.get(key) ?? []).filter((at) => at > since);
  if (kept.length < limit) return { ok: true, retryAfterS: 0 };
  hits.set(key, kept);
  const oldest = kept[0] ?? now;
  return { ok: false, retryAfterS: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
}

/** One hit against a key, with no verdict. Used to count failures only. */
export function recordAttempt(key: string, windowMs: number, now: number = Date.now()): void {
  const since = now - windowMs;
  const kept = (hits.get(key) ?? []).filter((at) => at > since);
  kept.push(now);
  hits.set(key, kept);
}

/** Between tests, and whenever a fresh instance is wanted. */
export function resetRateLimits(): void {
  hits.clear();
}
