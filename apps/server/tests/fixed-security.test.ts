/**
 * The security probes, kept as the regression suite for what they found.
 *
 * Each `it` was written to pin a hole and is now written to pin the fix, so a
 * change that reopens one of these fails here rather than in production. The
 * comments say what the behaviour used to be, because that is the part a
 * reader cannot see from the code.
 *
 * The whoop-facing probes are in `fixed-security.whoop.test.ts`; both share the
 * sign-in and pairing helpers in `support/security.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { GET as deviceMe } from '../src/app/api/device/me/route';
import { POST as login } from '../src/app/api/login/route';
import { POST as logout } from '../src/app/api/logout/route';
import { GET as mirrors } from '../src/app/api/mirrors/route';
import { POST as pairStart } from '../src/app/api/pair/start/route';
import { GET as whoopCallback } from '../src/app/api/whoop/callback/route';
import { GET as whoopStart } from '../src/app/api/whoop/start/route';
import type { Database } from '../src/db/client';
import { deviceSecret, pairCode } from '../src/db/tables/account';
import { whoopOauthState } from '../src/db/tables/whoop';
import { LOCKOUT_AFTER } from '../src/lib/api-contract';
import { claimPairCode, isLocked, mintPairCode, principalFor, readLockout } from '../src/lib/auth';
import { decryptToken, encryptToken, hashSecret } from '../src/lib/crypto';
import { env, resetEnvCache } from '../src/lib/env';
import { isSecureRequest } from '../src/lib/routes/guard';
import {
  bodyOf,
  harness,
  request,
  teardown,
  TEST_PASSPHRASE,
  TEST_SESSION_SECRET,
} from './support/harness';
import { pairPhone, signIn } from './support/security';

let db: Database;

beforeEach(async () => {
  db = await harness();
}, 60_000);

afterEach(() => {
  teardown();
});


describe('lockout counter', () => {
  it('counts every one of twenty concurrent wrong codes and locks', async () => {
    await mintPairCode(db);

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        claimPairCode(db, { code: String(100000 + index), deviceName: 'attacker' }),
      ),
    );

    expect(outcomes.every((outcome) => !outcome.ok)).toBe(true);
    // The increment used to be a SELECT followed by an UPSERT with no row
    // lock, so twenty racing guesses recorded one failure and the gate never
    // engaged. One statement now does the read, the increment and the decision,
    // so every guess in the batch is counted and the wait is real.
    const state = await readLockout(db);
    expect(state.failureCount).toBeGreaterThanOrEqual(LOCKOUT_AFTER);
    expect(isLocked(state)).toBe(true);

    const next = await claimPairCode(db, { code: '123456', deviceName: 'attacker' });
    expect(next).toMatchObject({ ok: false, error: 'locked' });
  }, 60_000);

  it('locks the passphrase inside one batch of eight wrong guesses', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        login(request('/api/login', { method: 'POST', body: { passphrase: 'not it' } })),
      ),
    );
    const bodies = await Promise.all(responses.map((r) => bodyOf<{ error: string }>(r)));

    expect(bodies.filter((body) => body.error === 'locked').length).toBeGreaterThan(0);
    const state = await readLockout(db);
    expect(state.failureCount).toBeGreaterThanOrEqual(LOCKOUT_AFTER);
    expect(isLocked(state)).toBe(true);
  }, 60_000);

  it('still starts a fresh five once a served wait has run out', async () => {
    const t0 = new Date('2026-09-05T08:00:00.000Z');
    const at = (s: number): Date => new Date(t0.getTime() + s * 1000);
    for (let i = 0; i < LOCKOUT_AFTER; i += 1) {
      await claimPairCode(db, { code: String(200000 + i), deviceName: 'attacker' }, at(i));
    }
    expect(isLocked(await readLockout(db, at(5)), at(5))).toBe(true);
    // Sixty seconds later the count starts again rather than locking on the
    // next miss, which is the rule readLockout has always read by.
    expect(await readLockout(db, at(120))).toMatchObject({ failureCount: 0, lockedUntil: null });
    await claimPairCode(db, { code: '299999', deviceName: 'attacker' }, at(121));
    expect((await readLockout(db, at(121))).failureCount).toBe(1);
  });
});


/* --------------------------------- 4. unauthenticated scrypt amplification */

