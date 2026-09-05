/**
 * Applying the phone's outbox to the server's copy of its tables.
 *
 * Three promises, in the order they matter.
 *
 * Idempotent by op id: `sync_op.id` is the primary key and the phone sends
 * `${deviceId}:${queueRowId}`, so a push replayed after a dropped response
 * finds the row already there and is reported accepted without being applied a
 * second time. The row is inserted first, inside the same transaction as the
 * work, and an insert that touches nothing is what "already seen" means: a
 * SELECT before the transaction was a read and not a lock, so two callers
 * could both miss it and both project.
 *
 * In order, per entity: ops are applied one after another in the order the
 * phone queued them, so a set log never lands before the session that owns it
 * and the last write of a run is the one that stands.
 *
 * Never partly applied: each op runs inside its own transaction together with
 * the `sync_op` row that records it, so an op either lands whole and is
 * accepted or touches nothing and is rejected with a reason. A rejection never
 * stops the ops behind it; the response names each one.
 *
 * What one op does to which table is in project.ts.
 */

import { and, asc, gt, sql } from 'drizzle-orm';
import type { SyncChange, SyncOp, SyncPushResponse } from '../api-contract';
import type { Database } from '../../db/client';
import { syncOp as syncOpTable } from '../../db/tables/account';
import { decodeCursor, encodeCursor } from './cursor';
import { Rejected, project } from './project';
import { log } from '../logger';

export interface ApplyContext {
  readonly deviceId: string | null;
  readonly origin: 'web' | 'server' | 'device';
  readonly now?: Date;
}

/* ------------------------------------------------------------------ push */

/** Applies a batch, one transaction per op, in the order the phone queued them. */
export async function applyOps(
  db: Database,
  ops: readonly SyncOp[],
  context: ApplyContext,
): Promise<SyncPushResponse> {
  const now = context.now ?? new Date();
  const accepted: string[] = [];
  const rejected: SyncPushResponse['rejected'] = [];

  for (const op of ops) {
    try {
      await db.transaction(async (tx) => {
        // The insert is the lock as well as the record: an id already there
        // returns no row, which is the replay signal, and no second projection
        // can slip past it.
        const written = await tx
          .insert(syncOpTable)
          .values({
            id: op.id,
            kind: op.kind,
            entityId: op.entityId,
            payload: op.payload,
            createdAt: op.createdAt,
            receivedAt: now,
            appliedAt: now,
            origin: context.origin,
            deviceId: context.deviceId,
          })
          .onConflictDoNothing()
          .returning({ id: syncOpTable.id });
        if (written.length === 0) return;
        await project(tx, op, now);
      });
      accepted.push(op.id);
    } catch (caught) {
      if (caught instanceof Rejected) {
        rejected.push({ id: op.id, reason: caught.reason, message: caught.message });
        continue;
      }
      // A driver message names the SQL and its bound parameters, so it is
      // logged and never returned: the caller is told the cause, not the query.
      log.warn('sync.op_failed', {
        id: op.id,
        kind: op.kind,
        message: caught instanceof Error ? caught.message : 'unknown error',
      });
      rejected.push({
        id: op.id,
        reason: 'error',
        message: 'The server could not apply that change. It will be sent again.',
      });
    }
  }

  return { accepted, rejected, serverTime: now.toISOString() };
}

/* ------------------------------------------------------------------ pull */

/**
 * Server-side changes since a cursor: web edits, matches, imports, and the
 * phone's own ops, which carry their origin so the phone can skip its echo.
 *
 * Ordered by `seq`, the insertion order. It used to be ordered by the instant
 * the server received them with the op id breaking ties, and every op in one
 * batch shares that instant while the id is `${deviceId}:${queueRowId}` and
 * sorts as text: "dev:10" came before "dev:9", so the feed replayed a batch in
 * an order the phone never queued and a delete could arrive before the write it
 * undid. A number handed out at insert cannot do that.
 */
export async function changesSince(
  db: Database,
  since: Date | null,
  limit: number,
  cursor: string | null,
): Promise<{ changes: SyncChange[]; next: string | null }> {
  const parts = decodeCursor(cursor, 1);
  const raw = parts === null ? Number.NaN : Number(parts[0]);
  const after = Number.isSafeInteger(raw) && raw >= 0 ? raw : null;

  const bounds = [
    // Only an op that actually landed is a change; one mid-flight is not.
    sql`${syncOpTable.appliedAt} is not null`,
    after !== null ? gt(syncOpTable.seq, after) : undefined,
    after === null && since !== null ? gt(syncOpTable.receivedAt, since) : undefined,
  ];

  const rows = await db
    .select()
    .from(syncOpTable)
    .where(and(...bounds))
    .orderBy(asc(syncOpTable.seq))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const changes: SyncChange[] = page.map((row) => ({
    id: row.id,
    kind: row.kind,
    entityId: row.entityId,
    payload: row.payload ?? null,
    at: row.receivedAt.toISOString(),
    origin: row.origin,
    deviceId: row.deviceId,
  }));

  const last = page[page.length - 1];
  const next =
    rows.length > limit && last !== undefined ? encodeCursor([String(last.seq)]) : null;
  return { changes, next };
}
