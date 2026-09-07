import { describe, expect, it } from 'vitest';
import { ObservedWeekError } from '@vert/engine';
import { buildOwnerFixture } from '@vert/engine/fixtures';
import type { Json, SessionWithStatus } from '@/data/types';
import { fromEngineDayType } from './engine';
import {
  observedThroughWeek,
  regeneratedSkeleton,
  projectedFromReason,
  revisePlanCopy,
  revisionReason,
  revisionTarget,
  toObservedWeeks,
  weekHasWork,
  type ReviseWeekFacts,
} from './revise';

/**
 * The revision's arithmetic, on its own.
 *
 * Every decision a revision makes before it writes anything is here: which
 * week it starts at, whether it should run at all, what the sheet says, and
 * what the engine's fold is handed. The write itself is covered by the
 * integration test beside this one.
 */

const owner = buildOwnerFixture();

/** Twelve weeks opening on Mondays from 7 Sep 2026, with the sets logged in each. */
function weeks(
  logged: Readonly<Record<number, number>> = {},
  started: Readonly<Record<number, number>> = {},
): ReviseWeekFacts[] {
  return Array.from({ length: 12 }, (_unused, index) => ({
    w: index + 1,
    windowStart: addWeeks('2026-09-07', index),
    windowEnd: addWeeks('2026-09-13', index),
    loggedSets: logged[index + 1] ?? 0,
    startedSessions: started[index + 1] ?? 0,
  }));
}

/** Plain date arithmetic, so the fixture does not need the engine's calendar. */
function addWeeks(start: string, count: number): string {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count * 7);
  return date.toISOString().slice(0, 10);
}

describe('projectedFromReason', () => {
  it('reads a first build as no outcomes folded in yet', () => {
    expect(projectedFromReason('first build')).toBe(0);
  });

  it('round-trips the reason a revision writes', () => {
    expect(projectedFromReason(revisionReason(3))).toBe(3);
    expect(revisionReason(3)).toBe('revised from week 3');
    for (const w of [1, 2, 7, 11, 12]) {
      expect(projectedFromReason(revisionReason(w))).toBe(w);
    }
  });

  it('reads any other reason, and no reason at all, as zero', () => {
    expect(projectedFromReason('target date changed')).toBe(0);
    expect(projectedFromReason('2 settings changed')).toBe(0);
    expect(projectedFromReason(null)).toBe(0);
    expect(projectedFromReason(undefined)).toBe(0);
    expect(projectedFromReason('revised from week nine')).toBe(0);
  });
});

describe('observedThroughWeek', () => {
  it('is the newest week with anything logged in it', () => {
    expect(observedThroughWeek(weeks({ 1: 12, 3: 4 }))).toBe(3);
  });

  it('is zero before anything is logged', () => {
    expect(observedThroughWeek(weeks())).toBe(0);
  });

  it('reads a week logged out of order as the newest one', () => {
    expect(observedThroughWeek(weeks({ 1: 12, 5: 2 }))).toBe(5);
  });
});

