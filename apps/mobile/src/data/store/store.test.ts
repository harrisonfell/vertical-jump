import { beforeEach, describe, expect, it } from 'vitest';
import type { SqlExecutor } from '../executor';
import { openMigratedTestDb } from '../testing/testDb';
import { getAthlete, isAthleteEmpty, reportPain, listPainStatus, upsertAthlete } from './athlete';
import { createProgram, getCurrentProgram, upsertWeek } from './program';
import {
  createSession,
  deriveStatus,
  getSession,
  listSessionExercises,
  listSessionsByWeek,
  markSessionComplete,
  undoSessionComplete,
  weekAdherenceInputs,
} from './sessions';
import { defaultIdempotencyKey, listSetLogs, logSet, loggedSetNumbers, undoSet } from './setLogs';
import { createJumpTest, deleteJumpTest, listPrs, recomputePrs } from './jumpTests';
import { enqueue, getSyncStatus, listPending, markAttempted, markSynced } from './sync';
import { getRecoveryForDay, listRecovery, upsertWhoopRecovery } from './whoop';
import { startImport } from './imports';

const TODAY = '2026-09-08';
const YESTERDAY = '2026-09-07';
const TOMORROW = '2026-09-09';

let db: SqlExecutor;

async function seedProgram(): Promise<{ programId: string; weekId: string }> {
  await upsertAthlete(db, { timezone: 'America/New_York', rolloverHour: 4 });
  const { program } = await createProgram(db, {
    rulesetVersion: 'v1',
    seed: 'seed',
    startDate: YESTERDAY,
    endDate: '2026-11-29',
    snapshot: { note: 'test' },
    weekLayout: { weeks: 12 },
  });
  const week = await upsertWeek(db, {
    programId: program.id,
    w: 1,
    windowStart: YESTERDAY,
    windowEnd: '2026-09-13',
    kind: 'load',
    prescribedCount: 2,
  });
  return { programId: program.id, weekId: week.id };
}

interface Made {
  readonly sessionId: string;
  readonly exerciseId: string;
}

async function makeSession(
  programId: string,
  weekId: string,
  scheduledDate: string,
  orderIndex: number,
  sets = 3,
): Promise<Made> {
  const sessionId = await createSession(db, {
    programId,
    weekId,
    scheduledDate,
    orderIndex,
    dayType: 'Lower Strength',
    exercises: [
      {
        exerciseId: 'back_squat',
        exerciseName: 'Back squat',
        orderIndex: 0,
        loadType: 'heavy_strength',
        perSet: Array.from({ length: sets }, (_, index) => ({ setNumber: index + 1, reps: 5 })),
      },
    ],
  });
  const exercises = await listSessionExercises(db, sessionId);
  const exerciseId = exercises[0]?.id;
  if (exerciseId === undefined) throw new Error('the session exercise did not save');
  return { sessionId, exerciseId };
}

beforeEach(async () => {
  db = await openMigratedTestDb();
});

describe('athlete', () => {
  it('is a singleton that patches field by field', async () => {
    expect(await isAthleteEmpty(db)).toBe(true);

    await upsertAthlete(db, { timezone: 'America/New_York', rolloverHour: 4, level: 'advanced' });
    await upsertAthlete(db, { goalHeightMm: 914 });

    const athlete = await getAthlete(db);
    expect(athlete?.level).toBe('advanced');
    expect(athlete?.rolloverHour).toBe(4);
    expect(athlete?.goalHeightMm).toBe(914);
    expect(await isAthleteEmpty(db)).toBe(false);
  });

  it('stores the best recent set per lift, and a patch without one leaves it', async () => {
    await upsertAthlete(db, { timezone: 'UTC' });
    await upsertAthlete(db, {
      bestSets: { box_squat: { reps: 2, loadKg: 138.346, rpe: 8.5, at: '2026-08-31' } },
    });
    await upsertAthlete(db, { bodyweightKg: 68 });

    const athlete = await getAthlete(db);
    expect(athlete?.bodyweightKg).toBeCloseTo(68, 5);
    // Additive and patched field by field: a save that says nothing about the
    // best sets leaves the ones on file exactly where they were.
    expect(athlete?.bestSets).toMatchObject({ box_squat: { reps: 2, rpe: 8.5 } });
  });

  it('supersedes the open pain row for a location rather than stacking them', async () => {
    await upsertAthlete(db, { timezone: 'UTC' });
    await reportPain(db, {
      location: 'knee',
      severityRaw: 6,
      severityDerived: 'severe',
      onset: 'acute',
    });
    await reportPain(db, {
      location: 'knee',
      severityRaw: 2,
      severityDerived: 'mild',
      onset: 'acute',
    });

    const open = await listPainStatus(db);
    expect(open).toHaveLength(1);
    expect(open[0]?.severityRaw).toBe(2);
    expect(await listPainStatus(db, true)).toHaveLength(2);
  });
});

