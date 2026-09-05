import { describe, expect, it } from 'vitest';
import { inToMm } from '@vert/engine/units';
import type { SqlExecutor } from '../executor';
import { openMigratedTestDb } from '../testing/testDb';
import { upsertAthlete } from './athlete';
import { createJumpTest } from './jumpTests';
import { createProgram, upsertWeek } from './program';
import { createSession } from './sessions';
import {
  bestAttempt,
  createReadinessTest,
  getReadinessOutcome,
  getSessionAnswer,
  listReadinessTests,
  listSessionAnswers,
  listSingleLegTests,
  readWeakerSide,
  setReadinessOutcome,
  setSessionAnswer,
  SINGLE_LEG_MODE,
} from './readiness';

/**
 * The three climbing streams, against the same sql.js engine the web build
 * runs on.
 *
 * The properties worth pinning are the ones a screen would otherwise get wrong
 * quietly: one readiness test a day, one outcome a session, one finger answer
 * a day, and a single-leg pair that never becomes a canonical test.
 */

async function open(): Promise<SqlExecutor> {
  const db = await openMigratedTestDb();
  await upsertAthlete(db, { timezone: 'America/New_York', rolloverHour: 3 });
  return db;
}

describe('the readiness test stream', () => {
  it('keeps one test a day and takes the best attempt as the day number', async () => {
    const db = await open();

    const first = await createReadinessTest(db, {
      localDate: '2026-10-22',
      kind: 'seated_mb_throw',
      metric: 'distance_m',
      attempts: [6.95, 7.05, 7.15],
      unit: 'm',
    });
    expect(first.best).toBeCloseTo(7.15, 5);
    expect(first.attempts).toEqual([6.95, 7.05, 7.15]);

    // Logged again the same day: the row moves, it does not double the day's
    // weight in the rolling median.
    const again = await createReadinessTest(db, {
      localDate: '2026-10-22',
      kind: 'seated_mb_throw',
      metric: 'distance_m',
      attempts: [7.2],
      unit: 'm',
    });
    expect(again.id).toBe(first.id);
    expect(await listReadinessTests(db, { kind: 'seated_mb_throw' })).toHaveLength(1);

    await db.closeAsync();
  });

  it('lists one kind, oldest first, and stops at a day', async () => {
    const db = await open();
    for (const [date, best] of [
      ['2026-10-15', 7.0],
      ['2026-10-20', 7.2],
      ['2026-10-22', 7.15],
    ] as const) {
      await createReadinessTest(db, {
        localDate: date,
        kind: 'seated_mb_throw',
        metric: 'distance_m',
        attempts: [best],
        unit: 'm',
      });
    }
    await createReadinessTest(db, {
      localDate: '2026-10-21',
      kind: 'cmj',
      metric: 'height_in',
      attempts: [31.2],
      unit: 'in',
    });

    const throws = await listReadinessTests(db, { kind: 'seated_mb_throw' });
    expect(throws.map((row) => row.localDate)).toEqual(['2026-10-15', '2026-10-20', '2026-10-22']);

    const upToYesterday = await listReadinessTests(db, {
      kind: 'seated_mb_throw',
      onOrBefore: '2026-10-21',
    });
    expect(upToYesterday.map((row) => row.localDate)).toEqual(['2026-10-15', '2026-10-20']);

    await db.closeAsync();
  });

  it('reads no attempts as no number rather than as a zero', () => {
    expect(bestAttempt([])).toBeNull();
    expect(bestAttempt([Number.NaN])).toBeNull();
    expect(bestAttempt([6.9, 7.15, 7.0])).toBeCloseTo(7.15, 5);
  });
});

/** A real session, because an outcome hangs on one and is dropped with it. */
async function aSession(db: SqlExecutor): Promise<string> {
  const { program } = await createProgram(db, {
    rulesetVersion: 'v1',
    seed: 'seed',
    startDate: '2026-10-19',
    endDate: '2026-11-29',
    snapshot: {},
    weekLayout: {},
  });
  const week = await upsertWeek(db, {
    programId: program.id,
    w: 7,
    windowStart: '2026-10-19',
    windowEnd: '2026-10-25',
    kind: 'load',
  });
  return createSession(db, {
    programId: program.id,
    weekId: week.id,
    scheduledDate: '2026-10-22',
    orderIndex: 2,
    dayType: 'Power + Speed',
    exercises: [],
  });
}

