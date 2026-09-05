/**
 * The sync and idempotency probes, kept as the regression suite.
 *
 * Each test named one finding and now pins its fix. The payloads are copied
 * verbatim from the phone's own enqueue call sites, so this file is also the
 * record of what the app actually sends.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as mirrors } from '../src/app/api/mirrors/route';
import { GET as syncPull } from '../src/app/api/sync/pull/route';
import { POST as syncPush } from '../src/app/api/sync/push/route';
import type { Database } from '../src/db/client';
import { deviceSecret, syncOp as syncOpTable } from '../src/db/tables/account';
import { athlete, program, session, sessionEvent, setLog, week } from '../src/db/tables/mirror';
import type {
  MirrorsResponse,
  SyncPullResponse,
  SyncPushResponse,
  WhoopCycleRow,
} from '../src/lib/api-contract';
import { hashSecret } from '../src/lib/crypto';
import { exportCsv } from '../src/lib/export';
import { upsertCycles } from '../src/lib/whoop/mirrors';
import { bodyOf, harness, request, teardown } from './support/harness';

const SECRET = 'dev_test.a-device-secret-long-enough-to-pass-the-contract';
const CREATED = '2026-09-04T18:12:00.000Z';

let db: Database;

beforeEach(async () => {
  db = await harness();
  await db.insert(deviceSecret).values({
    id: 'dev_test',
    name: 'iPhone',
    secretHash: hashSecret(SECRET),
    pairedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
}, 60_000);

afterEach(() => {
  teardown();
});

interface OpInput {
  readonly id: string;
  readonly kind: string;
  readonly entityId: string | null;
  readonly payload: unknown;
  readonly createdAt?: string;
}

async function push(ops: readonly OpInput[]): Promise<SyncPushResponse> {
  const response = await syncPush(
    request('/api/sync/push', {
      method: 'POST',
      bearer: SECRET,
      body: { ops: ops.map((op) => ({ createdAt: CREATED, ...op })) },
    }),
  );
  expect(response.status).toBe(200);
  return bodyOf<SyncPushResponse>(response);
}

async function mirrorPage(query: string): Promise<MirrorsResponse> {
  const response = await mirrors(request(`/api/mirrors${query}`, { bearer: SECRET }));
  expect(response.status).toBe(200);
  return bodyOf<MirrorsResponse>(response);
}

function cycle(id: string, at: string, day: string): WhoopCycleRow {
  return {
    id,
    scoreState: 'SCORED',
    timezoneOffset: '-04:00',
    localDate: day,
    raw: { id },
    updatedAt: at,
    startAt: `${day}T08:00:00.000Z`,
    endAt: `${day}T20:00:00.000Z`,
    strain: 12.5,
    averageHeartRate: 61,
    kilojoule: 9100,
  };
}

/* ================================================================== 1 */

