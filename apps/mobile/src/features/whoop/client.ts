/**
 * The typed client for the Whoop server.
 *
 * The app never holds a Whoop token (brief section 07 "Whoop connect on the
 * phone"): it opens the server's start URL in the system authentication
 * session, the server exchanges the code and stores the tokens, and the app
 * only ever asks the server what state the connection is in. So this file has
 * no OAuth in it, only six calls and the credential the server expects.
 *
 * That credential never rides a URL. `openAuthSessionAsync` hands the URL to
 * the operating system's browser, which cannot be given an Authorization
 * header, so the phone spends a single-use sixty second ticket from
 * `POST /api/whoop/start-token` instead and the device secret stays in
 * expo-secure-store. The web build has a session cookie and needs no ticket.
 *
 * `EXPO_PUBLIC_SERVER_URL` is unset in v1, which is a first-class state, not
 * an error: `createWhoopClient` then returns the fixture client, which serves
 * the mirrors already in the local database and lets the dev selector walk
 * every state in brief section 06 without a server.
 */

import {
  API,
  APP_CONNECTED_REDIRECT,
  type WhoopErrorKind,
  type WhoopStatus,
} from '@/data/sync/apiContract';
import {
  ApiRequestError,
  apiFetch,
  openAuthSession,
  readCredentials,
  serverUrl,
  startUrlWith,
} from '@/data/sync/transport';

export { serverUrl };
export type { WhoopErrorKind, WhoopStatus };

/** Where the server bounces back to after a successful exchange. */
export const WHOOP_APP_REDIRECT = APP_CONNECTED_REDIRECT;

/** What the server reports, and what the fixture client simulates. */
export interface WhoopStatusResponse {
  readonly status: WhoopStatus;
  readonly whoopUserId: string | null;
  readonly connectedAt: string | null;
  readonly lastSyncAt: string | null;
  /** Backfill progress. 90 days, chunked and resumable. */
  readonly backfillDaysDone: number;
  readonly backfillDaysTotal: number;
  /** Set when the API is down or rate limited. */
  readonly lastError: WhoopErrorKind | null;
  /** When the next automatic attempt runs. */
  readonly nextRetryAt: string | null;
}

export interface WhoopStartResponse {
  /** The URL to open in the system authentication session. */
  readonly url: string;
  /** The OAuth state, at least 8 characters, minted server-side. */
  readonly state: string;
}

export interface WhoopSyncResponse extends WhoopStatusResponse {
  /** Days written by this sync. */
  readonly daysImported: number;
  /** Records written by this sync. */
  readonly imported: number;
  /** Where the next chunk resumes, or null when the backfill is done. */
  readonly nextCursor: string | null;
  readonly done: boolean;
}

/** What the athlete did with the authentication session. */
export type WhoopConnectOutcome = 'connected' | 'cancelled' | 'redirected';

export interface WhoopConnectResult {
  readonly outcome: WhoopConnectOutcome;
  readonly status: WhoopStatusResponse;
}

export interface WhoopClient {
  readonly kind: 'server' | 'fixture';
  /** Whether a server is configured at all. False turns the section to copy. */
  readonly configured: boolean;
  /**
   * The whole connect flow: mint the ticket, open the system authentication
   * session, and read the state the server ended up in.
   */
  connect(redirect?: string): Promise<WhoopConnectResult>;
  /** The start URL and its state, without opening anything. */
  start(redirect: string): Promise<WhoopStartResponse>;
  status(): Promise<WhoopStatusResponse>;
  /** Runs one chunk of the backfill, or a normal incremental sync. */
  sync(): Promise<WhoopSyncResponse>;
  /** Forgets the connection here. Whoop keeps the grant. */
  disconnect(): Promise<WhoopStatusResponse>;
  /** DELETE /v2/user/access on the server: Whoop forgets us too. */
  revoke(): Promise<WhoopStatusResponse>;
}

/** Thrown by the server client. Carries the kind so copy can name the cause. */
export class WhoopClientError extends Error {
  readonly kind: WhoopErrorKind;
  readonly retryAt: string | null;

