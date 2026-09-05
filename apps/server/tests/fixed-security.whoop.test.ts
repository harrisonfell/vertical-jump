/**
 * The whoop-facing security probes, kept as the regression suite for what they
 * found: the open redirect, the CSRF GET, the phone's single-use start ticket,
 * and webhook freshness.
 *
 * Each `it` was written to pin a hole and is now written to pin the fix. The
 * rest of the probes are in `fixed-security.test.ts`; both share the sign-in
 * and pairing helpers in `support/security.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as whoopCallback } from '../src/app/api/whoop/callback/route';
import { GET as whoopStart } from '../src/app/api/whoop/start/route';
import { POST as whoopStartToken } from '../src/app/api/whoop/start-token/route';
import type { Database } from '../src/db/client';
import { whoopConnection, whoopOauthState } from '../src/db/tables/whoop';
import { whoopSignature } from '../src/lib/crypto';
import { safeRedirect } from '../src/lib/whoop/oauth';
import { verifyWebhook } from '../src/lib/whoop/webhook';
import { bodyOf, harness, request, teardown } from './support/harness';
import { pairPhone, signIn } from './support/security';

let db: Database;

beforeEach(async () => {
  db = await harness();
}, 60_000);

afterEach(() => {
  teardown();
});

/* ------------------------------------- 2. open redirect and the CSRF GET */