describe('bearer lookup', () => {
  it('costs one scrypt however many devices are paired', async () => {
    async function timeOne(deviceCount: number): Promise<number> {
      await db.delete(deviceSecret);
      const now = new Date();
      for (let i = 0; i < deviceCount; i += 1) {
        await db.insert(deviceSecret).values({
          id: `dev_${i}`,
          name: `phone ${i}`,
          secretHash: hashSecret(`dev_${i}.secret-${i}`),
          pairedAt: now,
          lastSeenAt: now,
        });
      }
      const headers = new Headers({ authorization: 'Bearer dev_0.definitely-not-the-secret' });
      const started = process.hrtime.bigint();
      const principal = await principalFor(db, headers, { sessionSecret: TEST_SESSION_SECRET });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      expect(principal).toBeNull();
      return elapsedMs;
    }

    const one = await timeOne(1);
    const eight = await timeOne(8);
    // It used to be one scryptSync per paired device, on the event loop, for
    // any request carrying any Authorization header. The secret now names its
    // own row, so the work is flat.
    expect(eight).toBeLessThan(one * 3 + 60);
  }, 60_000);

  it('shuts the door on a run of bogus bearers', async () => {
    const secret = await pairPhone(db);

    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const response = await deviceMe(request('/api/device/me', { bearer: `dev_x.guess-${i}` }));
      statuses.push(response.status);
    }
    // Login and pair/claim had a limiter; every bearer path had none at all.
    expect(statuses).toContain(429);

    // A real device is never counted against that window, so the phone is
    // unaffected by someone else's guessing.
    const mine = await deviceMe(request('/api/device/me', { bearer: secret }));
    expect(mine.status).toBe(200);
  }, 60_000);
});

/* ----------------------------------------- 5. the session cookie and logout */

describe('session cookie', () => {
  it('keeps Secure when a client claims x-forwarded-proto: http on an https request', async () => {
    const downgraded = request('/api/login', {
      method: 'POST',
      body: { passphrase: TEST_PASSPHRASE },
      headers: { 'x-forwarded-proto': 'http' },
    });
    // The URL is https and only a client-settable header said otherwise.
    expect(isSecureRequest(downgraded)).toBe(true);

    const response = await login(downgraded);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
  });

  it('is dead after logout, cookie or no cookie', async () => {
    const cookie = await signIn();
    expect((await mirrors(request('/api/mirrors', { cookie }))).status).toBe(200);

    const bye = await logout(request('/api/logout', { method: 'POST', cookie }));
    expect(bye.status).toBe(200);

    // The token is still perfectly well signed and unexpired. What changed is
    // that the server now records when sessions stopped being trusted, so a
    // copy that leaked cannot be used for the rest of its thirty days.
    expect((await mirrors(request('/api/mirrors', { cookie }))).status).toBe(401);
    const paired = await pairStart(request('/api/pair/start', { method: 'POST', cookie }));
    expect(paired.status).toBe(401);

    // And signing in again works, with a cookie minted after that instant.
    const fresh = await signIn();
    expect((await mirrors(request('/api/mirrors', { cookie: fresh }))).status).toBe(200);
  }, 60_000);

  it('does not let a stranger with no cookie sign the owner out', async () => {
    const cookie = await signIn();
    const bye = await logout(request('/api/logout', { method: 'POST' }));
    expect(bye.status).toBe(200);
    expect((await mirrors(request('/api/mirrors', { cookie }))).status).toBe(200);
  }, 60_000);
});


/* --------------------------------------- 7. what the pairing claim leaks */

