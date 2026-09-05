/**
 * The frozen, monotone working max (R72, R73, R97, R107 with the brief's
 * safety override). Worked numbers from brief section 09 "Worked numbers".
 */
import { describe, expect, it } from 'vitest';
import { kgToLb, lbToKg } from '../units.js';
import {
  applyFailureDrop,
  bestEpley,
  epley,
  guardCapPctForPercentWeek,
  resolveWorkingMax,
  week2GuardCapPct,
  workingMaxSourceLine,
} from './workingMax.js';
import { RULES, makeExercise, makeLog, makeWorkingMax } from './prescribe.fixtures.test.js';

const AS_OF = '2026-09-08T03:00:00.000Z';

const trapBar = makeExercise({
  id: 'trap_bar_deadlift',
  name: 'Trap bar deadlift',
  equipment: ['trap_bar'],
});

const dbBench = makeExercise({
  id: 'db_bench',
  loadType: 'hypertrophy',
  requiresBarbell: false,
  equipment: ['dumbbell', 'bench'],
  isMainLift: false,
});

/** The three week-1 RPE sets the brief logs against the trap bar. */
function week1TrapBarLogs(): ReturnType<typeof makeLog>[] {
  return [
    makeLog({
      id: 'a',
      exerciseId: 'trap_bar_deadlift',
      repsDone: 5,
      loadKg: lbToKg(225),
      rpe: 6,
      completedAt: '2026-09-01T18:00:00.000Z',
    }),
    makeLog({
      id: 'b',
      exerciseId: 'trap_bar_deadlift',
      setNumber: 2,
      repsDone: 4,
      loadKg: lbToKg(245),
      rpe: 6.5,
      completedAt: '2026-09-01T18:10:00.000Z',
    }),
    makeLog({
      id: 'c',
      exerciseId: 'trap_bar_deadlift',
      setNumber: 3,
      repsDone: 3,
      loadKg: lbToKg(265),
      rpe: 7,
      completedAt: '2026-09-01T18:20:00.000Z',
    }),
  ];
}

describe('epley', () => {
  it('is weight x (1 + reps / 30) with no confidence factor', () => {
    expect(kgToLb(epley(lbToKg(265), 3))).toBeCloseTo(291.5, 6);
    expect(() => epley(0, 3)).toThrow(RangeError);
    expect(() => epley(100, 0)).toThrow(RangeError);
  });
});

describe('bestEpley', () => {
  it('takes the best qualifying set and applies the 0.95 confidence factor', () => {
    const candidate = bestEpley(week1TrapBarLogs(), trapBar, RULES, AS_OF);
    expect(candidate).not.toBeNull();
    expect(candidate?.confidence).toBe(0.95);
    expect(kgToLb(candidate?.valueKg ?? 0)).toBeCloseTo(291.5 * 0.95, 6);
    expect(candidate?.fromLog?.id).toBe('c');
  });

  it('drops the confidence factor once an RPE 8 set at 6 reps or fewer exists', () => {
    const logs = week1TrapBarLogs();
    const last = logs[2];
    if (last) last.rpe = 8;
    const candidate = bestEpley(logs, trapBar, RULES, AS_OF);
    expect(candidate?.confidence).toBe(1);
    expect(kgToLb(candidate?.valueKg ?? 0)).toBeCloseTo(291.5, 6);
  });

  it('ignores sets over 10 reps and sets outside the four-week window', () => {
    const logs = [
      ...week1TrapBarLogs(),
      makeLog({
        id: 'd',
        exerciseId: 'trap_bar_deadlift',
        repsDone: 12,
        loadKg: lbToKg(300),
        completedAt: '2026-09-02T18:00:00.000Z',
      }),
      makeLog({
        id: 'e',
        exerciseId: 'trap_bar_deadlift',
        repsDone: 3,
        loadKg: lbToKg(400),
        completedAt: '2026-07-01T18:00:00.000Z',
      }),
    ];
    const candidate = bestEpley(logs, trapBar, RULES, AS_OF);
    expect(candidate?.fromLog?.id).toBe('c');
  });

  it('never estimates an Olympic lift (safety override)', () => {
    const clean = makeExercise({ id: 'power_clean', loadType: 'power', isOlympicLift: true });
    const logs = [
      makeLog({ id: 'f', exerciseId: 'power_clean', repsDone: 3, loadKg: lbToKg(225) }),
    ];
    expect(bestEpley(logs, clean, RULES, AS_OF)).toBeNull();
  });
});

