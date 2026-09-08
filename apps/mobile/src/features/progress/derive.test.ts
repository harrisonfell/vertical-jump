import { describe, expect, it } from 'vitest';
import { lbToKg } from '@vert/engine/units';
import type { LiftSetRow } from '@/data';
import {
  bodyweightRows,
  ledgerRows,
  liftRows,
  meanRecovery,
  readinessReps,
  readinessRows,
  weekRows,
  weekSrpe,
} from './derive';
import {
  FIXTURE_START,
  fixtureSession,
  fixtureTests,
  fixtureWeek,
  makeRep,
  makeTest,
} from './fixtureRows';

describe('the test ledger', () => {
  it('lists every test newest first with its flags', () => {
    const rows = ledgerRows(fixtureTests());
    expect(rows).toHaveLength(6);
    expect(rows[0]?.bestIn).toBe('32.5');
    expect(rows[0]?.isPr).toBe(true);
    expect(rows[5]?.isBaseline).toBe(true);
    expect(rows[0]?.dateLabel).toBe('Thu 15 Oct');
    expect(rows[0]?.instrumentLabel).toBe('OVR Jump');
    expect(rows[0]?.attempts).toBe(3);
    expect(rows[0]?.flagged).toBe(0);
    expect(rows[0]?.bodyweightLb).toBe('181 lb');
  });

  it('counts flagged attempts and keeps them out of the best', () => {
    const test = makeTest({ id: 'flagged', date: '2026-10-15', heightIn: 30 });
    const withFlag = {
      ...test,
      reps: [...test.reps, makeRep(4, 900, true)],
    };
    const row = ledgerRows([withFlag])[0];
    expect(row?.attempts).toBe(4);
    expect(row?.flagged).toBe(1);
    expect(row?.bestIn).toBe('30.0');
  });

  it('marks a test that is not canonical, so nothing reads it as a trend point', () => {
    const warmUp = makeTest({
      id: 'warm',
      date: '2026-10-15',
      heightIn: 28,
      canonical: false,
    });
    expect(ledgerRows([warmUp])[0]?.canonical).toBe(false);
  });
});

describe('bodyweight beside tests', () => {
  it('drops the tests that recorded no weight', () => {
    const tests = [
      makeTest({ id: 'a', date: '2026-10-01', heightIn: 30, bodyweightKg: null }),
      makeTest({ id: 'b', date: '2026-10-08', heightIn: 31 }),
    ];
    expect(bodyweightRows(tests)).toEqual([{ date: '8 Oct', lb: '181 lb' }]);
  });
});

describe('week rows', () => {
  const recovery = new Map<string, number | null>();

  it('counts adherence from the sessions rather than the cached column', () => {
    const week = fixtureWeek(7, { completedCount: 99, prescribedCount: 99 });
    const sessions = [
      fixtureSession(7, 0),
      fixtureSession(7, 1),
      fixtureSession(7, 3, { status: 'missed', markedCompleteAt: null }),
    ];
    const rows = weekRows({
      weeks: [week],
      sessions,
      programWeeks: 12,
      currentW: 7,
      tests: [],
      recoveryByDay: recovery,
      trendInPerWk: null,
      requiredInPerWk: null,
    });
    expect(rows[0]?.sessions).toBe('2/3');
    expect(rows[0]?.percent).toBe('67%');
    expect(rows[0]?.outcome).toBe('progressed');
    expect(rows[0]?.reviewLine).toContain('Week 7 of 12 · 2/3 (67%) · progressed');
  });

  it('names a repeat week in its own label', () => {
    const rows = weekRows({
      weeks: [fixtureWeek(8, { repeatOfWeek: 7, outcome: 'repeat' })],
      sessions: [fixtureSession(8, 0)],
      programWeeks: 12,
      currentW: 8,
      tests: [],
      recoveryByDay: recovery,
      trendInPerWk: null,
      requiredInPerWk: null,
    });
    expect(rows[0]?.label).toBe('8 (repeat of 7)');
    expect(rows[0]?.outcome).toBe('repeated');
  });

  it('puts the trend on the current week only', () => {
    const rows = weekRows({
      weeks: [fixtureWeek(6), fixtureWeek(7)],
      sessions: [fixtureSession(6, 0), fixtureSession(7, 0)],
      programWeeks: 12,
      currentW: 7,
      tests: [],
      recoveryByDay: recovery,
      trendInPerWk: 0.3,
      requiredInPerWk: 0.29,
    });
    expect(rows[0]?.reviewLine).not.toContain('trend');
    expect(rows[1]?.reviewLine).toContain('trend +0.30 in/wk, need +0.29');
  });
});

describe('load and recovery arithmetic', () => {
  it('reads session load as RPE times minutes and skips unfinished sessions', () => {
    const done = fixtureSession(7, 0, {
      rpe: 8,
      startedAt: `${FIXTURE_START}T17:00:00.000Z`,
      markedCompleteAt: `${FIXTURE_START}T18:00:00.000Z`,
    });
    const open = fixtureSession(7, 1, { markedCompleteAt: null });
    expect(weekSrpe([done, open])).toBe(480);
    expect(weekSrpe([open])).toBeNull();
  });

  it('averages only the mornings that were scored', () => {
    expect(meanRecovery([60, null, 80])).toBe(70);
    expect(meanRecovery([null, null])).toBeNull();
  });
});