describe('set logs', () => {
  it('is idempotent: the same tap twice writes one row', async () => {
    const { programId, weekId } = await seedProgram();
    const { sessionId, exerciseId } = await makeSession(programId, weekId, TODAY, 0);

    const first = await logSet(db, {
      sessionId,
      sessionExerciseId: exerciseId,
      setNumber: 1,
      repsDone: 5,
      loadKg: 100,
    });
    const second = await logSet(db, {
      sessionId,
      sessionExerciseId: exerciseId,
      setNumber: 1,
      repsDone: 5,
      loadKg: 100,
    });

    expect(second.id).toBe(first.id);
    const rows = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM set_log');
    expect(rows[0]?.n).toBe(1);
  });

  it('undoes one set without touching its neighbours', async () => {
    const { programId, weekId } = await seedProgram();
    const { sessionId, exerciseId } = await makeSession(programId, weekId, TODAY, 0);

    await logSet(db, { sessionId, sessionExerciseId: exerciseId, setNumber: 1, repsDone: 5 });
    await logSet(db, { sessionId, sessionExerciseId: exerciseId, setNumber: 2, repsDone: 5 });

    expect(await undoSet(db, exerciseId, 1)).toBe(true);
    expect(await undoSet(db, exerciseId, 1)).toBe(false);

    const session = await getSession(db, sessionId, TODAY);
    expect(session?.loggedSetCount).toBe(1);
  });

  it('writes the row and its outbox op as one unit', async () => {
    // The contract is one unit of work. Enqueuing after the transaction leaves
    // a window in which a kill produces a set that is on the phone and will
    // never reach the server, with nothing in the app able to notice.
    const { programId, weekId } = await seedProgram();
    const { sessionId, exerciseId } = await makeSession(programId, weekId, TODAY, 0);

    const saved = await logSet(
      db,
      { sessionId, sessionExerciseId: exerciseId, setNumber: 1, repsDone: 5 },
      (row) => [{ kind: 'setLog.upsert', entityId: row.id, payload: row }],
    );

    const pending = await listPending(db);
    expect(pending.filter((op) => op.entityId === saved.id)).toHaveLength(1);
  });

  it('does not stack a second identical op when a tap is replayed', async () => {
    const { programId, weekId } = await seedProgram();
    const { sessionId, exerciseId } = await makeSession(programId, weekId, TODAY, 0);

    const input = { sessionId, sessionExerciseId: exerciseId, setNumber: 1, repsDone: 5 };
    const first = await logSet(db, input, (row) => [
      { kind: 'setLog.upsert', entityId: row.id, payload: row },
    ]);
    const second = await logSet(db, input, (row) => [
      { kind: 'setLog.upsert', entityId: row.id, payload: row },
    ]);

    expect(second.id).toBe(first.id);
    const pending = await listPending(db);
    expect(pending.filter((op) => op.op === 'setLog.upsert')).toHaveLength(1);
  });

  it('stamps the session start from the first log, once', async () => {
    const { programId, weekId } = await seedProgram();
    const { sessionId, exerciseId } = await makeSession(programId, weekId, TODAY, 0);

    await logSet(db, {
      sessionId,
      sessionExerciseId: exerciseId,
      setNumber: 1,
      completedAt: '2026-09-08T18:00:00.000Z',
    });
    await logSet(db, {
      sessionId,
      sessionExerciseId: exerciseId,
      setNumber: 2,
      completedAt: '2026-09-08T18:06:00.000Z',
    });

    const session = await getSession(db, sessionId, TODAY);
    expect(session?.startedAt).toBe('2026-09-08T18:00:00.000Z');
  });
});

