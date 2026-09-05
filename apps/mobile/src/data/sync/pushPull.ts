/**
 * The phone's push and pull loop.
 *
 * Runs on app open and after every local write while there is a server to
 * reach. Nothing on the daily path waits for it: every tap has already written
 * a row and enqueued an op, so this only drains the outbox and folds in what
 * the server has that the phone does not.
 *
 * Push first, then pull. A set log must reach the server before the mirror
 * feed can be trusted to be a complete picture, and pushing first means a
 * failure leaves the local database exactly as it was.
 *
 * Failure is expected, not exceptional: a basement gym has no signal. Every
 * failed attempt increments the queue row's `attempts`, records the reason,
 * and pushes the next try out on an exponential backoff so a server that is
 * down is not hammered by a screen that keeps mounting.
 */

import type { SqlExecutor } from '../executor';
import { KV_KEYS, kvGet, kvSet } from '../store/kv';
import { newId, nowIso } from '../store/rows';
import { listPending, markAttempted, markSynced } from '../store/sync';
import { applyMirror } from './applyMirror';
import {
  API,
  SYNC_PUSH_MAX_OPS,
  isSyncOpKind,
  queueRowIdFromOpId,
  syncOpId,
  type MirrorChange,
  type SyncOp,
  type SyncPushResponse,
  type SyncReject,
} from './apiContract';
import { ApiRequestError, apiFetch, readCredentials, serverUrl } from './transport';

/* -------------------------------------------------------------- cursors */

/** Where the mirror feed left off. Opaque to us; the server minted it. */
const MIRROR_CURSOR_KEY = 'sync.mirrorCursor';

/** This install's id, used only when there is no paired device id to use. */
const CLIENT_ID_KEY = 'sync.clientId';

/**
 * This install's identity, kept for the legacy op id only.
 *
 * An op now carries the uuid its queue row was enqueued with: the queue row id
 * is a local autoincrement, so `${deviceId}:1` after a reinstall is an id the
 * server has already applied and the new op would be acknowledged without ever
 * being written. The prefix still resolves an id from before that change.
 */
async function originId(db: SqlExecutor): Promise<string> {
  const credentials = await readCredentials();
  if (credentials !== null) return credentials.deviceId;
  const existing = await kvGet(db, CLIENT_ID_KEY);
  if (existing !== null) return existing;
  const minted = newId('dev');
  await kvSet(db, CLIENT_ID_KEY, minted);
  return minted;
}

/* -------------------------------------------------------------- backoff */

/** First wait after a failure, doubled each time up to the cap. */
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60_000;

interface Backoff {
  failures: number;
  nextAttemptAt: number;
}

const backoff: Backoff = { failures: 0, nextAttemptAt: 0 };

/** 5 s, 10 s, 20 s ... capped at 5 min. Deterministic, so a test can assert it. */
export function backoffDelayMs(failures: number): number {
  if (failures <= 0) return 0;
  const grown = BACKOFF_BASE_MS * 2 ** (failures - 1);
  return Math.min(BACKOFF_MAX_MS, grown);
}

/** When the next attempt is allowed, as a millisecond clock reading. */
export function nextAttemptAt(): number {
  return backoff.nextAttemptAt;
}

/** A successful round trip clears the wait; the next write syncs immediately. */
export function resetBackoff(): void {
  backoff.failures = 0;
  backoff.nextAttemptAt = 0;
}

/**
 * A server-named instant wins over the curve: "Rate limited, next sync at
 * 7:02" is the server's own arithmetic and the phone should honour it.
 */
function recordFailure(now: number, retryAt: string | null): void {
  backoff.failures += 1;
  const named = retryAt === null ? Number.NaN : Date.parse(retryAt);
  backoff.nextAttemptAt = Number.isNaN(named)
    ? now + backoffDelayMs(backoff.failures)
    : Math.max(named, now + BACKOFF_BASE_MS);
}

/* ----------------------------------------------------------------- push */

interface QueuedRow {
  readonly id: number;
  readonly uuid: string;
  readonly op: string;
  readonly entityId: string | null;
  readonly payload: unknown;
  readonly createdAt: string;
}