describe('lifts', () => {
  function set(overrides: Partial<LiftSetRow>): LiftSetRow {
    return {
      exerciseId: 'back_squat',
      exerciseName: 'Back squat',
      loadType: 'heavy_strength',
      loadMode: 'entered',
      sessionId: 'session',
      localDate: '2026-10-05',
      setNumber: 1,
      repsDone: 5,
      loadKg: lbToKg(205),
      rpe: 8,
      side: null,
      meanVelocityBest: null,
      velocityLossPct: null,
      ...overrides,
    };
  }

  it('keeps the heaviest set of each day and reads the working-max source', () => {
    const rows = liftRows({
      liftSets: [
        set({ localDate: '2026-10-05', loadKg: lbToKg(205) }),
        set({ localDate: '2026-10-05', loadKg: lbToKg(225), setNumber: 3 }),
        set({ localDate: '2026-10-12', loadKg: lbToKg(235) }),
      ],
      workingMax: {
        back_squat: { valueKg: lbToKg(275), source: 'entered', frozenAt: '2026-09-01T00:00:00.000Z' },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workingMaxLb).toBe('275 lb');
    expect(rows[0]?.sourceLine).toBe('entered 275 lb, 1 Sep');
    expect(rows[0]?.topSets[0]?.setLabel).toBe('5 × 235 lb');
    expect(rows[0]?.topSets[1]?.setLabel).toBe('5 × 225 lb');
  });

  it('names an estimated max with the set it came from', () => {
    const rows = liftRows({
      liftSets: [set({ localDate: '2026-09-09', loadKg: lbToKg(265), repsDone: 3 })],
      workingMax: {
        back_squat: { valueKg: lbToKg(275), source: 'epley', frozenAt: '2026-09-09T00:00:00.000Z' },
      },
    });
    // Load then reps, the way the engine's own source line and Today write it.
    expect(rows[0]?.sourceLine).toBe('est. 275 lb · Epley from 265 lb × 3, 9 Sep');
  });

  it('snaps every load to the 5 lb barbell grid Settings prints', () => {
    // 265 lb converted to kg and back is not exactly 265; both screens have to
    // land on the same number, so both go through the display grid.
    const rows = liftRows({
      liftSets: [set({ localDate: '2026-09-09', loadKg: lbToKg(265) + 0.4, repsDone: 3 })],
      workingMax: {
        back_squat: { valueKg: lbToKg(275) + 0.4, source: 'epley', frozenAt: null },
      },
    });
    expect(rows[0]?.workingMaxLb).toBe('275 lb');
    expect(rows[0]?.sourceLine).toBe('est. 275 lb · Epley from 265 lb × 3');
    expect(rows[0]?.topSets[0]?.setLabel).toBe('3 × 265 lb');
  });

  it('says so when a lift has no max yet', () => {
    const rows = liftRows({ liftSets: [set({})], workingMax: {} });
    expect(rows[0]?.workingMaxLb).toBeNull();
    expect(rows[0]?.sourceLine).toContain('No 1RM yet');
  });

  it('reports the R97-sized drop and ignores an ordinary wave', () => {
    const dropped = liftRows({
      liftSets: [
        set({ localDate: '2026-10-05', loadKg: lbToKg(240) }),
        set({ localDate: '2026-10-12', loadKg: lbToKg(228) }),
      ],
      workingMax: {},
    });
    expect(dropped[0]?.dropLine).toBe('Loads −5% after missed reps · 12 Oct');

    const wave = liftRows({
      liftSets: [
        set({ localDate: '2026-10-05', loadKg: lbToKg(240) }),
        set({ localDate: '2026-10-12', loadKg: lbToKg(235) }),
      ],
      workingMax: {},
    });
    expect(wave[0]?.dropLine).toBeNull();
  });
});

describe('jump readiness', () => {
  function rsiTest(gcts: readonly number[]) {
    const base = makeTest({
      id: 'rsi-1',
      date: '2026-10-15',
      heightIn: 24,
      instrument: 'ovr_jump_rsi',
      mode: 'RSI',
    });
    return {
      ...base,
      reps: gcts.map((gct, index) => ({
        ...makeRep(index + 1, 600),
        gctMs: gct,
      })),
    };
  }

  it('leaves reps over 250 ms out of the average and counts them', () => {
    const rows = readinessRows([rsiTest([190, 210, 320])]);
    expect(rows[0]?.reactive).toBe(2);
    expect(rows[0]?.nonReactive).toBe(1);
  });

  it('marks the non-reactive reps in the rep list rather than hiding them', () => {
    const reps = readinessReps([rsiTest([190, 320])]);
    expect(reps).toHaveLength(2);
    expect(reps[0]?.reactive).toBe(true);
    expect(reps[1]?.reactive).toBe(false);
    expect(reps[1]?.gctMs).toBe('320 ms');
  });
});