describe('a unilateral set logged per side', () => {
  /**
   * The session that asked for this: single-leg RDLs at 30, 35 and 40 lb, the
   * right leg never above RPE 6 and the left up at 8. Three sets, two legs, two
   * different answers, and the row is still the three sets it prescribed.
   */
  const SESSION_LB: readonly { lb: number; left: number; right: number }[] = [
    { lb: 30, left: 6, right: 5 },
    { lb: 35, left: 7, right: 6 },
    { lb: 40, left: 8, right: 6 },
  ];

  async function logBothLegs(sessionId: string, exerciseId: string): Promise<void> {
    for (const [index, entry] of SESSION_LB.entries()) {
      for (const side of ['left', 'right'] as const) {
        await logSet(db, {
          sessionId,
          sessionExerciseId: exerciseId,
          setNumber: index + 1,
          repsDone: 8,
          loadKg: entry.lb * 0.45359237,
          rpe: side === 'left' ? entry.left : entry.right,
          side,
        });
      }
    }
  }

  it('keeps both legs, under one set number each', async () => {
    const { programId, weekId } = await seedProgram();
    const { sessionId, exerciseId } = await makeSession(programId, weekId, TODAY, 0);

    await logBothLegs(sessionId, exerciseId);

    const logs = await listSetLogs(db, sessionId);
    expect(logs).toHaveLength(6);
    expect(logs.filter((log) => log.side === 'left')).toHaveLength(3);
    expect(logs.filter((log) => log.side === 'right')).toHaveLength(3);
    const third = logs.filter((log) => log.setNumber === 3);
    expect(third.find((log) => log.side === 'left')?.rpe).toBe(8);
    expect(third.find((log) => log.side === 'right')?.rpe).toBe(6);
  });

  it('is still three sets to the runner and to the session', async () => {
    const { programId, weekId } = await seedProgram();
    const { sessionId, exerciseId } = await makeSession(programId, weekId, TODAY, 0);

    await logBothLegs(sessionId, exerciseId);

    expect(await loggedSetNumbers(db, exerciseId)).toEqual([1, 2, 3]);
    const session = await getSession(db, sessionId, TODAY);
    expect(session?.loggedSetCount).toBe(3);
  });

  it('collapses a replayed tap onto the same leg rather than inflating it', async () => {
    const { programId, weekId } = await seedProgram();
    const { sessionId, exerciseId } = await makeSession(programId, weekId, TODAY, 0);

    const input = {
      sessionId,
      sessionExerciseId: exerciseId,
      setNumber: 1,
      repsDone: 8,
      side: 'left',
    } as const;
    const first = await logSet(db, input);
    const again = await logSet(db, input);
    expect(again.id).toBe(first.id);

    const other = await logSet(db, { ...input, side: 'right' });
    expect(other.id).not.toBe(first.id);
    expect(await listSetLogs(db, sessionId)).toHaveLength(2);
  });

  it('takes back both legs when the set is undone', async () => {
    const { programId, weekId } = await seedProgram();
    const { sessionId, exerciseId } = await makeSession(programId, weekId, TODAY, 0);

    await logBothLegs(sessionId, exerciseId);
    expect(await undoSet(db, exerciseId, 3)).toBe(true);

    const logs = await listSetLogs(db, sessionId);
    expect(logs.filter((log) => log.setNumber === 3)).toHaveLength(0);
    expect(await loggedSetNumbers(db, exerciseId)).toEqual([1, 2]);
  });

  it('leaves the key of a both-sides set exactly as it was', () => {
    const both = { sessionId: 'sess', sessionExerciseId: 'ex', setNumber: 2 };
    expect(defaultIdempotencyKey(both)).toBe('set:sess:ex:2');
    expect(defaultIdempotencyKey({ ...both, side: null })).toBe('set:sess:ex:2');
    expect(defaultIdempotencyKey({ ...both, side: 'left' })).toBe('set:sess:ex:2:left');
  });
});

describe('derived session status', () => {
  it('derives planned, not finished, done, and missed', () => {
    expect(deriveStatus(0, null, TOMORROW, TODAY)).toBe('planned');
    expect(deriveStatus(0, null, TODAY, TODAY)).toBe('planned');
    expect(deriveStatus(0, null, YESTERDAY, TODAY)).toBe('missed');
    expect(deriveStatus(7, null, YESTERDAY, TODAY)).toBe('not_finished');
    expect(deriveStatus(7, '2026-09-07T19:00:00Z', YESTERDAY, TODAY)).toBe('done');
    // A finished session with no logs at all is still finished.
    expect(deriveStatus(0, '2026-09-07T19:00:00Z', YESTERDAY, TODAY)).toBe('done');
  });

  it('reads the status off the logs and the finish event, never a stamp', async () => {
    const { programId, weekId } = await seedProgram();
    const past = await makeSession(programId, weekId, YESTERDAY, 0);
    const today = await makeSession(programId, weekId, TODAY, 1);

    expect((await getSession(db, past.sessionId, TODAY))?.status).toBe('missed');
    expect((await getSession(db, today.sessionId, TODAY))?.status).toBe('planned');

    await logSet(db, { sessionId: past.sessionId, sessionExerciseId: past.exerciseId, setNumber: 1 });
    expect((await getSession(db, past.sessionId, TODAY))?.status).toBe('not_finished');

    await markSessionComplete(db, past.sessionId, '2026-09-07T19:30:00.000Z');
    expect((await getSession(db, past.sessionId, TODAY))?.status).toBe('done');

    await undoSessionComplete(db, past.sessionId, '2026-09-07T19:40:00.000Z');
    expect((await getSession(db, past.sessionId, TODAY))?.status).toBe('not_finished');

    await markSessionComplete(db, past.sessionId, '2026-09-07T19:50:00.000Z');
    expect((await getSession(db, past.sessionId, TODAY))?.status).toBe('done');
  });
});