describe('the payloads the phone actually sends', () => {
  it('become rows, thin as they are', async () => {
    // Copied verbatim from the phone:
    //   useProgram.ts   program.create  { startDate, endDate, seed }
    //   useProgram.ts   week.upsert     { w }
    //   useProgram.ts   week.generated  { generatedBy }
    //   useSessions.ts  session.patch   the patch only
    // Every one of these used to be accepted, recorded as applied, and
    // projected nothing, because the columns they do not carry were NOT NULL.
    const result = await push([
      {
        id: 'dev_test:1',
        kind: 'program.create',
        entityId: 'prog_1',
        payload: { startDate: '2026-09-08', endDate: '2026-11-29', seed: 'seed-1' },
      },
      { id: 'dev_test:2', kind: 'week.upsert', entityId: 'week_1', payload: { w: 7 } },
      {
        id: 'dev_test:3',
        kind: 'week.generated',
        entityId: 'week_1',
        payload: { generatedBy: 'engine' },
      },
      { id: 'dev_test:4', kind: 'session.patch', entityId: 'sess_1', payload: { rpe: 8 } },
      {
        id: 'dev_test:5',
        kind: 'session.move',
        entityId: 'sess_1',
        payload: { toDate: '2026-09-10' },
      },
    ]);

    expect(result.accepted).toHaveLength(5);
    expect(result.rejected).toEqual([]);

    const programs = await db.select().from(program);
    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({ id: 'prog_1', seed: 'seed-1', startDate: '2026-09-08' });
    // What the phone never sent stays null rather than blocking the insert.
    expect(programs[0]?.rulesetVersion).toBeNull();

    const weeks = await db.select().from(week);
    expect(weeks).toHaveLength(1);
    // The program is derived: there is one owner and one live program.
    expect(weeks[0]).toMatchObject({ id: 'week_1', w: 7, programId: 'prog_1' });
    expect(weeks[0]?.generatedBy).toBe('engine');

    const sessions = await db.select().from(session);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'sess_1',
      rpe: 8,
      scheduledDate: '2026-09-10',
      programId: 'prog_1',
    });
  }, 60_000);

  it('reach the export, so the server really is the backup', async () => {
    await push([
      {
        id: 'dev_test:1',
        kind: 'program.create',
        entityId: 'prog_1',
        payload: { startDate: '2026-09-08', endDate: '2026-11-29', seed: 'seed-1' },
      },
      { id: 'dev_test:2', kind: 'week.upsert', entityId: 'week_1', payload: { w: 7 } },
      {
        id: 'dev_test:3',
        kind: 'session.patch',
        entityId: 'sess_1',
        payload: { rpe: 8, legsFeel: 'flat' },
      },
      {
        id: 'dev_test:4',
        kind: 'setLog.upsert',
        entityId: 'slog_1',
        payload: {
          sessionId: 'sess_1',
          sessionExerciseId: 'sx_1',
          setNumber: 1,
          repsDone: 5,
          loadKg: 93,
          completedAt: CREATED,
          entrySource: 'typed',
          idempotencyKey: 'set:sess_1:sx_1:1',
        },
      },
    ]);

    const at = new Date('2026-09-05T12:00:00.000Z');
    // sessions.csv and weeks.csv used to be a header row and nothing else,
    // while set-logs.csv had the sets: a backup with the work but no plan.
    expect((await exportCsv(db, 'sessions', at)).rowCount).toBe(1);
    expect((await exportCsv(db, 'weeks', at)).rowCount).toBe(1);
    expect((await exportCsv(db, 'set-logs', at)).rowCount).toBe(1);
  }, 60_000);

  it('gives a session finish a session to belong to', async () => {
    await push([
      { id: 'dev_test:1', kind: 'session.patch', entityId: 'sess_1', payload: { rpe: 8 } },
      { id: 'dev_test:2', kind: 'session.finish', entityId: 'sess_1', payload: {} },
    ]);
    expect(await db.select().from(sessionEvent)).toHaveLength(1);
    expect(await db.select().from(session)).toHaveLength(1);
  }, 60_000);
});

/* ================================================================== 2 */

describe('the mirror feed cursor', () => {
  it('reaches rows written after it, whatever their timestamps say', async () => {
    // A sync chunk stamps every record with one instant and Whoop pages newest
    // first, so page two's ids are lower than page one's at the same
    // updated_at. Paging on (updated_at, kind, id) made those rows invisible
    // for ever to a client whose cursor sat inside page one.
    const at = '2026-09-05T10:00:00.000Z';
    await upsertCycles(db, [
      cycle('93851904', at, '2026-09-01'),
      cycle('93851905', at, '2026-09-02'),
      cycle('93851906', at, '2026-09-03'),
      cycle('93851907', at, '2026-09-04'),
    ]);

    const first = await mirrorPage('?limit=2');
    expect(first.rows.map((row) => row.id)).toEqual(['93851904', '93851905']);
    const cursor = first.next ?? '';
    expect(cursor).not.toBe('');

    // The client stored that cursor. Now page two of the same chunk lands.
    await upsertCycles(db, [cycle('93851902', at, '2026-08-30'), cycle('93851903', at, '2026-08-31')]);

    const second = await mirrorPage(`?limit=200&cursor=${encodeURIComponent(cursor)}`);
    expect(second.rows.map((row) => row.id)).toEqual([
      '93851906',
      '93851907',
      '93851902',
      '93851903',
    ]);
    // The last page names the last row's position too, so the client has
    // something to store; a null would mean the page was empty.
    expect(second.next).not.toBeNull();
    const done = await mirrorPage(`?limit=200&cursor=${encodeURIComponent(second.next ?? '')}`);
    expect(done.rows).toEqual([]);
    expect(done.next).toBeNull();
  }, 60_000);

  it('sends an updated row again, at its new place in the feed', async () => {
    const at = '2026-09-05T10:00:00.000Z';
    await upsertCycles(db, [cycle('93851906', at, '2026-09-03')]);
    const first = await mirrorPage('?limit=1');
    expect(first.rows.map((row) => row.id)).toEqual(['93851906']);

    await upsertCycles(db, [cycle('93851907', at, '2026-09-04')]);
    await upsertCycles(db, [{ ...cycle('93851906', at, '2026-09-03'), strain: 14.1 }]);

    const rest = await mirrorPage(`?limit=200&cursor=${encodeURIComponent(first.next ?? '')}`);
    expect(rest.rows.map((row) => row.id)).toEqual(['93851907', '93851906']);
  }, 60_000);
});