describe('revisionTarget', () => {
  // Week 1 opens 7 Sep, week 2 on 14 Sep, week 3 on 21 Sep.
  const inWeekOne = '2026-09-09';

  it('starts at the first week that has not opened and has nothing logged', () => {
    const target = revisionTarget({
      weeks: weeks({ 1: 12 }),
      today: inWeekOne,
      latestReason: 'first build',
    });
    expect(target.fromWeek).toBe(2);
    expect(target.observedThrough).toBe(1);
    expect(target.projectedFrom).toBe(0);
    expect(target.shouldRevise).toBe(true);
    expect(target.lastWeek).toBe(12);
  });

  it('never chooses a week with one logged session, even a future one', () => {
    const target = revisionTarget({
      weeks: weeks({ 1: 12, 2: 3 }),
      today: inWeekOne,
      latestReason: 'first build',
    });
    expect(target.fromWeek).toBe(3);
    // The out-of-order week still counts as an outcome to fold in.
    expect(target.observedThrough).toBe(2);
  });

  it('does not revise twice for the same outcomes', () => {
    const target = revisionTarget({
      weeks: weeks({ 1: 12 }),
      today: inWeekOne,
      latestReason: revisionReason(1),
    });
    expect(target.fromWeek).toBe(2);
    expect(target.projectedFrom).toBe(1);
    expect(target.shouldRevise).toBe(false);
  });

  it('revises again once a newer week is logged', () => {
    const target = revisionTarget({
      weeks: weeks({ 1: 12, 2: 9 }),
      today: '2026-09-16',
      latestReason: revisionReason(1),
    });
    expect(target.observedThrough).toBe(2);
    expect(target.fromWeek).toBe(3);
    expect(target.shouldRevise).toBe(true);
  });

  it('has nowhere to start once the last week has opened', () => {
    const target = revisionTarget({
      weeks: weeks({ 1: 12 }),
      today: '2026-12-31',
      latestReason: 'first build',
    });
    expect(target.fromWeek).toBeNull();
    expect(target.shouldRevise).toBe(false);
  });

  it('does not revise before anything at all is logged', () => {
    const target = revisionTarget({
      weeks: weeks(),
      today: inWeekOne,
      latestReason: 'first build',
    });
    // The current week is rebuildable, because nothing in it has been done,
    // but there is nothing to fold in yet either.
    expect(target.fromWeek).toBe(1);
    expect(target.observedThrough).toBe(0);
    expect(target.shouldRevise).toBe(false);
  });

  it('starts at the week the athlete is standing in when nothing in it is done', () => {
    const target = revisionTarget({
      weeks: weeks(),
      today: inWeekOne,
      latestReason: 'first build',
    });
    expect(target.fromWeek).toBe(1);
    expect(target.foldedThrough).toBe(0);
  });

  it('will not touch a week whose session the athlete has opened', () => {
    const target = revisionTarget({
      weeks: weeks({}, { 1: 1 }),
      today: inWeekOne,
      latestReason: 'first build',
    });
    // Nothing is logged in it, but it has been opened, so it is the athlete's.
    expect(target.fromWeek).toBe(2);
  });

  it('skips a week whose window has already closed', () => {
    const target = revisionTarget({
      weeks: weeks(),
      today: '2026-09-16',
      latestReason: 'first build',
    });
    // Week 1 ran 7 to 13 Sep. Rebuilding days that have gone by writes a plan
    // nobody can train.
    expect(target.fromWeek).toBe(2);
  });
});

describe('revisePlanCopy', () => {
  it('names the weeks it rebuilds and the weeks it will not touch', () => {
    const copy = revisePlanCopy(
      revisionTarget({ weeks: weeks({ 1: 12 }), today: '2026-09-09', latestReason: 'first build' }),
    );
    expect(copy.title).toBe('Revise from week 2?');
    expect(copy.confirmLabel).toBe('Revise from week 2');
    expect(copy.disabled).toBe(false);
    expect(copy.lines).toContain('Weeks 2 to 12 are rebuilt.');
    expect(copy.lines).toContain('They are rebuilt from what you logged through week 1.');
    expect(copy.lines).toContain('Weeks 1 to 1 keep their sessions and their logs.');
    expect(copy.lines).toContain('A session with anything logged in it is never touched.');
  });

  it('is a disabled row saying so when there is nothing new to fold in', () => {
    const copy = revisePlanCopy(
      revisionTarget({
        weeks: weeks({ 1: 12 }),
        today: '2026-09-09',
        latestReason: revisionReason(1),
      }),
    );
    expect(copy.disabled).toBe(true);
    expect(copy.caption).toBe('Nothing to revise yet');
  });

  it('does not offer to keep a week 0 when the whole program is rebuilt', () => {
    const copy = revisePlanCopy(
      revisionTarget({ weeks: weeks(), today: '2026-09-09', latestReason: 'first build' }),
    );
    expect(copy.title).toBe('Revise from week 1?');
    expect(copy.lines).toContain('Weeks 1 to 12 are rebuilt.');
    expect(copy.lines).toContain('Nothing is logged yet, so the whole program is rebuilt.');
    expect(copy.lines.some((line) => line.includes('to 0'))).toBe(false);
  });

  it('says so plainly when the program has run out of weeks', () => {
    const copy = revisePlanCopy(
      revisionTarget({ weeks: weeks({ 1: 12 }), today: '2026-12-31', latestReason: 'first build' }),
    );
    expect(copy.title).toBe('No weeks left to rebuild');
    expect(copy.disabled).toBe(true);
    expect(copy.lines).toHaveLength(1);
  });
});

