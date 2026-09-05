import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API,
  memoryCredentialStore,
  readCredentials,
  setCredentialStore,
} from '@/data/sync';
import {
  attemptMessage,
  claimPairing,
  isSixDigits,
  lockoutRemaining,
  loginWithPassphrase,
  LOCKOUT_AFTER,
  LOCKOUT_SECONDS,
} from './pairing';

const COPY = {
  invalidCode: 'invalid',
  wrongCode: 'wrong code',
  wrongPassphrase: 'wrong passphrase',
  locked: 'Try again in 42 s',
  unreachable: 'unreachable',
} as const;

describe('isSixDigits', () => {
  it('takes six digits and nothing else', () => {
    expect(isSixDigits('123456')).toBe(true);
    expect(isSixDigits(' 123456 ')).toBe(true);
    expect(isSixDigits('12345')).toBe(false);
    expect(isSixDigits('12345a')).toBe(false);
  });
});

describe('lockoutRemaining', () => {
  it('is zero with no wait running', () => {
    expect(lockoutRemaining(null, 1_000)).toBe(0);
  });

  it('counts whole seconds down and stops at zero', () => {
    const until = 1_000 + LOCKOUT_SECONDS * 1000;
    expect(lockoutRemaining(until, 1_000)).toBe(LOCKOUT_SECONDS);
    expect(lockoutRemaining(until, 1_000 + 18_400)).toBe(42);
    expect(lockoutRemaining(until, until)).toBe(0);
    expect(lockoutRemaining(until, until + 5_000)).toBe(0);
  });
});

describe('attemptMessage', () => {
  it('names the six-digit rule rather than a wrong code', () => {
    expect(attemptMessage({ outcome: 'invalid', failures: 0 }, 'pair', COPY)).toBe('invalid');
  });

  it('says nothing before an attempt', () => {
    expect(attemptMessage({ outcome: 'none', failures: 3 }, 'login', COPY)).toBeNull();
  });

  it('shows the wait, with its seconds, once the failures reach the limit', () => {
    expect(attemptMessage({ outcome: 'wrong', failures: LOCKOUT_AFTER }, 'login', COPY)).toBe(
      'Try again in 42 s',
    );
  });

  it('drops back to the plain wrong-value line once the count is cleared', () => {
    expect(attemptMessage({ outcome: 'wrong', failures: 0 }, 'login', COPY)).toBe(
      'wrong passphrase',
    );
  });
});

/**
 * The passphrase is the one secret this app ever takes, and it is typed on a
 * laptop that other people can see. Masking lives on the Field, so the only
 * thing that can regress is the screen forgetting to ask for it; a renderer
 * would be a heavy way to catch a missing prop, so the source is read instead.
 */
describe('the login passphrase is masked', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./pairScreen.tsx', import.meta.url)),
    'utf8',
  );

  it('asks the field for secure entry on the web login, not on the pairing code', () => {
    expect(source).toContain("secure={mode === 'login'}");
    expect(source).not.toContain('secure={true}');
  });
});


/* -------------------------------------------------------- the two calls */

const SERVER = 'https://vert.example';

interface Sent {
  readonly url: string;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

let sent: Sent[] = [];

function answers(status: number, body: unknown): void {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    sent.push({
      url,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      headers: (init.headers as Record<string, string> | undefined) ?? {},
    });
    return Promise.resolve(
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

beforeEach(() => {
  sent = [];
  process.env['EXPO_PUBLIC_SERVER_URL'] = SERVER;
  setCredentialStore(memoryCredentialStore(null));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['EXPO_PUBLIC_SERVER_URL'];
});

describe('claimPairing', () => {
  it('refuses a value that cannot be a code without asking the server', async () => {
    answers(200, {});
    const result = await claimPairing('12345');
    expect(result.outcome).toBe('invalid');
    expect(sent).toHaveLength(0);
  });

  it('claims the code and keeps the secret, which is handed over exactly once', async () => {
    answers(200, {
      deviceSecret: 'a'.repeat(43),
      deviceId: 'dev-7',
      pairedAt: '2026-10-22T07:00:00.000Z',
    });

    const result = await claimPairing(' 123456 ', 'iPhone');
    expect(result.ok).toBe(true);
    expect(sent[0]?.url).toBe(`${SERVER}${API.pairClaim}`);
    expect(sent[0]?.body).toEqual({ code: '123456', deviceName: 'iPhone' });
    // The claim itself is the one call with nothing to authenticate with.
    expect(sent[0]?.headers['authorization']).toBeUndefined();

    expect(await readCredentials()).toEqual({ deviceId: 'dev-7', deviceSecret: 'a'.repeat(43) });
  });

  it('reads a wrong code as wrong and stores nothing', async () => {
    answers(401, { error: 'wrong_code', message: 'No.', retryAfterS: 0 });
    const result = await claimPairing('123456');
    expect(result).toEqual({ ok: false, outcome: 'wrong', lockedForS: null });
    expect(await readCredentials()).toBeNull();
  });

  it('carries the remaining seconds the server named, not a fresh 60', async () => {
    answers(401, { error: 'locked', message: 'Wait.', retryAfterS: 42 });
    const result = await claimPairing('123456');
    expect(result.outcome).toBe('wrong');
    expect(result.lockedForS).toBe(42);
  });

  it('falls back to the full wait when the server names no seconds', async () => {
    answers(401, { error: 'locked', message: 'Wait.', retryAfterS: null });
    expect((await claimPairing('123456')).lockedForS).toBe(LOCKOUT_SECONDS);
  });

  it('separates a server that is down from a value that is wrong', async () => {
    answers(500, null);
    expect((await claimPairing('123456')).outcome).toBe('unreachable');

    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect((await claimPairing('123456')).outcome).toBe('unreachable');
  });

  it('treats a response with no secret in it as the server being unwell', async () => {
    answers(200, { deviceId: 'dev-7' });
    expect((await claimPairing('123456')).outcome).toBe('unreachable');
    expect(await readCredentials()).toBeNull();
  });
});

describe('loginWithPassphrase', () => {
  it('posts the passphrase and stores nothing: the session is a cookie', async () => {
    answers(200, { ok: true, expiresAt: '2026-11-21T07:00:00.000Z' });
    const result = await loginWithPassphrase('open sesame');
    expect(result.ok).toBe(true);
    expect(sent[0]?.url).toBe(`${SERVER}${API.login}`);
    expect(sent[0]?.body).toEqual({ passphrase: 'open sesame' });
    expect(await readCredentials()).toBeNull();
  });

  it('reads a wrong passphrase, and its wait, the same way pairing does', async () => {
    answers(401, { error: 'wrong_passphrase', message: 'No.', retryAfterS: 0 });
    expect((await loginWithPassphrase('nope')).outcome).toBe('wrong');

    answers(401, { error: 'locked', message: 'Wait.', retryAfterS: 17 });
    expect((await loginWithPassphrase('nope')).lockedForS).toBe(17);
  });

  it('never sends an empty passphrase', async () => {
    answers(200, {});
    expect((await loginWithPassphrase('')).outcome).toBe('wrong');
    expect(sent).toHaveLength(0);
  });
});

describe('the lockout the screen counts', () => {
  it('agrees with the server contract on both numbers', () => {
    expect(LOCKOUT_AFTER).toBe(5);
    expect(LOCKOUT_SECONDS).toBe(60);
  });
});