/* ================================================================== 3 */

describe('the change feed', () => {
  it('replays a batch in the order the phone queued it', async () => {
    // The ids are `${deviceId}:${queueRowId}` and every op in a batch shares
    // one received_at, so ordering on (received_at, id) sorted "dev_test:10"
    // before "dev_test:9" and handed a consumer the undo before the write.
    await push([
      {
        id: 'dev_test:9',
        kind: 'setLog.upsert',
        entityId: 'slog_1',
        payload: {
          sessionId: 'sess_1',
          sessionExerciseId: 'sx_1',
          setNumber: 1,
          repsDone: 5,
          completedAt: CREATED,
          idempotencyKey: 'set:sess_1:sx_1:1',
        },
      },
      {
        id: 'dev_test:10',
        kind: 'setLog.delete',
        entityId: 'sx_1',
        payload: { sessionExerciseId: 'sx_1', setNumber: 1 },
      },
    ]);
    expect(await db.select().from(setLog)).toEqual([]);

    const feed = await bodyOf<SyncPullResponse>(
      await syncPull(request('/api/sync/pull?limit=200', { bearer: SECRET })),
    );
    expect(feed.changes.map((change) => change.id)).toEqual(['dev_test:9', 'dev_test:10']);
    expect(feed.changes[0]?.kind).toBe('setLog.upsert');
    expect(feed.changes[1]?.kind).toBe('setLog.delete');
  }, 60_000);

  it('keeps that order across pages', async () => {
    await push([
      { id: 'dev_test:9', kind: 'session.finish', entityId: 'sess_1', payload: {} },
      { id: 'dev_test:10', kind: 'session.unfinish', entityId: 'sess_1', payload: {} },
    ]);
    const first = await bodyOf<SyncPullResponse>(
      await syncPull(request('/api/sync/pull?limit=1', { bearer: SECRET })),
    );
    expect(first.changes[0]?.id).toBe('dev_test:9');
    expect(first.next).not.toBeNull();
    const second = await bodyOf<SyncPullResponse>(
      await syncPull(
        request(`/api/sync/pull?limit=1&cursor=${encodeURIComponent(first.next ?? '')}`, {
          bearer: SECRET,
        }),
      ),
    );
    expect(second.changes[0]?.id).toBe('dev_test:10');
  }, 60_000);
});

/* ================================================================== 4 */