describe('adherence inputs', () => {
  it('counts prescribed and completed sessions and whether every set has a log', async () => {
    const { programId, weekId } = await seedProgram();
    const a = await makeSession(programId, weekId, YESTERDAY, 0, 2);
    const b = await makeSession(programId, weekId, TODAY, 1, 2);

    let inputs = await weekAdherenceInputs(db, weekId, TODAY);
    expect(inputs.prescribedCount).toBe(2);
    expect(inputs.completedCount).toBe(0);
    expect(inputs.prescribedSets).toBe(4);
    expect(inputs.allRepsCompleted).toBe(false);

    for (const setNumber of [1, 2]) {
      await logSet(db, { sessionId: a.sessionId, sessionExerciseId: a.exerciseId, setNumber });
      await logSet(db, { sessionId: b.sessionId, sessionExerciseId: b.exerciseId, setNumber });
    }
    await markSessionComplete(db, a.sessionId);
    await markSessionComplete(db, b.sessionId);

    inputs = await weekAdherenceInputs(db, weekId, TODAY);
    expect(inputs.completedCount).toBe(2);
    expect(inputs.adherencePct).toBe(100);
    expect(inputs.loggedSets).toBe(4);
    expect(inputs.allRepsCompleted).toBe(true);

    const sessions = await listSessionsByWeek(db, weekId, TODAY);
    expect(sessions.map((session) => session.status)).toEqual(['done', 'done']);
  });
});

describe('PR recompute', () => {
  const mm = (inches: number): number => Math.round(inches * 25.4);

  async function test(day: string, best: number): Promise<string> {
    const created = await createJumpTest(db, {
      localDate: day,
      instrument: 'ovr_jump_regular',
      attempts: [{ attemptIndex: 1, heightMm: mm(best - 0.5) }, { attemptIndex: 2, heightMm: mm(best) }],
    });
    return created.id;
  }

  it('holds PRs back through calibration, then honours the threshold', async () => {
    await upsertAthlete(db, { timezone: 'UTC' });
    await test('2026-08-01', 29.0);
    await test('2026-08-08', 30.5);
    await test('2026-08-15', 31.0);
    // Still calibrating for the first three sessions.
    expect(await listPrs(db, 'ovr_jump_regular')).toHaveLength(0);

    await test('2026-08-22', 31.5); // +0.5 in, under the 1.0 in threshold
    expect(await listPrs(db, 'ovr_jump_regular')).toHaveLength(0);

    await test('2026-08-29', 32.5); // +1.0 in on the running best
    const prs = await listPrs(db, 'ovr_jump_regular');
    expect(prs).toHaveLength(1);
    expect(prs[0]?.localDate).toBe('2026-08-29');
    expect(prs[0]?.previousValueMm).toBe(mm(31.5));
  });

  it('recomputes after a delete so a removed PR does not linger', async () => {
    await upsertAthlete(db, { timezone: 'UTC' });
    await test('2026-08-01', 29.0);
    await test('2026-08-08', 29.2);
    await test('2026-08-15', 29.4);
    const prTestId = await test('2026-08-22', 31.0);
    expect(await listPrs(db, 'ovr_jump_regular')).toHaveLength(1);

    await deleteJumpTest(db, prTestId);
    expect(await listPrs(db, 'ovr_jump_regular')).toHaveLength(0);
  });

  it('never crosses instrument streams', async () => {
    await upsertAthlete(db, { timezone: 'UTC' });
    for (const day of ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22']) {
      await createJumpTest(db, {
        localDate: day,
        instrument: 'vertec_reach_touch',
        attempts: [{ attemptIndex: 1, heightMm: mm(40) }],
      });
    }
    await test('2026-08-29', 30.0);
    await recomputePrs(db, 'ovr_jump_regular');
    expect(await listPrs(db, 'ovr_jump_regular')).toHaveLength(0);
  });
});

