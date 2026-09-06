/**
 * The wire contract between this app and the Vert server.
 *
 * DUPLICATION, ON PURPOSE. This file is a hand copy of
 * `apps/server/src/lib/api-contract.ts` with the zod schemas stripped to plain
 * TypeScript types. The server owns the contract and validates every request
 * and response against its schemas; the app is a separate deploy that can be
 * older or newer, so it keeps its own types and its own defensive readers
 * rather than importing across the workspace (Metro would then have to bundle
 * zod and the server's node-only modules). When the server's contract changes,
 * change this file in the same commit.
 *
 * Verified copy of server contract revision: the 18-path `API` map below.
 *
 * One deliberate addition, reported as an interface gap and applied to the
 * server contract in the same change:
 *   - `athlete.clearance` is in `SYNC_OP_KINDS`. The app has always enqueued it
 *     (src/features/setup/clearanceScreen.tsx) and the server's first draft
 *     listed nineteen kinds without it, so a pushed clearance would have come
 *     back rejected as `unknown_kind`.
 *   - `POST /api/whoop/start-token`, so the phone can open the start URL in a
 *     system authentication session without the device secret riding a URL.
 */

/* ------------------------------------------------------------- primitives */

/** ISO 8601 instant, always with an offset or Z. */
export type IsoTimestamp = string;

/** "YYYY-MM-DD" derived from a record's own timezone offset, never from UTC. */
export type LocalDate = string;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Whoop marks every object; a score is absent unless the state is SCORED. */
export type ScoreState = 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';

/** The two failures that earn their own copy, plus the two transport ones. */
export type WhoopErrorKind = 'api_down' | 'rate_limited' | 'needs_reauth' | 'network';

/** Every error body the server returns is this shape. */
export interface ApiErrorBody {
  readonly error: string;
  readonly message: string;
  readonly retryAfterS: number | null;
}

/* ---------------------------------------------------------------- pairing */

export interface PairStartResponse {
  readonly code: string;
  readonly expiresAt: IsoTimestamp;
}

export interface PairClaimRequest {
  readonly code: string;
  readonly deviceName: string;
}

export interface PairClaimResponse {
  /** Shown once, never returned again. 32 random bytes, base64url. */
  readonly deviceSecret: string;
  readonly deviceId: string;
  readonly pairedAt: IsoTimestamp;
}

export type PairClaimErrorCode = 'wrong_code' | 'expired' | 'locked';

export interface PairClaimError {
  readonly error: PairClaimErrorCode;
  readonly retryAfterS: number;
}

export interface DeviceMeResponse {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly pairedAt: IsoTimestamp;
}

/* ------------------------------------------------------------------ login */

export interface LoginRequest {
  readonly passphrase: string;
}

export interface LoginResponse {
  readonly ok: true;
  readonly expiresAt: IsoTimestamp;
}

export type LoginErrorCode = 'wrong_passphrase' | 'locked';

export interface LoginError {
  readonly error: LoginErrorCode;
  readonly retryAfterS: number;
}

export const SESSION_COOKIE = 'vert_session';

/** Failures before the wait, and how long it lasts. Mirrors pairing.ts. */
export const LOCKOUT_AFTER = 5;
export const LOCKOUT_SECONDS = 60;

/* ------------------------------------------------------------ whoop start */

/**
 * A 302 by default, because the phone opens this in the system auth session.
 * `?response=json` answers the URL and the state instead.
 */
export type WhoopStartResponseMode = 'redirect' | 'json';

export interface WhoopStartResponse {
  readonly url: string;
  /** Minted server-side, at least 8 characters, bound to the caller. */
  readonly state: string;
}

/**
 * The single-use ticket that lets the system authentication session reach a
 * bearer-only endpoint. Sixty seconds, one use, so the device secret itself
 * never appears in a URL, a browser history entry, or a server access log.
 */
export interface WhoopStartTokenResponse {
  readonly token: string;
  readonly expiresAt: IsoTimestamp;
}

/** The query parameter that carries it. */
export const WHOOP_START_TOKEN_PARAM = 't';

/** Where the callback lands: the app scheme, or the web settings screen. */
export const APP_CONNECTED_REDIRECT = 'vert://whoop/connected';
export const WEB_CONNECTED_REDIRECT = '/settings/whoop?connected=1';

