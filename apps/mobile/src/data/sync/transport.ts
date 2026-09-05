/**
 * How this app talks to its own server: where it is, what credential it
 * carries, and the one place a response turns into an error.
 *
 * Two credentials exist and they never mix. The phone pairs once and keeps a
 * device secret in expo-secure-store, sent as `Authorization: Bearer`. The web
 * build logs in with the owner's passphrase and keeps an HttpOnly cookie, so
 * it sends `credentials: 'include'` and no header at all. Both are set on
 * every request: on native the cookie flag is inert, on web the header is
 * absent, so there is one code path and no platform branch.
 *
 * Nothing here imports react-native or an expo module at module scope. The
 * platform pieces (expo-secure-store, expo-web-browser) load lazily inside the
 * functions that need them, and both are injectable, so this file and
 * everything built on it run unchanged under vitest in node.
 */

import type { ApiErrorBody, WhoopErrorKind } from './apiContract';
import { WHOOP_START_TOKEN_PARAM } from './apiContract';

/* ------------------------------------------------------------ server url */

/**
 * The configured server, without a trailing slash, or null.
 *
 * Null is a first-class state, not an error: v1 ships with no server, the sync
 * line renders nothing rather than claiming a state it cannot know, and the
 * Whoop screen serves the fixture client.
 */
export function serverUrl(
  value: string | undefined = process.env['EXPO_PUBLIC_SERVER_URL'],
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed === '' ? null : trimmed;
}

export function serverConfigured(value?: string | undefined): boolean {
  return serverUrl(value) !== null;
}

/* ---------------------------------------------------------- credentials */

/** What the phone keeps after pairing. The secret is never shown again. */
export interface DeviceCredentials {
  readonly deviceId: string;
  readonly deviceSecret: string;
}

export interface CredentialStore {
  read(): Promise<DeviceCredentials | null>;
  write(credentials: DeviceCredentials): Promise<void>;
  clear(): Promise<void>;
}

const SECRET_KEY = 'vert.deviceSecret';
const DEVICE_KEY = 'vert.deviceId';

interface KeyValueBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function memoryBackend(): KeyValueBackend {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    },
  };
}

function webBackend(): KeyValueBackend | null {
  // react-native-web only. The passphrase session is the web's real credential;
  // this exists so a browser that did pair (Expo Go on a laptop) still works.
  const storage: Storage | undefined = globalThis.localStorage;
  if (storage === undefined) return null;
  return {
    get: async (key) => storage.getItem(key),
    set: async (key, value) => {
      storage.setItem(key, value);
    },
    remove: async (key) => {
      storage.removeItem(key);
    },
  };
}

async function secureBackend(): Promise<KeyValueBackend | null> {
  try {
    const secure = await import('expo-secure-store');
    // On web every call throws rather than the import, so prove it works once.
    await secure.getItemAsync(SECRET_KEY);
    return {
      get: (key) => secure.getItemAsync(key),
      set: (key, value) => secure.setItemAsync(key, value),
      remove: (key) => secure.deleteItemAsync(key),
    };
  } catch {
    return null;
  }
}

let backendPromise: Promise<KeyValueBackend> | null = null;

/** Secure store where there is one, the browser's storage next, memory last. */
function deviceBackend(): Promise<KeyValueBackend> {
  backendPromise ??= (async () => {
    const secure = await secureBackend();
    return secure ?? webBackend() ?? memoryBackend();
  })();
  return backendPromise;
}

function storeOver(backend: () => Promise<KeyValueBackend>): CredentialStore {
  return {
    async read() {
      try {
        const kv = await backend();
        const [deviceId, deviceSecret] = await Promise.all([kv.get(DEVICE_KEY), kv.get(SECRET_KEY)]);
        if (deviceId === null || deviceSecret === null) return null;
        if (deviceId === '' || deviceSecret === '') return null;
        return { deviceId, deviceSecret };
      } catch {
        return null;
      }
    },
    async write(credentials) {
      const kv = await backend();
      await kv.set(DEVICE_KEY, credentials.deviceId);
      await kv.set(SECRET_KEY, credentials.deviceSecret);
    },
    async clear() {
      try {
        const kv = await backend();
        await kv.remove(DEVICE_KEY);
        await kv.remove(SECRET_KEY);
      } catch {
        // Signing out of a device that never stored a secret is not a failure.
      }
    },
  };
}

let credentialStore: CredentialStore = storeOver(deviceBackend);

/** Swaps the store. Tests pass a memory store; nothing else calls this. */
export function setCredentialStore(store: CredentialStore): void {
  credentialStore = store;
}

/** A memory store, for tests and for the fixture build. */
export function memoryCredentialStore(initial: DeviceCredentials | null = null): CredentialStore {
  let held = initial;
  return {
    read: async () => held,
    write: async (credentials) => {
      held = credentials;
    },
    clear: async () => {
      held = null;
    },
  };
}

export function readCredentials(): Promise<DeviceCredentials | null> {
  return credentialStore.read();
}

export function writeCredentials(credentials: DeviceCredentials): Promise<void> {
  return credentialStore.write(credentials);
}

/** Signing out forgets the pairing. Training data stays on the phone. */
export function clearCredentials(): Promise<void> {
  return credentialStore.clear();
}

/* ---------------------------------------------------------------- errors */

/**
 * One error type for every call to our server, carrying the kind the copy
 * needs ("Rate limited, next sync at 7:02") and the instant to name in it.
 */
export class ApiRequestError extends Error {
  readonly kind: WhoopErrorKind;
  readonly status: number;
  /** ISO instant when the next attempt is allowed, when the server said one. */
  readonly retryAt: string | null;
  readonly body: ApiErrorBody | null;

