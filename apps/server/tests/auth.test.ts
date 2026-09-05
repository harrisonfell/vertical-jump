/**
 * Pairing, the passphrase, and the wait.
 *
 * The lockout is the one place a clock changes the answer, so its timing is
 * driven with an injected `now` rather than by waiting: five wrong codes, the
 * sixty seconds, and the sixth attempt after they have been served.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as deviceMe } from '../src/app/api/device/me/route';
import { POST as login } from '../src/app/api/login/route';
import { POST as logout } from '../src/app/api/logout/route';
import { GET as mirrors } from '../src/app/api/mirrors/route';
import { POST as pairClaim } from '../src/app/api/pair/claim/route';
import { POST as pairStart } from '../src/app/api/pair/start/route';
import type { Database } from '../src/db/client';
import { LOCKOUT_SECONDS } from '../src/lib/api-contract';
import { claimPairCode, mintPairCode, readLockout } from '../src/lib/auth';
import { bodyOf, cookieFrom, harness, request, teardown, TEST_PASSPHRASE } from './support/harness';

let db: Database;

// Booting wasm Postgres for the first time in a worker takes a moment, and the
// rest of the suite is running beside it.
beforeEach(async () => {
  db = await harness();
}, 60_000);

afterEach(() => {
  teardown();
});

async function signIn(): Promise<string> {
  const response = await login(request('/api/login', { method: 'POST', body: { passphrase: TEST_PASSPHRASE } }));
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

async function pairAPhone(): Promise<{ deviceId: string; deviceSecret: string; code: string }> {
  const cookie = await signIn();
  const started = await pairStart(request('/api/pair/start', { method: 'POST', cookie }));
  const { code } = await bodyOf<{ code: string }>(started);
  const claimed = await pairClaim(
    request('/api/pair/claim', { method: 'POST', body: { code, deviceName: 'iPhone' } }),
  );
  expect(claimed.status).toBe(200);
  const body = await bodyOf<{ deviceId: string; deviceSecret: string }>(claimed);
  return { ...body, code };
}

describe('pairing', () => {
  it('refuses to mint a code for anyone who is not signed in', async () => {
    const anonymous = await pairStart(request('/api/pair/start', { method: 'POST' }));
    expect(anonymous.status).toBe(401);

    const cookie = await signIn();
    const allowed = await pairStart(request('/api/pair/start', { method: 'POST', cookie }));
    expect(allowed.status).toBe(200);
    const body = await bodyOf<{ code: string; expiresAt: string }>(allowed);
    expect(body.code).toMatch(/^\d{6}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('will not mint a code for a paired phone, only for the web review', async () => {
    const phone = await pairAPhone();
    const response = await pairStart(
      request('/api/pair/start', { method: 'POST', bearer: phone.deviceSecret }),
    );
    expect(response.status).toBe(403);
  });

  it('hands the secret over once and lets it open the paths the cookie opens', async () => {
    const phone = await pairAPhone();

    const me = await deviceMe(request('/api/device/me', { bearer: phone.deviceSecret }));
    expect(me.status).toBe(200);
    const body = await bodyOf<{ deviceId: string; deviceName: string }>(me);
    expect(body).toMatchObject({ deviceId: phone.deviceId, deviceName: 'iPhone' });

    const feed = await mirrors(request('/api/mirrors', { bearer: phone.deviceSecret }));
    expect(feed.status).toBe(200);
  });

  it('refuses a secret that was never issued', async () => {
    await pairAPhone();
    const me = await deviceMe(request('/api/device/me', { bearer: 'not-a-real-secret' }));
    expect(me.status).toBe(401);
  });

  it('lets a code be claimed once and never again', async () => {
    const phone = await pairAPhone();
    const again = await pairClaim(
      request('/api/pair/claim', { method: 'POST', body: { code: phone.code, deviceName: 'iPad' } }),
    );
    expect(again.status).toBe(401);
    expect(await bodyOf<{ error: string }>(again)).toMatchObject({ error: 'wrong_code' });
  });

  it('refuses a body that is not a six digit code', async () => {
    const response = await pairClaim(
      request('/api/pair/claim', { method: 'POST', body: { code: '12', deviceName: 'iPad' } }),
    );
    expect(response.status).toBe(400);
  });
});

describe('the lockout, on an injected clock', () => {
  const t0 = new Date('2026-09-04T18:00:00.000Z');
  const at = (seconds: number): Date => new Date(t0.getTime() + seconds * 1000);

  it('counts five wrong codes, waits sixty seconds, then starts again', async () => {
    const minted = await mintPairCode(db, t0);
    const wrong = minted.code === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const outcome = await claimPairCode(db, { code: wrong, deviceName: 'iPhone' }, at(attempt));
      expect(outcome).toMatchObject({ ok: false, error: 'wrong_code', retryAfterS: 0 });
    }

    const fifth = await claimPairCode(db, { code: wrong, deviceName: 'iPhone' }, at(5));
    expect(fifth).toMatchObject({ ok: false, error: 'wrong_code', retryAfterS: LOCKOUT_SECONDS });

    // Inside the wait, even the right code is refused, and the copy can count
    // down from what the server actually has left.
    const during = await claimPairCode(db, { code: minted.code, deviceName: 'iPhone' }, at(35));
    expect(during).toMatchObject({ ok: false, error: 'locked', retryAfterS: 30 });

    // Once served, the count starts again rather than locking on the next miss.
    const after = await claimPairCode(db, { code: minted.code, deviceName: 'iPhone' }, at(70));
    expect(after.ok).toBe(true);
    expect(await readLockout(db, at(70))).toMatchObject({ failureCount: 0, lockedUntil: null });
  });

  it('counts an expired code against the five, so it is not a free oracle', async () => {
    const minted = await mintPairCode(db, t0, 1);
    const outcome = await claimPairCode(db, { code: minted.code, deviceName: 'iPhone' }, at(5));
    // The owner still reads "expired" rather than "wrong code", because that
    // is the true and useful thing to say, but the guess is not free: an
    // answer that separated "these six digits were once real" from "these six
    // digits never existed" cost a guesser nothing at all.
    expect(outcome).toMatchObject({ ok: false, error: 'expired', retryAfterS: 0 });
    expect(await readLockout(db, at(5))).toMatchObject({ failureCount: 1 });
  });

  it('gives one code to one phone when two race for it', async () => {
    const minted = await mintPairCode(db, t0);
    const [first, second] = await Promise.all([
      claimPairCode(db, { code: minted.code, deviceName: 'iPhone' }, at(1)),
      claimPairCode(db, { code: minted.code, deviceName: 'iPad' }, at(1)),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe('the passphrase', () => {
  it('keeps the counter server-side and names the wait', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await login(
        request('/api/login', { method: 'POST', body: { passphrase: 'wrong' } }),
      );
      expect(response.status).toBe(401);
      expect(await bodyOf<{ error: string; retryAfterS: number }>(response)).toMatchObject({
        error: 'wrong_passphrase',
        retryAfterS: 0,
      });
    }

    const fifth = await login(
      request('/api/login', { method: 'POST', body: { passphrase: 'wrong' } }),
    );
    expect(fifth.status).toBe(401);
    const body = await bodyOf<{ error: string; retryAfterS: number }>(fifth);
    expect(body.error).toBe('locked');
    expect(body.retryAfterS).toBe(LOCKOUT_SECONDS);
    expect(fifth.headers.get('retry-after')).toBe(String(LOCKOUT_SECONDS));

    // The right passphrase during the wait is still refused.
    const during = await login(
      request('/api/login', { method: 'POST', body: { passphrase: TEST_PASSPHRASE } }),
    );
    expect(during.status).toBe(401);
    expect(await bodyOf<{ error: string }>(during)).toMatchObject({ error: 'locked' });
  });

  it('mints an HttpOnly cookie and a new one every time', async () => {
    const first = await login(
      request('/api/login', { method: 'POST', body: { passphrase: TEST_PASSPHRASE } }),
    );
    const header = first.headers.get('set-cookie') ?? '';
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
    expect(header).toContain('Max-Age=2592000');

    const second = await login(
      request('/api/login', { method: 'POST', body: { passphrase: TEST_PASSPHRASE } }),
    );
    expect(cookieFrom(second)).not.toBe(cookieFrom(first));
    expect(await readLockout(db)).toMatchObject({ failureCount: 0 });
  });

  it('signs out by clearing the cookie, whoever asks', async () => {
    const response = await logout(request('/api/logout', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('shuts the door in front of the database after ten tries a minute', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await login(request('/api/login', { method: 'POST', body: { passphrase: 'wrong' } }));
    }
    const blocked = await login(
      request('/api/login', { method: 'POST', body: { passphrase: TEST_PASSPHRASE } }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('refuses a body that is not a passphrase', async () => {
    const response = await login(request('/api/login', { method: 'POST', body: { pass: 1 } }));
    expect(response.status).toBe(400);
  });
});

describe('the guards', () => {
  it('turns away a caller with no credential at all', async () => {
    const response = await mirrors(request('/api/mirrors'));
    expect(response.status).toBe(401);
    expect(await bodyOf<{ error: string }>(response)).toMatchObject({ error: 'unauthorized' });
  });

  it('turns away a cookie signed with the wrong secret', async () => {
    const response = await mirrors(request('/api/mirrors', { cookie: 'vert_session=forged.forged' }));
    expect(response.status).toBe(401);
  });
});
