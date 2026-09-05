import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API,
  WHOOP_START_TOKEN_PARAM,
  queueRowIdFromOpId,
  syncOpId,
  isSyncOpKind,
} from './apiContract';
import {
  ApiRequestError,
  apiFetch,
  memoryCredentialStore,
  retryAtFrom,
  serverUrl,
  setCredentialStore,
  startUrlWith,
} from './transport';

const SERVER = 'https://vert.example';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

let calls: Call[] = [];

function answer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function respondWith(...responses: Response[]): void {
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(next ?? answer(200, {}));
  });
}

function headerOf(call: Call, name: string): string | undefined {
  const headers = call.init.headers as Record<string, string> | undefined;
  return headers?.[name];
}

beforeEach(() => {
  calls = [];
  process.env['EXPO_PUBLIC_SERVER_URL'] = SERVER;
  setCredentialStore(memoryCredentialStore({ deviceId: 'dev1', deviceSecret: 'sekrit' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['EXPO_PUBLIC_SERVER_URL'];
});

describe('serverUrl', () => {
  it('is null when nothing is configured, and never keeps a trailing slash', () => {
    delete process.env['EXPO_PUBLIC_SERVER_URL'];
    expect(serverUrl(undefined)).toBeNull();
    expect(serverUrl('   ')).toBeNull();
    expect(serverUrl('https://vert.example/')).toBe(SERVER);
    expect(serverUrl('https://vert.example//')).toBe(SERVER);
  });
});

describe('apiFetch credentials', () => {
  it('sends the device secret as a Bearer and the cookie alongside it', async () => {
    respondWith(answer(200, { ok: true }));
    await apiFetch(API.whoopStatus);

    const call = calls[0];
    expect(call?.url).toBe(`${SERVER}${API.whoopStatus}`);
    expect(headerOf(call as Call, 'authorization')).toBe('Bearer sekrit');
    expect(call?.init.credentials).toBe('include');
  });

  it('sends no Bearer when the device has never paired', async () => {
    setCredentialStore(memoryCredentialStore(null));
    respondWith(answer(200, { ok: true }));
    await apiFetch(API.whoopStatus);
    expect(headerOf(calls[0] as Call, 'authorization')).toBeUndefined();
    // The web build's session cookie is the credential there.
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('never sends the secret to the two endpoints that mint one', async () => {
    respondWith(answer(200, { ok: true }));
    await apiFetch(API.pairClaim, { method: 'POST', anonymous: true, body: { code: '123456' } });
    expect(headerOf(calls[0] as Call, 'authorization')).toBeUndefined();
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('builds the query string and skips undefined values', async () => {
    respondWith(answer(200, {}));
    await apiFetch(API.whoopStart, { query: { redirect: 'vert://x y', response: 'json', cursor: undefined } });
    expect(calls[0]?.url).toBe(
      `${SERVER}${API.whoopStart}?redirect=vert%3A%2F%2Fx%20y&response=json`,
    );
  });

  it('refuses to call anything when no server is configured', async () => {
    delete process.env['EXPO_PUBLIC_SERVER_URL'];
    await expect(apiFetch(API.whoopStatus)).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('apiFetch failures', () => {
  it('turns 429 into rate_limited and prefers the body instant over the header', async () => {
    respondWith(
      answer(429, { error: 'rate_limited', message: 'Slow down.', nextRetryAt: '2026-10-22T07:02:00.000Z' }, { 'retry-after': '30' }),
    );
    const error = await apiFetch(API.whoopSync, { method: 'POST' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).kind).toBe('rate_limited');
    expect((error as ApiRequestError).retryAt).toBe('2026-10-22T07:02:00.000Z');
  });

  it('falls back to Retry-After when the body names no instant', async () => {
    respondWith(answer(429, null, { 'retry-after': '60' }));
    const error = (await apiFetch(API.whoopSync, { method: 'POST' }).catch(
      (caught: unknown) => caught,
    )) as ApiRequestError;
    expect(error.retryAt).not.toBeNull();
    expect(Date.parse(error.retryAt as string)).toBeGreaterThan(Date.now() + 50_000);
  });

  it('reads 401 as needing a new pairing, and 500 as the server being unwell', async () => {
    respondWith(answer(401, { error: 'unauthorized', message: 'Pair again.' }));
    const unauthorized = (await apiFetch(API.mirrors).catch((c: unknown) => c)) as ApiRequestError;
    expect(unauthorized.kind).toBe('needs_reauth');
    expect(unauthorized.message).toBe('Pair again.');

    respondWith(answer(500, null));
    const down = (await apiFetch(API.mirrors).catch((c: unknown) => c)) as ApiRequestError;
    expect(down.kind).toBe('api_down');
    expect(down.status).toBe(500);
  });

  it('reads a dropped connection as network, not as the server answering', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const error = (await apiFetch(API.mirrors).catch((c: unknown) => c)) as ApiRequestError;
    expect(error.kind).toBe('network');
    expect(error.status).toBe(0);
  });

  it('accepts a 204 with no body', async () => {
    respondWith(new Response(null, { status: 204 }));
    await expect(apiFetch(API.whoopWebhook, { method: 'POST' })).resolves.toBeNull();
  });
});

describe('retryAtFrom', () => {
  const now = Date.parse('2026-10-22T07:00:00.000Z');

  it('prefers the server instant, then seconds, then the header', () => {
    expect(retryAtFrom({ nextRetryAt: '2026-10-22T07:02:00.000Z' }, '30', now)).toBe(
      '2026-10-22T07:02:00.000Z',
    );
    expect(retryAtFrom({ retryAfterS: 120 }, '30', now)).toBe('2026-10-22T07:02:00.000Z');
    expect(retryAtFrom(null, '120', now)).toBe('2026-10-22T07:02:00.000Z');
    expect(retryAtFrom(null, null, now)).toBeNull();
  });

  it('reads an HTTP date header as well as a duration', () => {
    expect(retryAtFrom(null, 'Thu, 22 Oct 2026 07:02:00 GMT', now)).toBe('2026-10-22T07:02:00.000Z');
    expect(retryAtFrom(null, 'nonsense', now)).toBeNull();
  });
});

describe('start url', () => {
  it('carries the single-use ticket, never the device secret', () => {
    const url = startUrlWith(SERVER, API.whoopStart, 'vert://whoop/connected', 'ticket-123');
    expect(url).toBe(
      `${SERVER}${API.whoopStart}?redirect=vert%3A%2F%2Fwhoop%2Fconnected&${WHOOP_START_TOKEN_PARAM}=ticket-123`,
    );
    expect(url).not.toContain('sekrit');
  });

  it('omits the ticket for the web, whose cookie rides along on its own', () => {
    expect(startUrlWith(SERVER, API.whoopStart, '/settings/whoop', null)).toBe(
      `${SERVER}${API.whoopStart}?redirect=%2Fsettings%2Fwhoop`,
    );
  });
});

describe('op ids', () => {
  it('round-trips the queue row id through the idempotency key', () => {
    expect(syncOpId('dev1', 42)).toBe('dev1:42');
    expect(queueRowIdFromOpId('dev1:42')).toBe(42);
    expect(queueRowIdFromOpId('dev:with:colons:7')).toBe(7);
    expect(queueRowIdFromOpId('nope')).toBeNull();
    expect(queueRowIdFromOpId('dev1:abc')).toBeNull();
  });

  it('knows every kind the app enqueues, including the clearance one', () => {
    expect(isSyncOpKind('athlete.clearance')).toBe(true);
    expect(isSyncOpKind('setLog.upsert')).toBe(true);
    expect(isSyncOpKind('whoop.link')).toBe(true);
    expect(isSyncOpKind('not.a.kind')).toBe(false);
  });
});
