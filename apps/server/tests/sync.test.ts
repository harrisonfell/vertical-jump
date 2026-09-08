/**
 * Push, pull, and the mirror feed.
 *
 * The three properties the phone depends on are asserted against rows: a
 * replayed push changes nothing, an op that cannot be applied leaves no trace
 * at all, and a paged feed hands back every row exactly once.
 *
 * The house-rule op kinds have their own file, `sync.climbing.test.ts`; both
 * share the paired device and the op builder in `support/syncOps.ts`.
 */

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as mirrors } from '../src/app/api/mirrors/route';
import { GET as syncPull } from '../src/app/api/sync/pull/route';
import { POST as syncPush } from '../src/app/api/sync/push/route';
import type { Database } from '../src/db/client';
import { syncOp as syncOpTable } from '../src/db/tables/account';
import { athlete, sessionEvent, setLog, week } from '../src/db/tables/mirror';
import { whoopMirrorDeletion, whoopRecovery, whoopWorkout } from '../src/db/tables/whoop';
import type { MirrorChange, SyncChange } from '../src/lib/api-contract';
import { bodyOf, request, teardown } from './support/harness';
import { CREATED, SECRET, aSetLog, push, syncHarness } from './support/syncOps';

let db: Database;

beforeEach(async () => {
  db = await syncHarness();
}, 60_000);

afterEach(() => {
  teardown();
});

