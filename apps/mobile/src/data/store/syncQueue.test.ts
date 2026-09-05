import { beforeEach, describe, expect, it } from 'vitest';
import type { SqlExecutor } from '../executor';
import { openMigratedTestDb } from '../testing/testDb';
import { enqueue, listPending, newSyncOpId } from './sync';

/**
 * The outbox row's idempotency key.
 *
 * The server keys its `sync_op` table on the id the phone sends, so that id
 * has to be unique for all time. `${deviceId}:${queueRowId}` was unique only
 * for the life of one local database: the queue row id is a SQLite
 * autoincrement, so after a reinstall the first op is `dev1:1` again, an id
 * the server has already applied, and the op is acknowledged without ever
 * being written. A uuid minted at enqueue belongs to the op instead.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let db: SqlExecutor;

beforeEach(async () => {
  db = await openMigratedTestDb();
});

describe('newSyncOpId', () => {
  it('mints a uuid, not a counter', async () => {
    expect(await newSyncOpId()).toMatch(UUID);
  });

  it('never repeats itself', async () => {
    const minted = await Promise.all(Array.from({ length: 200 }, () => newSyncOpId()));
    expect(new Set(minted).size).toBe(200);
  });
});

describe('enqueue', () => {
  it('stores a uuid on the row', async () => {
    await enqueue(db, { kind: 'setLog.upsert', entityId: 'set-1', payload: { reps: 5 } });
    const [row] = await listPending(db);
    expect(row?.uuid).toMatch(UUID);
  });

  it('gives each row its own', async () => {
    await enqueue(db, { kind: 'setLog.upsert', entityId: 'set-1', payload: { reps: 5 } });
    await enqueue(db, { kind: 'setLog.upsert', entityId: 'set-2', payload: { reps: 3 } });
    const rows = await listPending(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.uuid).not.toBe(rows[1]?.uuid);
  });

  it('keeps the collapse of an identical op waiting, uuid and all', async () => {
    const first = await enqueue(db, { kind: 'week.upsert', entityId: 'w1', payload: { w: 1 } });
    const again = await enqueue(db, { kind: 'week.upsert', entityId: 'w1', payload: { w: 1 } });
    expect(again).toBe(first);
    const rows = await listPending(db);
    expect(rows).toHaveLength(1);
  });

  it('survives a local reset: the same row number carries a different id', async () => {
    await enqueue(db, { kind: 'session.finish', entityId: 's1', payload: {} });
    const before = await listPending(db);

    // A reinstall, a "clear data", an evicted IndexedDB: a new database whose
    // autoincrement starts at 1 again.
    const fresh = await openMigratedTestDb();
    await enqueue(fresh, { kind: 'session.finish', entityId: 's1', payload: {} });
    const after = await listPending(fresh);

    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.uuid).not.toBe(before[0]?.uuid);
  });
});

describe('a row enqueued before the uuid column', () => {
  it('is given one the first time the outbox lists it', async () => {
    await db.runAsync(
      'INSERT INTO sync_queue (op, entity_id, payload, created_at, attempts) VALUES (?, ?, ?, ?, 0)',
      ['session.finish', 's1', '{}', '2026-10-22T06:00:00.000Z'],
    );
    const [row] = await listPending(db);
    expect(row?.uuid).toMatch(UUID);

    // And it is written back, so the same op keeps the same key across runs.
    const stored = await db.getFirstAsync<{ uuid: string | null }>(
      'SELECT uuid FROM sync_queue WHERE id = ?',
      [row?.id ?? 0],
    );
    expect(stored?.uuid).toBe(row?.uuid);

    const [again] = await listPending(db);
    expect(again?.uuid).toBe(row?.uuid);
  });
});