describe('pair claim oracle', () => {
  it('charges a failure for an expired code, so it is not a free probe', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const minted = await mintPairCode(db, past, 60);

    const outcome = await claimPairCode(db, { code: minted.code, deviceName: 'attacker' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe('expired');
    // The copy still names the real cause for the owner who was slow, but the
    // guess costs one of the five, so probing for "was this ever a real code"
    // is no cheaper than any other guess.
    expect((await readLockout(db)).failureCount).toBe(1);
  });

  it('keeps one live code, so pressing Pair twice does not widen the space', async () => {
    const first = await mintPairCode(db);
    const second = await mintPairCode(db);
    expect(first.code).not.toBe(second.code);

    const live = await db.select().from(pairCode).where(isNull(pairCode.claimedAt));
    expect(live).toHaveLength(1);
    expect(live[0]?.code).toBe(second.code);

    const stale = await claimPairCode(db, { code: first.code, deviceName: 'phone' });
    expect(stale.ok).toBe(false);
    const claimed = await claimPairCode(db, { code: second.code, deviceName: 'phone' });
    expect(claimed.ok).toBe(true);
  }, 30_000);
});

/* ---------------------------------------------- 8. the environment itself */

describe('environment validation', () => {
  const good = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in good)) delete process.env[key];
    }
    Object.assign(process.env, good);
    resetEnvCache();
  });

  it('refuses a SESSION_SECRET that is 32 characters rather than 32 bytes', () => {
    process.env['SESSION_SECRET'] = 'a-passphrase-of-thirty-two-chars';
    resetEnvCache();
    expect(() => env()).toThrow(/SESSION_SECRET/);
  });

  it('refuses a TOKEN_ENCRYPTION_KEY of the wrong length at startup', () => {
    // It used to be `min(1)`, so a short key passed startup validation and
    // first threw inside a token exchange, at request time.
    process.env['TOKEN_ENCRYPTION_KEY'] = Buffer.alloc(16, 3).toString('base64');
    resetEnvCache();
    expect(() => env()).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it('can still read a token written under the previous key after a rotation', () => {
    const oldKey = Buffer.alloc(32, 3).toString('base64');
    const newKey = Buffer.alloc(32, 9).toString('base64');
    const packed = encryptToken('refresh-token', oldKey);
    // The packed bytes carry a version, so a rotation degrades to a decrypt
    // with the previous key instead of losing every stored token for ever.
    expect(decryptToken(packed, newKey, oldKey)).toBe('refresh-token');
    expect(() => decryptToken(packed, newKey)).toThrow();
  });
});

/* ----------------------------------------------- 9. what holds up (control) */

describe('controls that do hold', () => {
  it('refuses the export with no credential', async () => {
    const { GET: exportRoute } = await import('../src/app/api/export/route');
    const response = await exportRoute(request('/api/export?format=json'));
    expect(response.status).toBe(401);
  });

  it('refuses a forged session cookie signed with the wrong secret', async () => {
    const { sign } = await import('../src/lib/crypto');
    const forged = sign(
      JSON.stringify({ sub: 'owner', exp: Math.floor(Date.now() / 1000) + 3600, jti: 'x' }),
      'the wrong secret',
    );
    const response = await mirrors(request('/api/mirrors', { cookie: `vert_session=${forged}` }));
    expect(response.status).toBe(401);
  });

  it('does not let a pair code be spent twice', async () => {
    const minted = await mintPairCode(db);
    const [first, second] = await Promise.all([
      claimPairCode(db, { code: minted.code, deviceName: 'a' }),
      claimPairCode(db, { code: minted.code, deviceName: 'b' }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
  }, 30_000);

  it('does not take a quote through drizzle into the device name', async () => {
    const minted = await mintPairCode(db);
    const evil = "x'; DROP TABLE device_secret; --";
    const claimed = await claimPairCode(db, { code: minted.code, deviceName: evil });
    expect(claimed.ok).toBe(true);
    const rows = await db.select().from(deviceSecret);
    expect(rows[0]?.name).toBe(evil);
  }, 30_000);

  it('spends an oauth state exactly once', async () => {
    const cookie = await signIn();
    await whoopStart(request('/api/whoop/start', { cookie }));
    const stored = await db.select().from(whoopOauthState);
    const state = stored[0]?.state ?? '';

    const first = await whoopCallback(
      request(`/api/whoop/callback?state=${encodeURIComponent(state)}&error=access_denied`),
    );
    const second = await whoopCallback(
      request(`/api/whoop/callback?state=${encodeURIComponent(state)}&error=access_denied`),
    );
    expect(first.headers.get('location')).not.toContain('bad_state');
    expect(second.headers.get('location')).toContain('bad_state');

    const unspent = await db
      .select()
      .from(whoopOauthState)
      .where(and(eq(whoopOauthState.state, state), isNull(whoopOauthState.usedAt)));
    expect(unspent).toHaveLength(0);
  }, 30_000);
});