describe('sync queue', () => {
  it('drains in the order the changes happened', async () => {
    await enqueue(db, { kind: 'a', entityId: '1', payload: { n: 1 } });
    await enqueue(db, { kind: 'b', entityId: '2', payload: { n: 2 } });
    await enqueue(db, { kind: 'c', entityId: '3', payload: { n: 3 } });

    const pending = await listPending(db);
    expect(pending.map((row) => row.op)).toEqual(['a', 'b', 'c']);
    expect(pending[0]?.payload).toEqual({ n: 1 });

    await markAttempted(db, [pending[0]?.id ?? 0], 'offline');
    expect((await listPending(db))[0]?.attempts).toBe(1);

    const before = await getSyncStatus(db);
    expect(before.pending).toBe(3);
    expect(before.oldestPendingAt).not.toBeNull();
    expect(before.lastSyncedAt).toBeNull();

    await markSynced(db, pending.map((row) => row.id));
    const after = await getSyncStatus(db);
    expect(after.pending).toBe(0);
    expect(after.lastSyncedAt).not.toBeNull();
  });
});

describe('whoop mirrors', () => {
  const raw = { id: 'r1', score_state: 'PENDING_SCORE' };

  it('upserts by Whoop id, keeps the raw JSON, and moves score_state', async () => {
    await upsertWhoopRecovery(db, {
      id: 'r1',
      scoreState: 'PENDING_SCORE',
      localDate: '2026-09-08',
      raw,
    });
    let saved = await getRecoveryForDay(db, '2026-09-08');
    expect(saved?.scoreState).toBe('PENDING_SCORE');
    expect(saved?.recoveryScore).toBeNull();
    expect(saved?.raw).toEqual(raw);

    await upsertWhoopRecovery(db, {
      id: 'r1',
      scoreState: 'SCORED',
      localDate: '2026-09-08',
      recoveryScore: 68,
      hrvRmssdMilli: 74.2,
      raw: { ...raw, score_state: 'SCORED', score: { recovery_score: 68 } },
    });
    saved = await getRecoveryForDay(db, '2026-09-08');
    expect(saved?.scoreState).toBe('SCORED');
    expect(saved?.recoveryScore).toBe(68);
    expect(saved?.hrvRmssdMilli).toBeCloseTo(74.2);

    const rows = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM whoop_recovery');
    expect(rows[0]?.n).toBe(1);
  });

  it('returns a range with gaps rather than zeros', async () => {
    await upsertWhoopRecovery(db, { id: 'a', scoreState: 'SCORED', localDate: '2026-09-01', recoveryScore: 60, raw });
    await upsertWhoopRecovery(db, { id: 'b', scoreState: 'SCORED', localDate: '2026-09-03', recoveryScore: 70, raw });
    const range = await listRecovery(db, '2026-09-01', '2026-09-04');
    expect(range.map((row) => row.localDate)).toEqual(['2026-09-01', '2026-09-03']);
  });
});

describe('imports', () => {
  it('treats a re-import of the same file as a no-op', async () => {
    const first = await startImport(db, { fileHash: 'abc123', type: 'ovr_connect', rowCount: 312 });
    expect(first.isNew).toBe(true);

    const second = await startImport(db, { fileHash: 'abc123', type: 'ovr_connect', rowCount: 312 });
    expect(second.isNew).toBe(false);
    expect(second.batch.id).toBe(first.batch.id);
  });
});

describe('program', () => {
  it('supersedes the previous active program', async () => {
    await upsertAthlete(db, { timezone: 'UTC' });
    const first = await createProgram(db, {
      rulesetVersion: 'v1',
      seed: 'a',
      startDate: '2026-01-05',
      endDate: '2026-03-29',
      snapshot: {},
      weekLayout: {},
    });
    const second = await createProgram(db, {
      rulesetVersion: 'v1',
      seed: 'b',
      startDate: '2026-09-07',
      endDate: '2026-11-29',
      snapshot: {},
      weekLayout: {},
    });

    const current = await getCurrentProgram(db);
    expect(current?.id).toBe(second.program.id);
    expect(current?.id).not.toBe(first.program.id);
  });
});