describe('whoop start and callback', () => {
  it('refuses a backslash redirect, which a browser would resolve off-site', () => {
    const hostile = '/\\evil.example';
    // WHATWG URL folds "\" into "/" for special schemes, so "starts with a
    // slash and not two" used to let this through and the browser resolved the
    // relative Location to https://evil.example.
    expect(new URL(hostile, 'https://vert.test').origin).toBe('https://evil.example');
    expect(safeRedirect(hostile, 'web')).toBe('/settings/whoop?connected=1');
    expect(safeRedirect('//evil.example', 'web')).toBe('/settings/whoop?connected=1');
    expect(safeRedirect('https://evil.example', 'web')).toBe('/settings/whoop?connected=1');
    expect(safeRedirect('/settings/whoop?connected=1', 'web')).toBe('/settings/whoop?connected=1');
    expect(safeRedirect('vert://whoop/connected', 'device')).toBe('vert://whoop/connected');
  });

  it('refuses a cross-site top-level GET and changes nothing', async () => {
    const cookie = await signIn();

    // What a link or window.open from evil.example produces: a top-level
    // navigation, with the SameSite=Lax cookie attached and no token of any
    // kind. It used to mint state, store the attacker's redirect and move the
    // connection to "connecting".
    const response = await whoopStart(
      request('/api/whoop/start?redirect=%2F%5Cevil.example', {
        cookie,
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(response.status).toBe(403);
    expect(await db.select().from(whoopOauthState)).toHaveLength(0);
    expect(await db.select().from(whoopConnection)).toHaveLength(0);
  });

  it('still lets the owner start a connection from the settings screen', async () => {
    const cookie = await signIn();
    const response = await whoopStart(
      request('/api/whoop/start', { cookie, headers: { 'sec-fetch-site': 'same-origin' } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('api.prod.whoop.com');
    expect(await db.select().from(whoopOauthState)).toHaveLength(1);
  });

  it('stores only a redirect that stays on this origin', async () => {
    const cookie = await signIn();
    await whoopStart(
      request('/api/whoop/start?redirect=%2F%5Cevil.example', {
        cookie,
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
    );
    const stored = await db.select().from(whoopOauthState);
    expect(stored[0]?.redirect).toBe('/settings/whoop?connected=1');

    const state = stored[0]?.state ?? '';
    const response = await whoopCallback(
      request(`/api/whoop/callback?state=${encodeURIComponent(state)}&error=access_denied`),
    );
    const location = response.headers.get('location') ?? '';
    expect(new URL(location, 'https://vert.test').origin).toBe('https://vert.test');
  });
});

/* ------------------------------------------- 3. the phone's start ticket */

describe('the whoop start ticket', () => {
  it('mints a ticket for a paired phone and spends it exactly once', async () => {
    const secret = await pairPhone(db);

    const minted = await whoopStartToken(request('/api/whoop/start-token', { method: 'POST', bearer: secret }));
    expect(minted.status).toBe(200);
    const ticket = await bodyOf<{ token: string; expiresAt: string }>(minted);
    expect(ticket.token.length).toBeGreaterThan(16);

    // The system browser carries no Authorization header, so the ticket is the
    // whole credential. Before this route existed the app could not connect at
    // all: connect() called it first and got a 404.
    const first = await whoopStart(
      request(`/api/whoop/start?response=json&t=${encodeURIComponent(ticket.token)}`),
    );
    expect(first.status).toBe(200);
    const body = await bodyOf<{ url: string; state: string }>(first);
    expect(body.url).toContain('api.prod.whoop.com');
    expect(body.state.length).toBeGreaterThanOrEqual(8);

    const stored = await db.select().from(whoopOauthState);
    expect(stored[0]?.principal).toBe('device');
    expect(stored[0]?.redirect).toBe('vert://whoop/connected');

    const second = await whoopStart(
      request(`/api/whoop/start?response=json&t=${encodeURIComponent(ticket.token)}`),
    );
    expect(second.status).toBe(401);
  }, 60_000);

  it('refuses a ticket nobody minted', async () => {
    const response = await whoopStart(request('/api/whoop/start?response=json&t=not-a-real-ticket-at-all'));
    expect(response.status).toBe(401);
  });

  it('will not mint a ticket for a browser session', async () => {
    const cookie = await signIn();
    const response = await whoopStartToken(request('/api/whoop/start-token', { method: 'POST', cookie }));
    expect(response.status).toBe(403);
  });
});
/* ------------------------------------------------ 6. webhook freshness */

describe('whoop webhook', () => {
  const secret = 'test-secret';
  const body = '{"user_id":1,"id":"abc","type":"recovery.updated","trace_id":"t1"}';

  it('refuses a delivery whose timestamp is not a whole number of milliseconds', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    // The guard used to read "if this is finite and too old, refuse", so
    // "1e999" and "not-a-number" stepped over the freshness check entirely and
    // left the signature as the only control on the one public POST route.
    for (const timestamp of ['1e999', 'not-a-number', 'Infinity', '12345678901234567890n', '']) {
      const headers = new Headers({
        'x-whoop-signature': whoopSignature(timestamp, body, secret),
        'x-whoop-signature-timestamp': timestamp,
      });
      expect(verifyWebhook(body, headers, secret, now).reason).toBe('stale');
    }

    const old = String(now.getTime() - 10 * 60 * 1000);
    expect(
      verifyWebhook(
        body,
        new Headers({
          'x-whoop-signature': whoopSignature(old, body, secret),
          'x-whoop-signature-timestamp': old,
        }),
        secret,
        now,
      ).reason,
    ).toBe('stale');

    const fresh = String(now.getTime());
    expect(
      verifyWebhook(
        body,
        new Headers({
          'x-whoop-signature': whoopSignature(fresh, body, secret),
          'x-whoop-signature-timestamp': fresh,
        }),
        secret,
        now,
      ),
    ).toEqual({ ok: true, reason: 'ok' });
  });

  it('refuses a missing header and a wrong encoding, as it always did', () => {
    const now = new Date();
    const timestamp = String(now.getTime());
    const good = whoopSignature(timestamp, body, secret);

    expect(verifyWebhook(body, new Headers(), secret, now).reason).toBe('missing_headers');
    expect(
      verifyWebhook(
        body,
        new Headers({
          'x-whoop-signature': Buffer.from(good, 'base64').toString('hex'),
          'x-whoop-signature-timestamp': timestamp,
        }),
        secret,
        now,
      ).reason,
    ).toBe('bad_signature');
    expect(
      verifyWebhook(
        body,
        new Headers({
          'x-whoop-signature': whoopSignature('', body, secret),
          'x-whoop-signature-timestamp': timestamp,
        }),
        secret,
        now,
      ).reason,
    ).toBe('bad_signature');
  });
});
