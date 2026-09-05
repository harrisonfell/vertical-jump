import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API,
  WHOOP_START_TOKEN_PARAM,
  memoryCredentialStore,
  setAuthSessionOpener,
  setCredentialStore,
  type AuthSessionResult,
} from '@/data/sync';
import { WHOOP_APP_REDIRECT, WhoopClientError, createServerClient, readSync } from './client';

/**
 * The server client against a stubbed server.
 *
 * Two things matter here beyond the paths: the device secret must reach every
 * call as a Bearer, and it must never reach the URL the system browser opens.
 */

const SERVER = 'https://vert.example';
const SECRET = 'super-secret-device-key';

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | undefined;
}

let sent: Sent[] = [];
let opened: { url: string; redirect: string }[] = [];

function serve(table: Readonly<Record<string, unknown>>, status = 200): void {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const path = url.slice(SERVER.length).split('?')[0] ?? '';
    const headers = init.headers as Record<string, string> | undefined;
    sent.push({ url, method: init.method ?? 'GET', authorization: headers?.['authorization'] });
    const body = table[path] ?? {};
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

function opensWith(result: AuthSessionResult): void {
  setAuthSessionOpener((url, redirect) => {
    opened.push({ url, redirect });
    return Promise.resolve(result);
  });
}

const CONNECTED = {
  status: 'connected',
  whoopUserId: 'whoop-1',
  connectedAt: '2026-10-22T07:00:00.000Z',
  lastSyncAt: '2026-10-22T07:01:00.000Z',
  backfillDaysDone: 88,
  backfillDaysTotal: 90,
  lastError: null,
  nextRetryAt: null,
};

beforeEach(() => {
  sent = [];
  opened = [];
  process.env['EXPO_PUBLIC_SERVER_URL'] = SERVER;
  setCredentialStore(memoryCredentialStore({ deviceId: 'dev-1', deviceSecret: SECRET }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['EXPO_PUBLIC_SERVER_URL'];
});

describe('the paths the client calls', () => {
  it('asks for JSON from the start endpoint, which is a redirect by default', async () => {
    serve({ [API.whoopStart]: { url: 'https://api.prod.whoop.com/oauth/oauth2/auth?x=1', state: 'abcdefgh' } });
    const start = await createServerClient().start(WHOOP_APP_REDIRECT);
    expect(start.state).toBe('abcdefgh');
    expect(sent[0]?.url).toContain('response=json');
    expect(sent[0]?.url).toContain(`redirect=${encodeURIComponent(WHOOP_APP_REDIRECT)}`);
  });

  it('carries the Bearer on status, sync, disconnect and revoke', async () => {
    serve({
      [API.whoopStatus]: CONNECTED,
      [API.whoopSync]: { ...CONNECTED, daysImported: 2, imported: 9, nextCursor: null, done: true },
      [API.whoopDisconnect]: { ...CONNECTED, status: 'disconnected' },
      [API.whoopRevoke]: { ...CONNECTED, status: 'revoked' },
    });
    const client = createServerClient();
    await client.status();
    await client.sync();
    await client.disconnect();
    await client.revoke();

    expect(sent.map((entry) => entry.url.slice(SERVER.length))).toEqual([
      API.whoopStatus,
      API.whoopSync,
      API.whoopDisconnect,
      API.whoopRevoke,
    ]);
    expect(sent.map((entry) => entry.method)).toEqual(['GET', 'POST', 'POST', 'POST']);
    for (const entry of sent) expect(entry.authorization).toBe(`Bearer ${SECRET}`);
  });

  it('reads the sync payload the server documents, not only the day count', async () => {
    const parsed = readSync({
      ...CONNECTED,
      status: 'importing',
      daysImported: 10,
      imported: 41,
      nextCursor: 'page-2',
      done: false,
    });
    expect(parsed.status).toBe('importing');
    expect(parsed.imported).toBe(41);
    expect(parsed.nextCursor).toBe('page-2');
    expect(parsed.done).toBe(false);
  });
});

describe('connect', () => {
  it('spends a one-time ticket so the device secret never rides the URL', async () => {
    serve({
      [API.whoopStartToken]: { token: 'ticket-abcdef123456', expiresAt: '2026-10-22T07:01:00.000Z' },
      [API.whoopStatus]: CONNECTED,
    });
    opensWith('success');

    const result = await createServerClient().connect(WHOOP_APP_REDIRECT);
    expect(result.outcome).toBe('connected');
    expect(result.status.status).toBe('connected');

    expect(sent[0]?.url.slice(SERVER.length)).toBe(API.whoopStartToken);
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.authorization).toBe(`Bearer ${SECRET}`);

    const url = opened[0]?.url ?? '';
    expect(url.startsWith(`${SERVER}${API.whoopStart}?`)).toBe(true);
    expect(url).toContain(`${WHOOP_START_TOKEN_PARAM}=ticket-abcdef123456`);
    expect(url).not.toContain(SECRET);
    expect(opened[0]?.redirect).toBe(WHOOP_APP_REDIRECT);
  });

  it('opens the start URL without a ticket when there is no device secret', async () => {
    setCredentialStore(memoryCredentialStore(null));
    serve({ [API.whoopStatus]: { ...CONNECTED, status: 'connecting' } });
    opensWith('redirected');

    const result = await createServerClient().connect('/settings/whoop');
    expect(result.outcome).toBe('redirected');
    expect(sent.some((entry) => entry.url.includes(API.whoopStartToken))).toBe(false);
    expect(opened[0]?.url).not.toContain(`&${WHOOP_START_TOKEN_PARAM}=`);
  });

  it('reports a cancelled session without changing anything', async () => {
    serve({
      [API.whoopStartToken]: { token: 'ticket-abcdef123456', expiresAt: '2026-10-22T07:01:00.000Z' },
      [API.whoopStatus]: { ...CONNECTED, status: 'disconnected', whoopUserId: null },
    });
    opensWith('cancel');

    const result = await createServerClient().connect(WHOOP_APP_REDIRECT);
    expect(result.outcome).toBe('cancelled');
    expect(result.status.status).toBe('disconnected');
  });

  it('refuses to open anything when the server hands back no ticket', async () => {
    serve({ [API.whoopStartToken]: { expiresAt: '2026-10-22T07:01:00.000Z' } });
    opensWith('success');
    await expect(createServerClient().connect(WHOOP_APP_REDIRECT)).rejects.toBeInstanceOf(
      WhoopClientError,
    );
    expect(opened).toHaveLength(0);
  });
});

describe('failures the copy names', () => {
  it('turns a 429 into rate_limited with the instant the server gave', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: 'rate_limited', message: 'Slow down.', nextRetryAt: '2026-10-22T07:02:00.000Z' }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const error = (await createServerClient()
      .sync()
      .catch((caught: unknown) => caught)) as WhoopClientError;
    expect(error).toBeInstanceOf(WhoopClientError);
    expect(error.kind).toBe('rate_limited');
    expect(error.retryAt).toBe('2026-10-22T07:02:00.000Z');
  });

  it('turns a 401 into needs_reauth and a dropped connection into network', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })),
    );
    const reauth = (await createServerClient()
      .status()
      .catch((caught: unknown) => caught)) as WhoopClientError;
    expect(reauth.kind).toBe('needs_reauth');

    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const offline = (await createServerClient()
      .status()
      .catch((caught: unknown) => caught)) as WhoopClientError;
    expect(offline.kind).toBe('network');
  });
});