  constructor(kind: WhoopErrorKind, message: string, retryAt: string | null = null) {
    super(message);
    this.name = 'WhoopClientError';
    this.kind = kind;
    this.retryAt = retryAt;
  }
}

/** Every transport failure reaches the screen as the kind its copy names. */
function asClientError(caught: unknown): WhoopClientError {
  if (caught instanceof WhoopClientError) return caught;
  if (caught instanceof ApiRequestError) {
    return new WhoopClientError(caught.kind, caught.message, caught.retryAt);
  }
  return new WhoopClientError('network', 'Could not reach the server.');
}

async function call(path: string, options: Parameters<typeof apiFetch>[1] = {}): Promise<unknown> {
  try {
    return await apiFetch(path, options);
  } catch (caught) {
    throw asClientError(caught);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const STATUSES: readonly WhoopStatus[] = [
  'disconnected',
  'connecting',
  'importing',
  'connected',
  'revoked',
  'error',
];

const ERROR_KINDS: readonly WhoopErrorKind[] = [
  'api_down',
  'rate_limited',
  'needs_reauth',
  'network',
];

/** Read a status payload defensively: the server is a separate deploy. */
export function readStatus(value: unknown): WhoopStatusResponse {
  const body = isRecord(value) ? value : {};
  const status = STATUSES.find((entry) => entry === body['status']) ?? 'disconnected';
  const lastError = ERROR_KINDS.find((entry) => entry === body['lastError']) ?? null;
  return {
    status,
    whoopUserId: str(body['whoopUserId']),
    connectedAt: str(body['connectedAt']),
    lastSyncAt: str(body['lastSyncAt']),
    backfillDaysDone: num(body['backfillDaysDone'], 0),
    backfillDaysTotal: num(body['backfillDaysTotal'], 0),
    lastError,
    nextRetryAt: str(body['nextRetryAt']),
  };
}

/** The sync payload is the status plus what this chunk actually wrote. */
export function readSync(value: unknown): WhoopSyncResponse {
  const body = isRecord(value) ? value : {};
  return {
    ...readStatus(value),
    daysImported: num(body['daysImported'], 0),
    imported: num(body['imported'], 0),
    nextCursor: str(body['nextCursor']),
    done: body['done'] !== false,
  };
}

/** The real client. Every call is one request to our own server. */
export function createServerClient(): WhoopClient {
  const client: WhoopClient = {
    kind: 'server',
    configured: true,

    async start(redirect) {
      const body = await call(API.whoopStart, {
        query: { redirect, response: 'json' },
      });
      const record = isRecord(body) ? body : {};
      return { url: str(record['url']) ?? '', state: str(record['state']) ?? '' };
    },

    async connect(redirect = WHOOP_APP_REDIRECT) {
      const base = serverUrl();
      if (base === null) throw new WhoopClientError('network', 'No server is configured.');

      // Only a paired phone needs a ticket. The web sends its cookie, which the
      // browser attaches on its own, so it opens the start URL as it is.
      let ticket: string | null = null;
      if ((await readCredentials()) !== null) {
        const minted = await call(API.whoopStartToken, { method: 'POST' });
        ticket = str(isRecord(minted) ? minted['token'] : null);
        if (ticket === null) {
          throw new WhoopClientError('api_down', 'The server did not hand back a start ticket.');
        }
      }

      const url = startUrlWith(base, API.whoopStart, redirect, ticket);
      const result = await openAuthSession(url, redirect);
      if (result === 'error') {
        throw new WhoopClientError('network', 'Could not open the Whoop sign-in page.');
      }
      if (result === 'cancel') {
        return { outcome: 'cancelled', status: await client.status() };
      }
      return {
        outcome: result === 'redirected' ? 'redirected' : 'connected',
        status: await client.status(),
      };
    },

    async status() {
      return readStatus(await call(API.whoopStatus));
    },

    async sync() {
      return readSync(await call(API.whoopSync, { method: 'POST' }));
    },

    async disconnect() {
      return readStatus(await call(API.whoopDisconnect, { method: 'POST' }));
    },

    async revoke() {
      return readStatus(await call(API.whoopRevoke, { method: 'POST' }));
    },
  };
  return client;
}

/** The state the fixture client pretends to be in. Driven by the dev selector. */
export type FixtureWhoopState =
  | 'disconnected'
  | 'connecting'
  | 'importing'
  | 'connected'
  | 'revoked'
  | 'api_down'
  | 'rate_limited';

export interface FixtureClientOptions {
  readonly state?: FixtureWhoopState;
  /** Days already backfilled, for the "Importing 90 days · 40/90" state. */
  readonly daysDone?: number;
  readonly daysTotal?: number;
  readonly lastSyncAt?: string | null;
  /** Fixed clock, so a screenshot of this screen is byte-identical twice. */
  readonly now?: string;
}

const FIXTURE_TOTAL = 90;

/**
 * The fixture client. It never reaches the network: the mirrors are already in
 * the local database, so a state here only decides which sentence the screen
 * shows and how the progress counter moves.
 */
export function createFixtureClient(options: FixtureClientOptions = {}): WhoopClient {
  let state: FixtureWhoopState = options.state ?? 'connected';
  let daysDone = options.daysDone ?? (state === 'importing' ? 40 : FIXTURE_TOTAL - 2);
  let lastSyncAt = options.lastSyncAt ?? options.now ?? null;
  const now = (): string => options.now ?? new Date().toISOString();

  const snapshot = (): WhoopStatusResponse => {
    const failing = state === 'api_down' || state === 'rate_limited';
    return {
      status:
        state === 'api_down' || state === 'rate_limited'
          ? 'error'
          : state === 'importing'
            ? 'importing'
            : state,
      whoopUserId: state === 'disconnected' ? null : 'fixture-owner',
      connectedAt: state === 'disconnected' ? null : '2026-08-01T07:00:00.000Z',
      lastSyncAt,
      backfillDaysDone: state === 'disconnected' ? 0 : daysDone,
      backfillDaysTotal: state === 'disconnected' ? 0 : FIXTURE_TOTAL,
      lastError: state === 'api_down' ? 'api_down' : state === 'rate_limited' ? 'rate_limited' : null,
      nextRetryAt: failing ? '2026-10-22T07:15:00.000Z' : null,
    };
  };

  return {
    kind: 'fixture',
    configured: false,
    async start() {
      state = 'connecting';
      return { url: 'vert://whoop/callback?fixture=1', state: 'fixturestate' };
    },
    async connect() {
      state = 'connecting';
      return { outcome: 'connected', status: snapshot() };
    },
    async status() {
      return snapshot();
    },
    async sync() {
      if (state === 'api_down' || state === 'rate_limited') {
        throw new WhoopClientError(
          state === 'api_down' ? 'api_down' : 'rate_limited',
          'The fixture is simulating a failure.',
          '2026-10-22T07:15:00.000Z',
        );
      }
      if (state === 'connecting') state = 'importing';
      const before = daysDone;
      // One chunk. The backfill is resumable, so a cancelled sync keeps this.
      daysDone = Math.min(FIXTURE_TOTAL, daysDone + 10);
      if (daysDone >= FIXTURE_TOTAL) state = 'connected';
      lastSyncAt = now();
      const done = daysDone >= FIXTURE_TOTAL;
      return {
        ...snapshot(),
        daysImported: daysDone - before,
        imported: (daysDone - before) * 4,
        nextCursor: done ? null : `fixture-${daysDone}`,
        done,
      };
    },
    async disconnect() {
      state = 'disconnected';
      daysDone = 0;
      lastSyncAt = null;
      return snapshot();
    },
    async revoke() {
      state = 'revoked';
      return snapshot();
    },
  };
}

/** The client this build uses. A configured server wins; otherwise the fixture. */
export function createWhoopClient(options: FixtureClientOptions = {}): WhoopClient {
  return serverUrl() === null ? createFixtureClient(options) : createServerClient();
}
