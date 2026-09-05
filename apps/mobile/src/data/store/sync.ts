import type { SqlExecutor } from '../executor';
import type { SyncOp, SyncQueueRow, SyncStatus } from '../types';
import { KV_KEYS, kvGet, kvSet } from './kv';
import { fromJson, newId, nowIso, toJsonRequired } from './rows';

/**
 * The outbox. Every local write that the server will eventually want enqueues
 * one op; the queue is ordered by creation and drained in order, so a set log
 * never arrives before the session that owns it.
 */

interface QueueRow {
  readonly id: number;
  readonly uuid: string | null;
  readonly op: string;
  readonly entity_id: string | null;
  readonly payload: string;
  readonly created_at: string;
  readonly attempts: number;
  readonly last_attempt_at: string | null;
  readonly last_error: string | null;
}

function mapRow(row: QueueRow, uuid: string): SyncQueueRow {
  return {
    id: row.id,
    uuid,
    op: row.op,
    entityId: row.entity_id,
    payload: fromJson(row.payload),
    createdAt: row.created_at,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
  };
}

/* ------------------------------------------------------------- op ids */

/**
 * The op id the server keys idempotency on.
 *
 * It has to be unique for all time, not just for the life of this database:
 * `${deviceId}:${queueRowId}` was neither, because a reinstall starts the
 * autoincrement at 1 again and the server then acknowledges a brand new op as
 * one it had already applied. A uuid minted at enqueue belongs to the op.
 *
 * `expo-crypto` is the source on device and in the browser. It is loaded
 * lazily, the way `transport.ts` loads secure store, so this module still runs
 * under vitest in node, where the platform's own `crypto.randomUUID` answers
 * instead. Neither path goes near `Math.random`: an id that decides whether a
 * logged set is written once or twice is not a place for a weak generator. If
 * a runtime somehow has neither, the clock-and-counter id is the last resort,
 * and it is still unique across a reset because the clock moves on.
 */
type Uuids = { readonly randomUUID: () => string };

let expoCrypto: Promise<Uuids | null> | null = null;

function loadExpoCrypto(): Promise<Uuids | null> {
  expoCrypto ??= import('expo-crypto')
    .then((module) =>
      typeof module.randomUUID === 'function' ? { randomUUID: () => module.randomUUID() } : null,
    )
    .catch(() => null);
  return expoCrypto;
}

function platformUuids(): Uuids | null {
  const source = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof source?.randomUUID === 'function'
    ? { randomUUID: () => source.randomUUID?.() ?? '' }
    : null;
}

export async function newSyncOpId(): Promise<string> {
  try {
    const expo = await loadExpoCrypto();
    if (expo !== null) {
      const minted = expo.randomUUID();
      if (minted !== '') return minted;
    }
  } catch {
    // Falls through to the platform generator.
  }
  const platform = platformUuids();
  if (platform !== null) {
    const minted = platform.randomUUID();
    if (minted !== '') return minted;
  }
  return newId('op');
}

/**
 * Gives a uuid to a row enqueued before this build, so an outbox that was
 * already waiting at upgrade time is not stranded without an idempotency key.
 */
async function backfillUuid(db: SqlExecutor, id: number): Promise<string> {
  const minted = await newSyncOpId();
  await db.runAsync('UPDATE sync_queue SET uuid = ? WHERE id = ? AND uuid IS NULL', [minted, id]);
  const row = await db.getFirstAsync<{ uuid: string | null }>(
    'SELECT uuid FROM sync_queue WHERE id = ?',
    [id],
  );
  return row?.uuid ?? minted;
}

/**
 * Adds one op to the outbox, unless the identical op is already waiting.
 *
 * `sync_queue` has no key of its own, so a tap replayed after a crash (the set
 * log itself collapses onto its idempotency key) used to stack a second,
 * identical op behind the first. Matching on kind, entity and payload keeps a
 * genuinely different payload as its own op while a replay is a no-op.
 *
 * Returns the queue row id, existing or new.
 */
export async function enqueue(db: SqlExecutor, op: SyncOp): Promise<number> {
  const entityId = op.entityId ?? null;
  const payload = toJsonRequired(op.payload);

  const waiting = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM sync_queue
      WHERE op = ? AND entity_id IS ? AND payload = ? AND synced_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [op.kind, entityId, payload],
  );
  if (waiting !== null) return waiting.id;

  const result = await db.runAsync(
    'INSERT INTO sync_queue (uuid, op, entity_id, payload, created_at, attempts) VALUES (?, ?, ?, ?, ?, 0)',
    [await newSyncOpId(), op.kind, entityId, payload, nowIso()],
  );
  return result.lastInsertRowId;
}

/** Several ops from one user action share a transaction with the write itself. */
export async function enqueueMany(db: SqlExecutor, ops: readonly SyncOp[]): Promise<void> {
  for (const op of ops) await enqueue(db, op);
}

export async function listPending(db: SqlExecutor, limit = 100): Promise<SyncQueueRow[]> {
  const rows = await db.getAllAsync<QueueRow>(
    'SELECT * FROM sync_queue WHERE synced_at IS NULL ORDER BY created_at, id LIMIT ?',
    [Math.max(1, Math.floor(limit))],
  );
  const out: SyncQueueRow[] = [];
  for (const row of rows) {
    const uuid = row.uuid ?? (await backfillUuid(db, row.id));
    out.push(mapRow(row, uuid));
  }
  return out;
}

export async function pendingCount(db: SqlExecutor): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM sync_queue WHERE synced_at IS NULL',
  );
  return row?.n ?? 0;
}

export async function oldestPendingAt(db: SqlExecutor): Promise<string | null> {
  const row = await db.getFirstAsync<{ at: string | null }>(
    'SELECT MIN(created_at) AS at FROM sync_queue WHERE synced_at IS NULL',
  );
  return row?.at ?? null;
}

export async function markAttempted(
  db: SqlExecutor,
  ids: readonly number[],
  error?: string,
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(
    `UPDATE sync_queue SET attempts = attempts + 1, last_attempt_at = ?, last_error = ?
     WHERE id IN (${placeholders})`,
    [nowIso(), error ?? null, ...ids],
  );
}

export async function markSynced(db: SqlExecutor, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const at = nowIso();
  const placeholders = ids.map(() => '?').join(', ');
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE sync_queue SET synced_at = ?, last_error = NULL WHERE id IN (${placeholders})`,
      [at, ...ids],
    );
    await kvSet(db, KV_KEYS.lastSyncedAt, at);
  });
}

/** Drop acknowledged ops older than a fortnight so the table cannot grow forever. */
export async function pruneSynced(db: SqlExecutor, olderThanDays = 14): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const result = await db.runAsync(
    'DELETE FROM sync_queue WHERE synced_at IS NOT NULL AND synced_at < ?',
    [cutoff],
  );
  return result.changes;
}

export async function getLastSyncedAt(db: SqlExecutor): Promise<string | null> {
  return kvGet(db, KV_KEYS.lastSyncedAt);
}

/**
 * What the sync line on Today renders from: "Offline · 4 changes saved on this
 * phone", "Synced 6:41 PM", "4 changes not synced for 2 days".
 */
export async function getSyncStatus(db: SqlExecutor): Promise<SyncStatus> {
  const [pending, oldest, lastSyncedAt] = await Promise.all([
    pendingCount(db),
    oldestPendingAt(db),
    getLastSyncedAt(db),
  ]);
  return { pending, oldestPendingAt: oldest, lastSyncedAt };
}