  constructor(
    kind: WhoopErrorKind,
    message: string,
    status = 0,
    retryAt: string | null = null,
    body: ApiErrorBody | null = null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.kind = kind;
    this.status = status;
    this.retryAt = retryAt;
    this.body = body;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * When the next attempt is allowed.
 *
 * The body wins over the header: `nextRetryAt` is an instant the server has
 * already computed against its own clock, while `Retry-After` is a duration
 * this phone has to add to a clock that may be wrong. A bare number of seconds
 * is still honoured, because a proxy can answer 429 before our handler does.
 */
export function retryAtFrom(
  body: unknown,
  header: string | null,
  now: number = Date.now(),
): string | null {
  if (isRecord(body)) {
    const fromBody = str(body['nextRetryAt']);
    if (fromBody !== null) return fromBody;
    const seconds = body['retryAfterS'];
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
      return new Date(now + seconds * 1000).toISOString();
    }
  }
  if (header === null) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return new Date(now + seconds * 1000).toISOString();
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/* ----------------------------------------------------------------- fetch */

export interface ApiFetchOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  /** Skip the Bearer header. Only /api/pair/claim and /api/login do. */
  readonly anonymous?: boolean;
  readonly signal?: AbortSignal;
}

function withQuery(path: string, query: ApiFetchOptions['query']): string {
  if (query === undefined) return path;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? path : `${path}?${parts.join('&')}`;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorBodyOf(body: unknown): ApiErrorBody | null {
  if (!isRecord(body)) return null;
  const error = str(body['error']);
  if (error === null) return null;
  const retryAfterS = body['retryAfterS'];
  return {
    error,
    message: str(body['message']) ?? error,
    retryAfterS: typeof retryAfterS === 'number' ? retryAfterS : null,
  };
}

/**
 * One request to our server, with whichever credential this build has.
 *
 * Rejects with an `ApiRequestError` for every non-2xx answer and for a network
 * failure, so no caller has to read a status code. The parsed body comes back
 * as `unknown`: every caller has a defensive reader, because the server is a
 * separate deploy and can be a version behind.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<unknown> {
  const base = serverUrl();
  if (base === null) throw new ApiRequestError('network', 'No server is configured.');

  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.anonymous !== true) {
    const credentials = await readCredentials();
    if (credentials !== null) headers['authorization'] = `Bearer ${credentials.deviceSecret}`;
  }

  let response: Response;
  try {
    response = await fetch(`${base}${withQuery(path, options.query)}`, {
      method: options.method ?? 'GET',
      headers,
      // The web build's session cookie. Inert on native.
      credentials: 'include',
      ...(options.body === undefined ? null : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? null : { signal: options.signal }),
    });
  } catch {
    throw new ApiRequestError('network', 'Could not reach the server.');
  }

  const body = await readBody(response);
  if (response.ok) return body;

  const parsed = errorBodyOf(body);
  const retryAt = retryAtFrom(body, response.headers.get('retry-after'));

  if (response.status === 429) {
    throw new ApiRequestError('rate_limited', 'Rate limited.', 429, retryAt, parsed);
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiRequestError(
      'needs_reauth',
      parsed?.message ?? 'This device is no longer paired.',
      response.status,
      retryAt,
      parsed,
    );
  }
  throw new ApiRequestError(
    'api_down',
    parsed?.message ?? `The server answered ${response.status}.`,
    response.status,
    retryAt,
    parsed,
  );
}

/* --------------------------------------------------------- auth sessions */

export type AuthSessionResult = 'success' | 'cancel' | 'error' | 'redirected';

export type AuthSessionOpener = (url: string, redirect: string) => Promise<AuthSessionResult>;

/**
 * Opens a URL in the system authentication session and waits for it to come
 * back to `redirect`, which for Whoop is the app's own scheme.
 *
 * The web has no such session: it navigates the page and the server bounces
 * back to /settings/whoop, so the result there is "redirected" and the caller
 * stops rather than waiting for a return that arrives as a page load.
 */
async function openSystemAuthSession(url: string, redirect: string): Promise<AuthSessionResult> {
  try {
    const browser = await import('expo-web-browser');
    const result = await browser.openAuthSessionAsync(url, redirect);
    if (result.type === 'success') return 'success';
    return 'cancel';
  } catch {
    const location: Location | undefined = globalThis.location;
    if (location !== undefined) {
      location.assign(url);
      return 'redirected';
    }
    return 'error';
  }
}

let authSessionOpener: AuthSessionOpener = openSystemAuthSession;

/** Swaps the opener. Tests pass a stub; nothing else calls this. */
export function setAuthSessionOpener(opener: AuthSessionOpener): void {
  authSessionOpener = opener;
}

export function openAuthSession(url: string, redirect: string): Promise<AuthSessionResult> {
  return authSessionOpener(url, redirect);
}

/**
 * The URL the system authentication session opens.
 *
 * The device secret never travels in a query string, so the phone spends a
 * single-use sixty second ticket instead, minted over an authenticated POST.
 * Without one (the web, where the cookie rides along on its own) the start URL
 * is opened plainly.
 */
export function startUrlWith(
  base: string,
  path: string,
  redirect: string,
  token: string | null,
): string {
  const query = [`redirect=${encodeURIComponent(redirect)}`];
  if (token !== null) query.push(`${WHOOP_START_TOKEN_PARAM}=${encodeURIComponent(token)}`);
  return `${base}${path}?${query.join('&')}`;
}