/* ----------------------------------------------------------- whoop status */

export type WhoopStatus =
  | 'disconnected'
  | 'connecting'
  | 'importing'
  | 'connected'
  | 'revoked'
  | 'error';

export interface WhoopStatusResponse {
  readonly status: WhoopStatus;
  readonly whoopUserId: string | null;
  readonly connectedAt: IsoTimestamp | null;
  readonly lastSyncAt: IsoTimestamp | null;
  /** 90 day backfill, chunked and resumable. Gaps stay gaps, never zeros. */
  readonly backfillDaysDone: number;
  readonly backfillDaysTotal: number;
  readonly lastError: WhoopErrorKind | null;
  /** When the next automatic attempt runs; also the rate limit "next sync at". */
  readonly nextRetryAt: IsoTimestamp | null;
}

/** One bounded chunk: 25 a page, at most WHOOP_SYNC_MAX_PAGES a call. */
export interface WhoopSyncResponse extends WhoopStatusResponse {
  readonly daysImported: number;
  readonly imported: number;
  readonly nextCursor: string | null;
  readonly done: boolean;
}

export const WHOOP_PAGE_LIMIT = 25;
export const WHOOP_SYNC_MAX_PAGES = 8;
export const WHOOP_BACKFILL_DAYS = 90;

export interface WhoopDeleteDataResponse {
  readonly deleted: {
    readonly cycles: number;
    readonly recoveries: number;
    readonly sleeps: number;
    readonly workouts: number;
  };
  readonly status: WhoopStatusResponse;
}

/* -------------------------------------------------------------- mirrors */

/** Shared by all four mirrors: the Whoop id, its own offset, its local date. */
export interface MirrorRowBase {
  readonly id: string;
  readonly scoreState: ScoreState;
  readonly timezoneOffset: string | null;
  readonly localDate: LocalDate;
  readonly raw: Json;
  readonly updatedAt: IsoTimestamp;
}

export interface WhoopCycleRow extends MirrorRowBase {
  readonly startAt: IsoTimestamp;
  readonly endAt: IsoTimestamp | null;
  readonly strain: number | null;
  readonly averageHeartRate: number | null;
  readonly kilojoule: number | null;
}

export interface WhoopRecoveryRow extends MirrorRowBase {
  readonly cycleId: string | null;
  readonly sleepId: string | null;
  readonly userCalibrating: boolean;
  readonly recoveryScore: number | null;
  readonly restingHeartRate: number | null;
  readonly hrvRmssdMilli: number | null;
  readonly spo2Percentage: number | null;
  readonly skinTempCelsius: number | null;
}

export interface WhoopSleepRow extends MirrorRowBase {
  readonly cycleId: string | null;
  readonly nap: boolean;
  readonly startAt: IsoTimestamp;
  readonly endAt: IsoTimestamp | null;
  readonly sleepPerformancePercentage: number | null;
  readonly sleepEfficiencyPercentage: number | null;
  readonly respiratoryRate: number | null;
  readonly totalInBedTimeMilli: number | null;
}

export interface WhoopWorkoutRow extends MirrorRowBase {
  readonly sportName: string | null;
  readonly startAt: IsoTimestamp;
  readonly endAt: IsoTimestamp | null;
  readonly strain: number | null;
  readonly averageHeartRate: number | null;
  readonly maxHeartRate: number | null;
  readonly percentRecorded: number | null;
  readonly zoneDurations: Json | null;
}

export type MirrorKind = 'cycle' | 'recovery' | 'sleep' | 'workout';

export const MIRROR_KINDS: readonly MirrorKind[] = ['cycle', 'recovery', 'sleep', 'workout'];

/** A deleted mirror travels as `deleted: true` with a null row. */
export type MirrorChange =
  | { readonly kind: 'cycle'; readonly id: string; readonly updatedAt: IsoTimestamp; readonly deleted: boolean; readonly row: WhoopCycleRow | null }
  | { readonly kind: 'recovery'; readonly id: string; readonly updatedAt: IsoTimestamp; readonly deleted: boolean; readonly row: WhoopRecoveryRow | null }
  | { readonly kind: 'sleep'; readonly id: string; readonly updatedAt: IsoTimestamp; readonly deleted: boolean; readonly row: WhoopSleepRow | null }
  | { readonly kind: 'workout'; readonly id: string; readonly updatedAt: IsoTimestamp; readonly deleted: boolean; readonly row: WhoopWorkoutRow | null };