describe('resolveWorkingMax', () => {
  it('trap bar, week-1 RPE logs: 291.5 x 0.95 = 277 rounds to 275 lb', () => {
    const max = resolveWorkingMax(
      'trap_bar_deadlift',
      trapBar,
      undefined,
      null,
      week1TrapBarLogs(),
      RULES,
      AS_OF,
    );
    expect(kgToLb(max.valueKg)).toBeCloseTo(275, 6);
    expect(max.source).toBe('epley');
    expect(max.confidence).toBe(0.95);
    expect(max.frozenAt).toBe(AS_OF);
    expect(max.lastRaiseAt).toBe(AS_OF);
  });

  it('DB bench, logs 50/55/60 per hand: Epley 76 x 0.95 = 72 rounds down to 70 lb', () => {
    const logs = [
      makeLog({ id: 'g', exerciseId: 'db_bench', repsDone: 12, loadKg: lbToKg(50) }),
      makeLog({ id: 'h', exerciseId: 'db_bench', repsDone: 10, loadKg: lbToKg(55) }),
      makeLog({ id: 'i', exerciseId: 'db_bench', repsDone: 8, loadKg: lbToKg(60) }),
    ];
    const max = resolveWorkingMax('db_bench', dbBench, undefined, null, logs, RULES, AS_OF);
    expect(kgToLb(max.valueKg)).toBeCloseTo(70, 6);
  });

  it('an entered 1RM wins when it is the higher number', () => {
    const max = resolveWorkingMax(
      'trap_bar_deadlift',
      trapBar,
      undefined,
      lbToKg(315),
      week1TrapBarLogs(),
      RULES,
      AS_OF,
    );
    expect(max.source).toBe('entered');
    expect(kgToLb(max.valueKg)).toBeCloseTo(315, 6);
    expect(max.confidence).toBe(1);
  });

  it('never falls on its own: a lighter week keeps the frozen value', () => {
    const previous = makeWorkingMax('trap_bar_deadlift', 275, {
      frozenAt: '2026-09-01T03:00:00.000Z',
      lastRaiseAt: '2026-09-01T03:00:00.000Z',
    });
    const logs = [
      makeLog({
        id: 'j',
        exerciseId: 'trap_bar_deadlift',
        repsDone: 3,
        loadKg: lbToKg(200),
        completedAt: '2026-09-05T18:00:00.000Z',
      }),
    ];
    const max = resolveWorkingMax('trap_bar_deadlift', trapBar, previous, null, logs, RULES, AS_OF);
    expect(kgToLb(max.valueKg)).toBeCloseTo(275, 6);
    expect(max.frozenAt).toBe(AS_OF);
  });

  it('rises at most 5 percent per week since the last raise', () => {
    const previous = makeWorkingMax('trap_bar_deadlift', 275, {
      source: 'epley',
      frozenAt: '2026-09-01T03:00:00.000Z',
      lastRaiseAt: '2026-09-01T03:00:00.000Z',
    });
    const logs = [
      makeLog({
        id: 'k',
        exerciseId: 'trap_bar_deadlift',
        repsDone: 3,
        loadKg: lbToKg(330),
        completedAt: '2026-09-07T18:00:00.000Z',
      }),
    ];
    const max = resolveWorkingMax(
      'trap_bar_deadlift',
      trapBar,
      previous,
      null,
      logs,
      RULES,
      '2026-09-08T03:00:00.000Z',
    );
    expect(kgToLb(max.valueKg)).toBeCloseTo(285, 6);
  });

  it('holds still when no week has passed since the last raise', () => {
    const previous = makeWorkingMax('trap_bar_deadlift', 275, {
      source: 'epley',
      frozenAt: '2026-09-07T03:00:00.000Z',
      lastRaiseAt: '2026-09-07T03:00:00.000Z',
    });
    const logs = [
      makeLog({
        id: 'l',
        exerciseId: 'trap_bar_deadlift',
        repsDone: 3,
        loadKg: lbToKg(330),
        completedAt: '2026-09-07T18:00:00.000Z',
      }),
    ];
    const max = resolveWorkingMax('trap_bar_deadlift', trapBar, previous, null, logs, RULES, AS_OF);
    expect(kgToLb(max.valueKg)).toBeCloseTo(275, 6);
  });

  it('with no max and no qualifying log it reports RPE mode', () => {
    const max = resolveWorkingMax('trap_bar_deadlift', trapBar, undefined, null, [], RULES, AS_OF);
    expect(max.valueKg).toBe(0);
    expect(max.source).toBe('rpe');
  });
});

describe('R97 failure drops', () => {
  it('drops 5 percent, then 10 percent on a second consecutive failure', () => {
    const first = applyFailureDrop(makeWorkingMax('back_squat', 275), RULES, AS_OF);
    expect(kgToLb(first.valueKg)).toBeCloseTo(260, 6);
    expect(first.failStreak).toBe(1);
    const second = applyFailureDrop(first, RULES, AS_OF);
    expect(kgToLb(second.valueKg)).toBeCloseTo(235, 6);
    expect(second.failStreak).toBe(2);
  });
});

describe('the week-2 guard', () => {
  const epleyMax = makeWorkingMax('trap_bar_deadlift', 275, { source: 'epley', confidence: 0.95 });
  const enteredMax = makeWorkingMax('back_squat', 275);

  it('caps an estimated max at 80 percent in its first percent week', () => {
    expect(week2GuardCapPct(epleyMax, true, 87, RULES)).toBe(80);
    expect(week2GuardCapPct(epleyMax, false, 87, RULES)).toBe(87);
  });

  it('never guards an entered 1RM', () => {
    expect(week2GuardCapPct(enteredMax, true, 87, RULES)).toBe(87);
  });

  it('rises one 5 percent step per percent week to the level cap', () => {
    expect(guardCapPctForPercentWeek(epleyMax, 0, 87, RULES)).toBe(80);
    expect(guardCapPctForPercentWeek(epleyMax, 1, 87, RULES)).toBe(85);
    expect(guardCapPctForPercentWeek(epleyMax, 2, 87, RULES)).toBe(87);
    expect(guardCapPctForPercentWeek(enteredMax, 0, 87, RULES)).toBe(87);
  });
});

describe('workingMaxSourceLine', () => {
  it('names where the number came from', () => {
    expect(workingMaxSourceLine(makeWorkingMax('back_squat', 275))).toBe('entered 275 lb');
    const log = makeLog({
      id: 'm',
      exerciseId: 'trap_bar_deadlift',
      repsDone: 3,
      loadKg: lbToKg(265),
    });
    expect(
      workingMaxSourceLine(
        makeWorkingMax('trap_bar_deadlift', 275, { source: 'epley', confidence: 0.95 }),
        log,
      ),
    ).toBe('est. 275 lb · Epley from 265 lb × 3');
    expect(workingMaxSourceLine(makeWorkingMax('x', 0, { source: 'rpe', confidence: 0 }))).toBe(
      'no max yet, RPE mode',
    );
  });
});