/* -------------------------------------------------------------- the fold */

function storeSession(
  weekW: number,
  index: number,
  overrides: Partial<SessionWithStatus> = {},
): SessionWithStatus {
  const week = owner.weeks.find((entry) => entry.w === weekW);
  const session = week?.sessions[index];
  if (session === undefined) throw new Error(`no session ${index} in week ${weekW}`);
  return {
    id: `sess_${weekW}_${index}`,
    programId: 'p1',
    weekId: `week-${weekW}`,
    scheduledDate: session.date,
    orderIndex: index,
    dayType: fromEngineDayType(session.dayType),
    blocksPresent: null,
    prescribedSetCount: 0,
    dismissed: false,
    testStatus: null,
    sorenessPre: null,
    rpe: null,
    legsFeel: null,
    notes: null,
    isMaximalCns: session.isMaximalCns,
    trimmedExercises: null,
    appliedModifications: null,
    shadowModifications: null,
    snapshot: session as unknown as Json,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    status: 'done',
    loggedSetCount: 4,
    startedAt: null,
    markedCompleteAt: `${session.date}T19:15:00.000Z`,
    whoopWorkoutId: null,
    ...overrides,
  };
}

describe('weekHasWork', () => {
  it('is true for a session with a logged set', () => {
    expect(
      weekHasWork([storeSession(1, 0, { loggedSetCount: 1, markedCompleteAt: null })]),
    ).toBe(true);
  });

  it('is true for a session marked complete with nothing logged', () => {
    expect(weekHasWork([storeSession(1, 0, { loggedSetCount: 0 })])).toBe(true);
  });

  it('is false for a week nobody has opened', () => {
    expect(
      weekHasWork([storeSession(1, 0, { loggedSetCount: 0, markedCompleteAt: null })]),
    ).toBe(false);
  });
});

describe('toObservedWeeks', () => {
  const week1 = owner.weeks[0];

  it('renames every session to the id the engines own plan uses', () => {
    const observed = toObservedWeeks([
      {
        w: 1,
        snapshot: week1 as unknown as Json,
        sessions: [storeSession(1, 0), storeSession(1, 1)],
        logs: [],
      },
    ]);
    expect(observed).toHaveLength(1);
    // The store calls it sess_1_0; the engine calls it w1-d0, and judgeReps
    // looks every log up by that name.
    expect(observed[0]?.sessions.map((record) => record.sessionId)).toEqual(
      [week1?.sessions[0]?.id, week1?.sessions[1]?.id],
    );
    expect(observed[0]?.sessions.every((record) => record.sessionId.startsWith('w1-'))).toBe(true);
  });

  it('carries the stored plan through unchanged, in week order', () => {
    const observed = toObservedWeeks([
      { w: 2, snapshot: owner.weeks[1] as unknown as Json, sessions: [], logs: [] },
      { w: 1, snapshot: week1 as unknown as Json, sessions: [], logs: [] },
    ]);
    expect(observed.map((entry) => entry.plan.w)).toEqual([1, 2]);
    expect(observed[0]?.plan).toBe(week1);
  });

  it('refuses a week whose saved plan cannot be read, rather than guessing', () => {
    expect(() =>
      toObservedWeeks([{ w: 4, snapshot: null, sessions: [], logs: [] }]),
    ).toThrow(ObservedWeekError);
    try {
      toObservedWeeks([{ w: 4, snapshot: { nonsense: true } as Json, sessions: [], logs: [] }]);
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBeInstanceOf(ObservedWeekError);
      expect((caught as ObservedWeekError).sentence).toBe(
        'Week 4 has no readable saved plan, so it cannot be revised.',
      );
    }
  });
});