export interface MirrorsResponse {
  readonly rows: readonly MirrorChange[];
  /**
   * Opaque; pass back as `cursor`. It is the last row's position on every page
   * that has rows, the last page included, so the phone can persist where it
   * got to. Null now means only that the page was empty: there was no row to
   * name a position for.
   */
  readonly next: string | null;
  readonly serverTime: IsoTimestamp;
}

/* ------------------------------------------------------------------ sync */

/**
 * The phone's outbox kinds, verbatim from its enqueue call sites.
 * `athlete.clearance` is the twentieth; see the header note.
 *
 * The last three are additive, for the climbing house rules: the gate's
 * neuromuscular test, the gate's answer for one session, and the single-leg
 * pair, which travels as its own kind because it is its own jump-test mode and
 * must never join a stream, a trend, or a PR. An athlete profile change still
 * travels as `athlete.upsert`; there is no separate `athlete.update`.
 */
export const SYNC_OP_KINDS = [
  'athlete.upsert',
  'athlete.clearance',
  'pain.report',
  'pain.clear',
  'workingMax.set',
  'program.create',
  'week.upsert',
  'week.generated',
  'session.patch',
  'session.finish',
  'session.unfinish',
  'session.move',
  'setLog.upsert',
  'setLog.edit',
  'setLog.delete',
  'jumpTest.create',
  'jumpTest.delete',
  'import.commit',
  'whoop.link',
  'whoop.unlink',
  'readiness_test.create',
  'readiness_outcome.set',
  'jumpTest.single_leg',
] as const;

export type SyncOpKind = (typeof SYNC_OP_KINDS)[number];

export function isSyncOpKind(value: string): value is SyncOpKind {
  return (SYNC_OP_KINDS as readonly string[]).includes(value);
}

/**
 * `id` is the idempotency key and must be stable across retries. The phone's
 * queue row id is a local autoincrement, so it sends `${deviceId}:${rowId}`
 * and a replayed push is a no-op rather than a double apply.
 */
export interface SyncOp {
  readonly id: string;
  readonly kind: SyncOpKind;
  readonly entityId: string | null;
  readonly payload: Json;
  readonly createdAt: IsoTimestamp;
}

/** Builds the idempotency key. One place, so both sides spell it the same. */
export function syncOpId(deviceId: string, queueRowId: number): string {
  return `${deviceId}:${queueRowId}`;
}

/** The queue row id back out of an op id, or null when it is not one of ours. */
export function queueRowIdFromOpId(opId: string): number | null {
  const cut = opId.lastIndexOf(':');
  if (cut < 0) return null;
  const tail = opId.slice(cut + 1);
  if (!/^\d+$/.test(tail)) return null;
  return Number.parseInt(tail, 10);
}

export interface SyncPushRequest {
  readonly ops: readonly SyncOp[];
}

/** At most this many ops travel in one push. */
export const SYNC_PUSH_MAX_OPS = 200;

export type SyncRejectReason =
  | 'unknown_kind'
  | 'invalid_payload'
  | 'missing_entity'
  | 'conflict'
  | 'error';

export interface SyncReject {
  readonly id: string;
  readonly reason: SyncRejectReason;
  readonly message: string;
}

export interface SyncPushResponse {
  /** Op ids the server has durably applied, including ones it had already seen. */
  readonly accepted: readonly string[];
  readonly rejected: readonly SyncReject[];
  readonly serverTime: IsoTimestamp;
}

export interface SyncChange {
  readonly id: string;
  readonly kind: SyncOpKind;
  readonly entityId: string | null;
  readonly payload: Json;
  readonly at: IsoTimestamp;
  /** Where it came from, so the phone can skip its own echo. */
  readonly origin: 'web' | 'server' | 'device';
  readonly deviceId: string | null;
}

export interface SyncPullResponse {
  readonly changes: readonly SyncChange[];
  readonly next: string | null;
  readonly serverTime: IsoTimestamp;
}

/* -------------------------------------------------------------- snapshot */