describe('the readiness outcome', () => {
  it('keeps one a session, and the latest answer stands', async () => {
    const db = await open();
    const sessionId = await aSession(db);
    await setReadinessOutcome(db, {
      sessionId,
      localDate: '2026-10-22',
      state: 'both_high',
      channels: [{ name: 'autonomic' }, { name: 'neuromuscular' }],
      adjustment: { tierDown: false },
      line: 'Both channels read high. As written.',
      houseRuleId: 'house.sc.readiness_gate',
    });
    await setReadinessOutcome(db, {
      sessionId,
      localDate: '2026-10-22',
      state: 'neuromuscular_low',
      channels: [{ name: 'autonomic' }, { name: 'neuromuscular' }],
      adjustment: { tierDown: true },
      line: 'Throw 6.4 m. One tier down.',
      houseRuleId: 'house.sc.readiness_gate',
    });

    const saved = await getReadinessOutcome(db, sessionId);
    expect(saved?.state).toBe('neuromuscular_low');
    expect(saved?.line).toBe('Throw 6.4 m. One tier down.');
    expect(saved?.adjustment).toEqual({ tierDown: true });

    await db.closeAsync();
  });
});

describe('the finger answer', () => {
  it('keeps one answer a day and moves it when it is answered again', async () => {
    const db = await open();
    await setSessionAnswer(db, { localDate: '2026-10-22', kind: 'finger_pain', value: 2 });
    const changed = await setSessionAnswer(db, {
      localDate: '2026-10-22',
      kind: 'finger_pain',
      value: 5,
      sessionId: 'session-1',
    });
    expect(changed.value).toBe(5);
    expect(changed.sessionId).toBe('session-1');

    expect((await getSessionAnswer(db, '2026-10-22'))?.value).toBe(5);
    expect(await getSessionAnswer(db, '2026-10-21')).toBeNull();
    expect(await listSessionAnswers(db, 'finger_pain')).toHaveLength(1);

    // Zero is an answer, not an absence.
    await setSessionAnswer(db, { localDate: '2026-10-23', kind: 'finger_pain', value: 0 });
    expect((await getSessionAnswer(db, '2026-10-23'))?.value).toBe(0);

    await db.closeAsync();
  });
});

describe('the single-leg stream', () => {
  it('reads a pair back as a signed gap and never as a canonical test', async () => {
    const db = await open();
    await createJumpTest(db, {
      localDate: '2026-10-13',
      instrument: 'ovr_jump_regular',
      mode: SINGLE_LEG_MODE,
      canonical: false,
      attempts: [
        { attemptIndex: 1, heightMm: Math.round(inToMm(17.9)), side: 'left' },
        { attemptIndex: 2, heightMm: Math.round(inToMm(19.2)), side: 'right' },
      ],
    });

    const tests = await listSingleLegTests(db);
    expect(tests).toHaveLength(1);
    expect(tests[0]?.leftIn).toBeCloseTo(17.9, 1);
    expect(tests[0]?.rightIn).toBeCloseTo(19.2, 1);
    // Negative: the right leg jumped higher, so the left one is weaker.
    expect(tests[0]?.asymmetryPct).toBeLessThan(0);
    expect(tests[0]?.weakerSide).toBe('left');

    // The gap decides the order, and the athlete's own answer only when no
    // test does (`house.sc.weaker_side_first`).
    expect(await readWeakerSide(db, null)).toBe('left');
    expect(await readWeakerSide(db, 'right', 50)).toBe('right');

    await db.closeAsync();
  });

  it('ignores a rep with no side, so a half-logged pair names no side', async () => {
    const db = await open();
    await createJumpTest(db, {
      localDate: '2026-10-13',
      instrument: 'ovr_jump_regular',
      mode: SINGLE_LEG_MODE,
      canonical: false,
      attempts: [{ attemptIndex: 1, heightMm: 455, side: 'left' }, { attemptIndex: 2, heightMm: 488 }],
    });
    expect(await listSingleLegTests(db)).toEqual([]);
    expect(await readWeakerSide(db, null)).toBeNull();
    await db.closeAsync();
  });
});