/* --------------------------------------------- what the version row records */

/** Weeks 1..12 on Mondays, with the ones named here carrying logs. */
function ladder(logged: readonly number[]): ReviseWeekFacts[] {
  return Array.from({ length: 12 }, (_, index) => {
    const w = index + 1;
    return {
      w,
      windowStart: addWeeks('2026-09-07', index),
      windowEnd: addWeeks('2026-09-13', index),
      loggedSets: logged.includes(w) ? 12 : 0,
      startedSessions: 0,
    };
  });
}

describe('what a revision records, and what it compares against', () => {
  it('records the last week it folded, not the newest week holding a log', () => {
    // Week 4 trained, then one set entered late against week 6.
    const target = revisionTarget({
      weeks: ladder([1, 2, 3, 4, 6]),
      today: '2026-09-30',
      latestReason: 'first build',
    });
    expect(target.fromWeek).toBe(5);
    expect(target.observedThrough).toBe(6);
    // Only weeks 1 to 4 are below fromWeek, so only those are folded in.
    expect(target.foldedThrough).toBe(4);
    expect(revisionReason(target.foldedThrough)).toBe('revised from week 4');
  });

  it('fires again once the week that was skipped is logged', () => {
    // The state left by the revision above.
    const after = revisionTarget({
      weeks: ladder([1, 2, 3, 4, 5, 6]),
      today: '2026-09-30',
      latestReason: 'revised from week 4',
    });
    expect(after.fromWeek).toBe(7);
    expect(after.foldedThrough).toBe(6);
    expect(after.shouldRevise).toBe(true);

    // Recording the newest logged week instead is what stalls it: week 6 was
    // never folded, so nothing the athlete logs in week 5 can ever beat it.
    const stalled = revisionTarget({
      weeks: ladder([1, 2, 3, 4, 5, 6]),
      today: '2026-09-30',
      latestReason: revisionReason(6),
    });
    expect(stalled.shouldRevise).toBe(false);
  });

  it('says which week the rebuild is really drawn from', () => {
    const copy = revisePlanCopy(
      revisionTarget({
        weeks: ladder([1, 2, 3, 4, 6]),
        today: '2026-09-30',
        latestReason: 'first build',
      }),
    );
    expect(copy.lines).toContain('They are rebuilt from what you logged through week 4.');
  });

  it('stays still on a program whose windows have opened with nothing logged', () => {
    const target = revisionTarget({
      weeks: ladder([]),
      today: '2026-09-30',
      latestReason: 'first build',
    });
    // Week 4's window is the one open on 30 Sep, so weeks 1 to 3 are behind it.
    expect(target.fromWeek).toBe(4);
    expect(target.foldedThrough).toBe(3);
    expect(target.observedThrough).toBe(0);
    expect(target.shouldRevise).toBe(false);
  });
});

/* ------------------------------------- the skeleton a regeneration stored */

describe('regeneratedSkeleton', () => {
  it('finds the skeleton a settings regeneration wrote on its version row', () => {
    const layout = {
      fromWeek: 5,
      skeleton: { W: 12, weeks: [] },
      changedFields: ['daysPerWeek'],
    } as unknown as Json;
    expect(regeneratedSkeleton(layout)).toEqual({ W: 12, weeks: [] });
  });

  it('finds nothing on the array layouts the build and a revision write', () => {
    const built = [{ w: 1, kind: 'load' }] as unknown as Json;
    expect(regeneratedSkeleton(built)).toBeNull();
    expect(regeneratedSkeleton(null)).toBeNull();
    expect(regeneratedSkeleton({ fromWeek: 5 } as unknown as Json)).toBeNull();
    expect(regeneratedSkeleton({ skeleton: [] } as unknown as Json)).toBeNull();
  });
});