/**
 * The athlete's whole database, kept on the server so every device opens on
 * the same data. The bytes travel as `application/octet-stream`; everything
 * about them travels as headers, spelled from this one list on both sides.
 */
export const SNAPSHOT_HEADERS = {
  version: 'x-snapshot-version',
  schema: 'x-snapshot-schema',
  /** On a save: the version this device adopted last, or `none`. */
  base: 'x-snapshot-base',
  /** On a save: `1` saves over a newer copy on purpose. */
  force: 'x-snapshot-force',
  createdAt: 'x-snapshot-created-at',
  origin: 'x-snapshot-origin',
  device: 'x-snapshot-device',
  sha256: 'x-snapshot-sha256',
} as const;

/** The most a save may carry; the server refuses more with 413. */
export const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

export interface SnapshotMeta {
  readonly version: number;
  readonly byteLength: number;
  readonly sha256: string;
  /** The app's own migration number the file was written under. */
  readonly schemaVersion: number;
  readonly origin: 'web' | 'device';
  readonly deviceId: string | null;
  readonly baseVersion: number | null;
  readonly createdAt: IsoTimestamp;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A snapshot's facts out of a JSON body, read defensively. */
export function readSnapshotMeta(value: unknown): SnapshotMeta | null {
  if (!isRecordValue(value)) return null;
  const version = value['version'];
  const schemaVersion = value['schemaVersion'];
  const createdAt = value['createdAt'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version <= 0) return null;
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion)) return null;
  if (typeof createdAt !== 'string' || createdAt === '') return null;
  const byteLength = value['byteLength'];
  const baseVersion = value['baseVersion'];
  const deviceId = value['deviceId'];
  return {
    version,
    byteLength: typeof byteLength === 'number' ? byteLength : 0,
    sha256: typeof value['sha256'] === 'string' ? value['sha256'] : '',
    schemaVersion,
    origin: value['origin'] === 'device' ? 'device' : 'web',
    deviceId: typeof deviceId === 'string' && deviceId !== '' ? deviceId : null,
    baseVersion: typeof baseVersion === 'number' && baseVersion > 0 ? baseVersion : null,
    createdAt,
  };
}

/** The same facts off a byte response's headers. */
export function snapshotMetaFromHeaders(
  read: (name: string) => string | null,
  byteLength: number,
): SnapshotMeta | null {
  const base = read(SNAPSHOT_HEADERS.base);
  return readSnapshotMeta({
    version: Number(read(SNAPSHOT_HEADERS.version)),
    schemaVersion: Number(read(SNAPSHOT_HEADERS.schema)),
    createdAt: read(SNAPSHOT_HEADERS.createdAt),
    origin: read(SNAPSHOT_HEADERS.origin),
    deviceId: read(SNAPSHOT_HEADERS.device),
    sha256: read(SNAPSHOT_HEADERS.sha256),
    baseVersion: base === null || base === 'none' ? null : Number(base),
    byteLength,
  });
}

/* ---------------------------------------------------------------- export */

export type ExportFileName =
  | 'tests'
  | 'set-logs'
  | 'sessions'
  | 'weeks'
  | 'whoop'
  /** The readiness gate's own stream. Not a jump test, so not in `tests`. */
  | 'readiness';

/* ------------------------------------------------------------- endpoints */

/** Every path in one place, so the app and the server never spell one wrong. */
export const API = {
  health: '/api/health',
  pairStart: '/api/pair/start',
  pairClaim: '/api/pair/claim',
  deviceMe: '/api/device/me',
  login: '/api/login',
  logout: '/api/logout',
  whoopStart: '/api/whoop/start',
  whoopStartToken: '/api/whoop/start-token',
  whoopCallback: '/api/whoop/callback',
  whoopStatus: '/api/whoop/status',
  whoopSync: '/api/whoop/sync',
  whoopDisconnect: '/api/whoop/disconnect',
  whoopRevoke: '/api/whoop/revoke',
  whoopData: '/api/whoop/data',
  whoopWebhook: '/api/whoop/webhook',
  mirrors: '/api/mirrors',
  syncPush: '/api/sync/push',
  syncPull: '/api/sync/pull',
  snapshot: '/api/snapshot',
  snapshotVersions: '/api/snapshot/versions',
  exportData: '/api/export',
} as const;

export type ApiPath = (typeof API)[keyof typeof API];