function toOp(origin: string, row: QueuedRow): SyncOp | null {
  if (!isSyncOpKind(row.op)) return null;
  return {
    // The row's own uuid, not its position in a table this phone can drop.
    // `syncOpId` stays the fallback for a row minted before the uuid column.
    id: row.uuid === '' ? syncOpId(origin, row.id) : row.uuid,
    kind: row.op,
    entityId: row.entityId,
    payload: (row.payload ?? null) as SyncOp['payload'],
    createdAt: row.createdAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPushResponse(value: unknown): SyncPushResponse {
  const body = isRecord(value) ? value : {};
  const accepted = Array.isArray(body['accepted'])
    ? body['accepted'].filter((id): id is string => typeof id === 'string')
    : [];
  const rejectedRaw = Array.isArray(body['rejected']) ? body['rejected'] : [];
  const rejected: SyncReject[] = [];
  for (const entry of rejectedRaw) {
    if (!isRecord(entry)) continue;
    const id = entry['id'];
    if (typeof id !== 'string') continue;
    rejected.push({
      id,
      reason: (typeof entry['reason'] === 'string' ? entry['reason'] : 'error') as SyncReject['reason'],
      message: typeof entry['message'] === 'string' ? entry['message'] : 'Rejected.',
    });
  }
  const serverTime = typeof body['serverTime'] === 'string' ? body['serverTime'] : nowIso();
  return { accepted, rejected, serverTime };
}

/**
 * Queue row ids the server named, ignoring anything that is not one of ours.
 *
 * `sent` is what this very push carried, so an id is resolved by what went out
 * rather than by taking the id apart; a `${deviceId}:${rowId}` id from before
 * the uuid column still reads, through the second lookup.
 */
function rowIdsFor(ids: readonly string[], sent: ReadonlyMap<string, number>): number[] {
  const rows = new Set(sent.values());
  const out: number[] = [];
  for (const id of ids) {
    const mapped = sent.get(id) ?? queueRowIdFromOpId(id);
    if (mapped !== null && mapped !== undefined && rows.has(mapped)) out.push(mapped);
  }
  return out;
}

/* ----------------------------------------------------------------- pull */

function readMirrorChanges(value: unknown): { rows: MirrorChange[]; next: string | null } {
  const body = isRecord(value) ? value : {};
  const raw = Array.isArray(body['rows']) ? body['rows'] : [];
  const rows: MirrorChange[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const kind = entry['kind'];
    const id = entry['id'];
    if (typeof id !== 'string' || id === '') continue;
    if (kind !== 'cycle' && kind !== 'recovery' && kind !== 'sleep' && kind !== 'workout') continue;
    const row = isRecord(entry['row']) ? entry['row'] : null;
    const deleted = entry['deleted'] === true || row === null;
    rows.push({
      kind,
      id,
      updatedAt: typeof entry['updatedAt'] === 'string' ? entry['updatedAt'] : nowIso(),
      deleted,
      // The server validated this against the shared contract; the app only
      // proved the discriminant, and the appliers read field by field.
      row: row as never,
    });
  }
  const next = typeof body['next'] === 'string' && body['next'] !== '' ? body['next'] : null;
  return { rows, next };
}


/* ------------------------------------------------------------------- run */

export type SyncSkipReason = 'no_server' | 'backoff' | 'already_running';

export interface SyncRunResult {
  readonly ok: boolean;
  /** Set when nothing was attempted, and why. */
  readonly skipped: SyncSkipReason | null;
  readonly pushed: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly pulled: number;
  readonly applied: number;
  /** The stamp the sync line renders, when this run produced one. */
  readonly lastSyncedAt: string | null;
  readonly error: ApiRequestError | null;
}

export interface SyncRunOptions {
  /** Clock, injected so a test can drive the backoff without waiting. */
  readonly now?: number;
  /** Ignore the backoff. A Sync now tap is the athlete asking, so it does. */
  readonly force?: boolean;
  readonly maxOps?: number;
  /** Mirror feed pages in one run. Bounded so a cold start still finishes. */
  readonly maxPages?: number;
}

const DEFAULT_MAX_PAGES = 5;

function empty(skipped: SyncSkipReason | null): SyncRunResult {
  return {
    ok: skipped === null,
    skipped,
    pushed: 0,
    accepted: 0,
    rejected: 0,
    pulled: 0,
    applied: 0,
    lastSyncedAt: null,
    error: null,
  };
}

let running: Promise<SyncRunResult> | null = null;

/**
 * Drains the outbox and folds in the mirror feed. Never throws: a caller on
 * the daily path treats sync as weather, and the result says what happened.
 */
export async function runSync(
  db: SqlExecutor,
  options: SyncRunOptions = {},
): Promise<SyncRunResult> {
  if (serverUrl() === null) return empty('no_server');
  const now = options.now ?? Date.now();
  if (options.force !== true && now < backoff.nextAttemptAt) return empty('backoff');
  // Two screens mounting at once must not push the same rows twice.
  if (running !== null) return running;

  const attempt = runOnce(db, options, now).finally(() => {
    running = null;
  });
  running = attempt;
  return attempt;
}

async function runOnce(
  db: SqlExecutor,
  options: SyncRunOptions,
  now: number,
): Promise<SyncRunResult> {
  const maxOps = Math.min(options.maxOps ?? SYNC_PUSH_MAX_OPS, SYNC_PUSH_MAX_OPS);
  let pushed = 0;
  let accepted = 0;
  let rejected = 0;
  let pulled = 0;
  let applied = 0;

  try {
    /* push */
    const pending = await listPending(db, maxOps);
    if (pending.length > 0) {
      const origin = await originId(db);
      const sent = new Map<string, number>();
      const ops: SyncOp[] = [];
      const unknownKind: number[] = [];
      for (const row of pending) {
        const op = toOp(origin, row);
        if (op === null) {
          unknownKind.push(row.id);
          continue;
        }
        sent.set(op.id, row.id);
        ops.push(op);
      }
      // A kind this build does not know is not a transport failure. It is
      // counted as attempted so it cannot wedge the head of the queue.
      if (unknownKind.length > 0) {
        await markAttempted(db, unknownKind, 'This build does not know that op kind.');
      }

      if (ops.length > 0) {
        pushed = ops.length;
        const response = readPushResponse(
          await apiFetch(API.syncPush, { method: 'POST', body: { ops } }),
        );
        const acceptedRows = rowIdsFor(response.accepted, sent);
        accepted = acceptedRows.length;
        await markSynced(db, acceptedRows);

        const rejectedRows = rowIdsFor(
          response.rejected.map((entry) => entry.id),
          sent,
        );
        rejected = rejectedRows.length;
        if (rejectedRows.length > 0) {
          const first = response.rejected[0];
          await markAttempted(db, rejectedRows, first === undefined ? 'Rejected.' : first.message);
        }
      }
    }

    /* pull */
    let cursor = await kvGet(db, MIRROR_CURSOR_KEY);
    const pages = options.maxPages ?? DEFAULT_MAX_PAGES;
    for (let page = 0; page < pages; page += 1) {
      const body = await apiFetch(API.mirrors, {
        query: cursor === null ? undefined : { cursor },
      });
      const { rows, next } = readMirrorChanges(body);
      pulled += rows.length;
      for (const change of rows) {
        if (await applyMirror(db, change)) applied += 1;
      }

      // Where the applied rows leave the feed, written after they are applied
      // so an interrupted run resumes at the last row it wrote rather than
      // past it. The server names the last row's position on every page that
      // has rows, so a short feed leaves a position behind too; a null `next`
      // means the page was empty, and the cursor it was asked for is then
      // still the furthest position anyone has named.
      const reached = next ?? cursor;
      if (reached !== null) await kvSet(db, MIRROR_CURSOR_KEY, reached);
      cursor = reached;

      if (next === null) break;
      if (rows.length === 0) break;
    }

    const at = nowIso();
    await kvSet(db, KV_KEYS.lastSyncedAt, at);
    resetBackoff();
    return {
      ok: true,
      skipped: null,
      pushed,
      accepted,
      rejected,
      pulled,
      applied,
      lastSyncedAt: at,
      error: null,
    };
  } catch (caught) {
    const error =
      caught instanceof ApiRequestError
        ? caught
        : new ApiRequestError('network', 'The sync did not finish.');
    recordFailure(now, error.retryAt);
    return {
      ok: false,
      skipped: null,
      pushed,
      accepted,
      rejected,
      pulled,
      applied,
      lastSyncedAt: null,
      error,
    };
  }
}

/** Forgets the mirror cursor, so the next run replays the feed from the start. */
export async function resetMirrorCursor(db: SqlExecutor): Promise<void> {
  await kvSet(db, MIRROR_CURSOR_KEY, '');
  await db.runAsync('DELETE FROM kv WHERE key = ?', [MIRROR_CURSOR_KEY]);
}

export { MIRROR_CURSOR_KEY };