describe('idempotency', () => {
  it('is a lock, not a read: two callers racing the same op project once', async () => {
    // The guard used to be a SELECT before the transaction, so two callers
    // could both miss it and both project. workingMax.set is a
    // read-modify-write of one JSON document, which is exactly what loses.
    const op: OpInput = {
      id: 'dev_test:77',
      kind: 'athlete.upsert',
      entityId: 'athlete_owner',
      payload: { timezone: 'America/New_York', bodyweightKg: 82 },
    };
    const [a, b] = await Promise.all([push([op]), push([op])]);
    expect(a.accepted).toEqual(['dev_test:77']);
    expect(b.accepted).toEqual(['dev_test:77']);
    expect(await db.select().from(syncOpTable)).toHaveLength(1);
    expect(await db.select().from(athlete)).toHaveLength(1);
  }, 60_000);

  it('replays an op it has already applied without applying it twice', async () => {
    const op: OpInput = {
      id: 'dev_test:5',
      kind: 'setLog.upsert',
      entityId: 'slog_1',
      payload: {
        sessionId: 'sess_1',
        sessionExerciseId: 'sx_1',
        setNumber: 1,
        repsDone: 5,
        completedAt: CREATED,
        idempotencyKey: 'set:sess_1:sx_1:1',
      },
    };
    expect((await push([op])).accepted).toEqual(['dev_test:5']);
    // A replay after a dropped response is accepted and changes nothing, which
    // is the whole point of the id being the key.
    expect((await push([op])).accepted).toEqual(['dev_test:5']);
    expect(await db.select().from(setLog)).toHaveLength(1);
  }, 60_000);
});

/* ================================================================== 5 */

describe('what a push answers', () => {
  it('stores a null payload, which the contract says is legal', async () => {
    // `jsonValue` includes null and the phone writes `row.payload ?? null`,
    // while sync_op.payload was jsonb NOT NULL: the insert died, the answer
    // was reason 'error', and the phone retried that op for ever.
    const result = await push([
      { id: 'dev_test:1', kind: 'session.finish', entityId: 'sess_1', payload: null },
      { id: 'dev_test:2', kind: 'session.finish', entityId: 'sess_2', payload: {} },
    ]);
    expect(result.accepted).toEqual(['dev_test:1', 'dev_test:2']);
    expect(result.rejected).toEqual([]);

    const feed = await bodyOf<SyncPullResponse>(
      await syncPull(request('/api/sync/pull?limit=200', { bearer: SECRET })),
    );
    expect(feed.changes[0]?.payload).toBeNull();
  }, 60_000);

  it('never puts a driver message in the answer', async () => {
    // An int4 column and a number that does not fit in one: a real driver
    // error, whose message names the SQL and every bound parameter.
    const result = await push([
      {
        id: 'dev_test:1',
        kind: 'jumpTest.create',
        entityId: 'jt_1',
        payload: {
          localDate: '2026-09-05',
          instrument: 'ovr_jump',
          attempts: [{ attemptIndex: 1, heightMm: 9_999_999_999 }],
        },
      },
    ]);
    expect(result.rejected).toHaveLength(1);
    const rejected = result.rejected[0];
    expect(rejected?.reason).toBe('error');
    expect(rejected?.message).not.toContain('insert into');
    expect(rejected?.message).not.toContain('params:');
    expect(rejected?.message).toBe(
      'The server could not apply that change. It will be sent again.',
    );
  }, 60_000);

  it('names a set that is already logged as a conflict', async () => {
    const base = {
      sessionId: 'sess_1',
      sessionExerciseId: 'sx_1',
      setNumber: 1,
      completedAt: CREATED,
    };
    await push([
      {
        id: 'dev_test:1',
        kind: 'setLog.upsert',
        entityId: 'slog_a',
        payload: { ...base, repsDone: 5, idempotencyKey: 'set:sess_1:sx_1:1' },
      },
    ]);

    // A different row id for the same (session_exercise_id, set_number), which
    // the table declares UNIQUE. An untargeted onConflictDoNothing() used to
    // swallow it and answer "accepted", so the reps the athlete logged were
    // discarded and the phone marked the row synced.
    const second = await push([
      {
        id: 'dev_test:2',
        kind: 'setLog.upsert',
        entityId: 'slog_b',
        payload: { ...base, repsDone: 8, idempotencyKey: 'set:sess_1:sx_1:1:again' },
      },
    ]);
    expect(second.accepted).toEqual([]);
    expect(second.rejected).toHaveLength(1);
    expect(second.rejected[0]?.reason).toBe('conflict');

    const rows = await db.select().from(setLog);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('slog_a');
  }, 60_000);
});