describe('push', () => {
  it('applies a set log and records the op that carried it', async () => {
    const result = await push([
      { id: 'dev_test:1', kind: 'setLog.upsert', entityId: 'log-1', payload: aSetLog() },
    ]);
    expect(result.accepted).toEqual(['dev_test:1']);
    expect(result.rejected).toEqual([]);

    const rows = await db.select().from(setLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'log-1', setNumber: 1, repsDone: 5 });

    const ops = await db.select().from(syncOpTable);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.appliedAt).not.toBeNull();
    expect(ops[0]?.origin).toBe('device');
    expect(ops[0]?.deviceId).toBe('dev_test');
  });

  it('is idempotent by op id, so a replay after a dropped response changes nothing', async () => {
    await push([{ id: 'dev_test:1', kind: 'setLog.upsert', entityId: 'log-1', payload: aSetLog() }]);
    const replay = await push([
      {
        id: 'dev_test:1',
        kind: 'setLog.upsert',
        entityId: 'log-1',
        payload: aSetLog({ repsDone: 99 }),
      },
    ]);

    expect(replay.accepted).toEqual(['dev_test:1']);
    const rows = await db.select().from(setLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repsDone).toBe(5);
  });

  it('keeps both legs of one unilateral set, and still refuses a true duplicate', async () => {
    // The two legs share a set number, so the one-row-per-set constraint has to
    // read the side or the second leg is rejected as a duplicate of the first.
    const result = await push([
      {
        id: 'dev_test:1',
        kind: 'setLog.upsert',
        entityId: 'log-left',
        payload: aSetLog({ id: 'log-left', side: 'left', rpe: 8, idempotencyKey: 'ex-1:1:left' }),
      },
      {
        id: 'dev_test:2',
        kind: 'setLog.upsert',
        entityId: 'log-right',
        payload: aSetLog({ id: 'log-right', side: 'right', rpe: 6, idempotencyKey: 'ex-1:1:right' }),
      },
    ]);
    expect(result.accepted).toEqual(['dev_test:1', 'dev_test:2']);
    expect(result.rejected).toEqual([]);

    const rows = await db.select().from(setLog);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.side === 'left')?.rpe).toBe(8);
    expect(rows.find((row) => row.side === 'right')?.rpe).toBe(6);

    // A third row on a side already logged is the duplicate the constraint is for.
    const again = await push([
      {
        id: 'dev_test:3',
        kind: 'setLog.upsert',
        entityId: 'log-left-again',
        payload: aSetLog({
          id: 'log-left-again',
          side: 'left',
          idempotencyKey: 'ex-1:1:left-again',
        }),
      },
    ]);
    expect(again.accepted).toEqual([]);
    expect(again.rejected[0]?.reason).toBe('conflict');
    expect(await db.select().from(setLog)).toHaveLength(2);
  });

  it('applies a batch in the order the phone queued it', async () => {
    const result = await push([
      { id: 'dev_test:1', kind: 'setLog.upsert', entityId: 'log-1', payload: aSetLog() },
      { id: 'dev_test:2', kind: 'setLog.edit', entityId: 'log-1', payload: { repsDone: 4 } },
    ]);
    expect(result.rejected).toEqual([]);
    const rows = await db.select().from(setLog);
    expect(rows[0]?.repsDone).toBe(4);
    expect(rows[0]?.editedAt).toBe(CREATED);
  });

  it('rejects an edit that arrives before the row it edits, and applies the rest', async () => {
    const result = await push([
      { id: 'dev_test:1', kind: 'setLog.edit', entityId: 'log-1', payload: { repsDone: 4 } },
      { id: 'dev_test:2', kind: 'setLog.upsert', entityId: 'log-1', payload: aSetLog() },
    ]);
    expect(result.accepted).toEqual(['dev_test:2']);
    expect(result.rejected).toEqual([
      { id: 'dev_test:1', reason: 'missing_entity', message: 'No set log with that id.' },
    ]);
    expect(await db.select().from(setLog)).toHaveLength(1);
  });

  it('names an op kind it does not know and still applies the ones beside it', async () => {
    const result = await push([
      { id: 'dev_test:1', kind: 'sacrifice.goat', entityId: 'goat-1', payload: {} },
      { id: 'dev_test:2', kind: 'setLog.upsert', entityId: 'log-1', payload: aSetLog() },
    ]);
    expect(result.accepted).toEqual(['dev_test:2']);
    expect(result.rejected).toEqual([
      {
        id: 'dev_test:1',
        reason: 'unknown_kind',
        message: 'This server does not know that op kind.',
      },
    ]);
  });

  it('leaves no trace of an op it rejects', async () => {
    const result = await push([
      {
        id: 'dev_test:1',
        kind: 'setLog.upsert',
        entityId: 'log-1',
        payload: { setNumber: 1, repsDone: 5 },
      },
    ]);
    expect(result.rejected[0]).toMatchObject({ id: 'dev_test:1', reason: 'invalid_payload' });
    expect(await db.select().from(setLog)).toHaveLength(0);
    expect(await db.select().from(syncOpTable)).toHaveLength(0);
  });

  it('rejects an op that names no entity', async () => {
    const result = await push([
      { id: 'dev_test:1', kind: 'session.patch', entityId: null, payload: { rpe: 8 } },
    ]);
    expect(result.rejected[0]).toMatchObject({ reason: 'missing_entity' });
  });

  it('stores a finish as a log event, never as a stamp', async () => {
    await push([{ id: 'dev_test:1', kind: 'session.finish', entityId: 'session-1', payload: {} }]);
    const events = await db.select().from(sessionEvent);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sessionId: 'session-1', kind: 'complete', at: CREATED });
  });

  it('creates the week from the thin patch the phone actually sends', async () => {
    // `{ w: 7 }` is the whole payload of week.upsert. It used to be accepted,
    // recorded as applied, and projected nothing, so the server's copy of the
    // plan stayed empty for ever while the phone marked its queue row synced.
    const thin = await push([
      { id: 'dev_test:1', kind: 'week.upsert', entityId: 'week-7', payload: { w: 7 } },
    ]);
    expect(thin.accepted).toEqual(['dev_test:1']);
    const landed = await db.select().from(week);
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({ id: 'week-7', w: 7, kind: null, windowStart: null });

    await push([
      {
        id: 'dev_test:2',
        kind: 'week.upsert',
        entityId: 'week-7',
        payload: {
          programId: 'program-1',
          w: 7,
          windowStart: '2026-10-19',
          windowEnd: '2026-10-25',
          kind: 'load',
        },
      },
    ]);
    const rows = await db.select().from(week);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'week-7', w: 7, kind: 'load' });
  });

  it('undoes a set by deleting the row, exactly as the phone does', async () => {
    await push([{ id: 'dev_test:1', kind: 'setLog.upsert', entityId: 'log-1', payload: aSetLog() }]);
    const result = await push([
      {
        id: 'dev_test:2',
        kind: 'setLog.delete',
        entityId: 'ex-1',
        payload: { sessionId: 'session-1', sessionExerciseId: 'ex-1', setNumber: 1 },
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(await db.select().from(setLog)).toHaveLength(0);
  });

  it('merges a working max into the athlete document', async () => {
    await push([
      { id: 'dev_test:1', kind: 'athlete.upsert', entityId: 'athlete_owner', payload: { level: 'advanced' } },
      {
        id: 'dev_test:2',
        kind: 'workingMax.set',
        entityId: 'trap_bar_deadlift',
        payload: { valueKg: 124.7, source: 'entered' },
      },
    ]);
    const rows = await db.select().from(athlete);
    expect(rows[0]?.level).toBe('advanced');
    expect(rows[0]?.workingMax).toMatchObject({ trap_bar_deadlift: { valueKg: 124.7 } });
  });

  it('refuses a caller with no credential', async () => {
    const response = await syncPush(request('/api/sync/push', { method: 'POST', body: { ops: [] } }));
    expect(response.status).toBe(401);
  });
});

describe('pull', () => {
  async function fiveOps(): Promise<void> {
    await push(
      [1, 2, 3, 4, 5].map((n) => ({
        id: `dev_test:${n}`,
        kind: 'session.patch',
        entityId: `session-${n}`,
        payload: { rpe: n },
      })),
    );
  }

  it('pages the change feed and repeats nothing', async () => {
    await fiveOps();
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 5; page += 1) {
      const query = cursor === null ? '?limit=2' : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const response = await syncPull(request(`/api/sync/pull${query}`, { bearer: SECRET }));
      expect(response.status).toBe(200);
      const body = await bodyOf<{ changes: SyncChange[]; next: string | null }>(response);
      seen.push(...body.changes.map((change) => change.id));
      cursor = body.next;
      if (cursor === null) break;
    }

    expect(cursor).toBeNull();
    expect(seen).toEqual(['dev_test:1', 'dev_test:2', 'dev_test:3', 'dev_test:4', 'dev_test:5']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('says where a change came from, so the phone can skip its own echo', async () => {
    await fiveOps();
    const response = await syncPull(request('/api/sync/pull', { bearer: SECRET }));
    const body = await bodyOf<{ changes: SyncChange[] }>(response);
    expect(body.changes[0]).toMatchObject({ origin: 'device', deviceId: 'dev_test', kind: 'session.patch' });
  });

  it('honours since, so a phone that is up to date reads nothing', async () => {
    await fiveOps();
    const later = new Date(Date.now() + 60_000).toISOString();
    const response = await syncPull(
      request(`/api/sync/pull?since=${encodeURIComponent(later)}`, { bearer: SECRET }),
    );
    const body = await bodyOf<{ changes: SyncChange[]; next: string | null }>(response);
    expect(body.changes).toEqual([]);
    expect(body.next).toBeNull();
  });
});

describe('the mirror feed', () => {
  const day = (n: number): Date => new Date(Date.UTC(2026, 8, n, 6, 0, 0));

  async function seedMirrors(): Promise<void> {
    await db.insert(whoopRecovery).values([
      {
        id: 'rec-1',
        scoreState: 'SCORED',
        recoveryScore: 71,
        localDate: '2026-09-01',
        raw: { score_state: 'SCORED' },
        updatedAt: day(1),
      },
      {
        id: 'rec-2',
        scoreState: 'PENDING_SCORE',
        localDate: '2026-09-02',
        raw: { score_state: 'PENDING_SCORE' },
        updatedAt: day(2),
      },
    ]);
    await db.insert(whoopWorkout).values([
      {
        id: 'wko-1',
        scoreState: 'SCORED',
        sportName: 'Weightlifting',
        startAt: '2026-09-01T17:00:00.000Z',
        localDate: '2026-09-01',
        strain: 8.4,
        raw: {},
        // The same instant as rec-1, so the kind and id tie-break is exercised.
        updatedAt: day(1),
      },
    ]);
    await db
      .insert(whoopMirrorDeletion)
      .values({ kind: 'workout', id: 'wko-gone', deletedAt: day(3) });
  }

  it('pages across the four kinds and the tombstones without a gap or a repeat', async () => {
    await seedMirrors();
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 6; page += 1) {
      const query = cursor === null ? '?limit=1' : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const response = await mirrors(request(`/api/mirrors${query}`, { bearer: SECRET }));
      expect(response.status).toBe(200);
      const body = await bodyOf<{ rows: MirrorChange[]; next: string | null }>(response);
      seen.push(...body.rows.map((row) => `${row.kind}:${row.id}`));
      cursor = body.next;
      if (cursor === null) break;
    }

    expect(cursor).toBeNull();
    // The feed is ordered by the shared write sequence, not by the records'
    // own timestamps: two rows written at the same instant still have an order,
    // and it is the order they were written in.
    expect(seen).toEqual(['recovery:rec-1', 'recovery:rec-2', 'workout:wko-1', 'workout:wko-gone']);
  });

  it('sends a deletion as deleted with a null row', async () => {
    await seedMirrors();
    const response = await mirrors(request('/api/mirrors', { bearer: SECRET }));
    const body = await bodyOf<{ rows: MirrorChange[] }>(response);
    const tombstone = body.rows.find((row) => row.id === 'wko-gone');
    expect(tombstone).toMatchObject({ kind: 'workout', deleted: true, row: null });
  });

  it('carries a pending score as a gap, never as a zero', async () => {
    await seedMirrors();
    const response = await mirrors(request('/api/mirrors?kinds=recovery', { bearer: SECRET }));
    const body = await bodyOf<{ rows: MirrorChange[] }>(response);
    const pending = body.rows.find((row) => row.id === 'rec-2');
    expect(pending?.row).toMatchObject({ scoreState: 'PENDING_SCORE', recoveryScore: null });
  });

  it('narrows to the kinds asked for', async () => {
    await seedMirrors();
    const response = await mirrors(request('/api/mirrors?kinds=recovery', { bearer: SECRET }));
    const body = await bodyOf<{ rows: MirrorChange[] }>(response);
    expect(body.rows.map((row) => row.kind)).toEqual(['recovery', 'recovery']);
  });

  it('honours since', async () => {
    await seedMirrors();
    const since = encodeURIComponent(day(1).toISOString());
    const response = await mirrors(request(`/api/mirrors?since=${since}`, { bearer: SECRET }));
    const body = await bodyOf<{ rows: MirrorChange[] }>(response);
    expect(body.rows.map((row) => row.id)).toEqual(['rec-2', 'wko-gone']);
  });

  it('drops a cursor it did not mint rather than trusting it', async () => {
    await seedMirrors();
    const response = await mirrors(request('/api/mirrors?cursor=not-a-cursor', { bearer: SECRET }));
    const body = await bodyOf<{ rows: MirrorChange[] }>(response);
    expect(body.rows).toHaveLength(4);
  });

  /**
   * The last page names a position too.
   *
   * `next` used to be minted only while there was a page behind the one being
   * answered, so a feed that fitted inside one page named none at all. The
   * cursor is the row's `feed_seq` and no row on the wire carries it, so the
   * phone could not mint one either: it re-pulled and re-applied the same feed
   * on every run for ever. Null now means the page was empty.
   */
  it('names the last row position on every page that has rows', async () => {
    await seedMirrors();
    const first = await mirrors(request('/api/mirrors', { bearer: SECRET }));
    const page = await bodyOf<{ rows: MirrorChange[]; next: string | null }>(first);
    expect(page.rows).toHaveLength(4);
    expect(page.next).not.toBeNull();

    const cursor = encodeURIComponent(page.next ?? '');
    const second = await mirrors(request(`/api/mirrors?cursor=${cursor}`, { bearer: SECRET }));
    const empty = await bodyOf<{ rows: MirrorChange[]; next: string | null }>(second);
    expect(empty.rows).toEqual([]);
    // Nothing left to name a position for, which is the only null there is.
    expect(empty.next).toBeNull();
  });
});

/** Kept honest: the feed and the ops table agree on what has been applied. */
describe('the two feeds together', () => {
  it('shows a pushed op in the pull feed', async () => {
    await push([{ id: 'dev_test:1', kind: 'setLog.upsert', entityId: 'log-1', payload: aSetLog() }]);
    const ops = await db.select().from(syncOpTable).where(eq(syncOpTable.id, 'dev_test:1'));
    expect(ops).toHaveLength(1);
    const response = await syncPull(request('/api/sync/pull', { bearer: SECRET }));
    const body = await bodyOf<{ changes: SyncChange[] }>(response);
    expect(body.changes.map((change) => change.id)).toEqual(['dev_test:1']);
  });
});
