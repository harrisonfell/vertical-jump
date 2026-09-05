import { describe, expect, it } from 'vitest';
import { RULESET_V1, scoreReadiness } from '@vert/engine';
import type { ReadinessOutcome, ReadinessTestSession, SetPrescription } from '@vert/engine';
import { defaultReadinessConfig } from '@/lib/engineAthlete';
import { EditWindowClosedError } from '../../data/store/setLogs';
import { restrictedNotice } from './cards';
import { skeletonWeekCount } from './header';
import { editErrorLine, whoopWaitLine, AWAITING_WORKOUT } from './finish';
import { buildTodaySession, type TodayExercise } from './model';
import { isMostRecentLog, nextUpLabel } from './rest';
import { moveDecision, NOTHING_TO_MOVE, NO_WEEK_PLAN } from './move';

/**
 * The Today defects the review lenses found, each pinned by the smallest test
 * that can fail if the behaviour comes back: a body part named that was never
 * reported, a promise about Whoop nobody can keep, an error naming a cause it
 * does not have, a rest bar pointing at a set that is already logged, and a
 * week count read from the wrong list.
 */

function set(setNumber: number, displayLoad: string): SetPrescription {
  return { setNumber, displayLoad, restS: 120, restRule: '3 sets', isRamp: false, isHeld: false };
}

function exercise(id: string, name: string, sets: readonly SetPrescription[]): TodayExercise {
  return {
    id,
    exerciseId: id,
    name,
    block: 'primary',
    loadType: 'heavy_strength',
    loadMode: 'percent',
    bothSides: false,
    rotationNote: null,
    headerNote: null,
    lastTimeNote: null,
    isNewThisWeek: false,
    restS: 120,
    restRule: '3 sets',
    sets,
    landingPromptOnLastSet: false,
    contactsPerRep: 0,
    cues: [],
    boxHeightIn: null,
    ladderId: null,
    captions: [],
    repCounted: false,
    rowNote: null,
  };
}

describe('restrictedNotice', () => {
  it('names the site the athlete actually reported', () => {
    expect(restrictedNotice('shoulder')).toContain('shoulder pain');
    expect(restrictedNotice('shoulder')).not.toContain('knee');
  });

  it('still names the knee when the knee is the site', () => {
    expect(restrictedNotice('knee')).toContain('knee-stress lifts');
  });

  it('falls back to the other-site template on an unknown value', () => {
    expect(restrictedNotice('elbow')).toContain('another site');
  });
});

describe('whoopWaitLine', () => {
  it('promises the 24 h check only while Whoop is connected', () => {
    expect(whoopWaitLine({ connectionStatus: 'connected', workoutLinked: false })).toBe(
      AWAITING_WORKOUT,
    );
  });

  it('says nothing when Whoop was never connected', () => {
    expect(whoopWaitLine({ connectionStatus: null, workoutLinked: false })).toBeNull();
  });

  it('says nothing once a workout has matched', () => {
    expect(whoopWaitLine({ connectionStatus: 'connected', workoutLinked: true })).toBeNull();
  });

  it('offers the reconnect line after a revoked connection', () => {
    expect(whoopWaitLine({ connectionStatus: 'revoked', workoutLinked: false })).toBe(
      'Sessions awaiting a workout match after reconnect.',
    );
  });
});

describe('editErrorLine', () => {
  it('keeps the seven-day sentence for the guard that raises it', () => {
    expect(editErrorLine(new EditWindowClosedError('set-1'))).toContain('older than 7 days');
  });

  it('names a failed write as a failed write', () => {
    expect(editErrorLine(new Error('database is closed'))).toBe(
      "Couldn't save that change. Check your connection, then save again.",
    );
  });
});

describe('nextUpLabel', () => {
  const squat = exercise('a', 'Back squat', [set(1, '5 × 205 lb'), set(2, '5 × 205 lb')]);
  const jump = exercise('b', 'Pogo hop', [set(1, '5 × BW')]);

  it('names the next set of the same lift', () => {
    expect(
      nextUpLabel({
        exercises: [squat, jump],
        isLogged: (id, n) => id === 'a' && n === 1,
        from: { exerciseId: 'a', set: set(1, '5 × 205 lb') },
      }),
    ).toBe('next: set 2 · 5 × 205 lb');
  });

  it('crosses into the next exercise when the current one is finished', () => {
    expect(
      nextUpLabel({
        exercises: [squat, jump],
        isLogged: (id) => id === 'a',
        from: null,
      }),
    ).toBe('next: Pogo hop · set 1 · 5 × BW');
  });

  it('says so when nothing is left', () => {
    expect(nextUpLabel({ exercises: [squat, jump], isLogged: () => true, from: null })).toBe(
      'last set',
    );
  });
});

describe('skeletonWeekCount', () => {
  it('reads W from the skeleton, not from the weeks materialised so far', () => {
    expect(skeletonWeekCount({ weeks: new Array(12).fill({}) })).toBe(12);
  });

  it('returns null when the snapshot is not a skeleton', () => {
    expect(skeletonWeekCount(null)).toBeNull();
    expect(skeletonWeekCount({ weeks: [] })).toBeNull();
  });
});

/**
 * A rest day whose header names the next session must not refuse to move it
 * with "there is nothing to move": the candidate the refusal talks about is
 * the one the header named, and the answer comes from the engine (D-33).
 */
function weekSnapshot(sessions: readonly { date: string; dayType: string }[]): unknown {
  return {
    w: 7,
    windowStart: '2026-08-31',
    windowEnd: '2026-09-06',
    sessions: sessions.map((entry, index) => ({
      id: `s-${index}`,
      date: entry.date,
      dayType: entry.dayType,
      isMaximalCns: entry.dayType === 'power_speed' || entry.dayType === 'lower_strength',
      isTestDay: false,
      blocks: [],
    })),
  };
}

describe('moveDecision', () => {
  it('allows the recovery day the header names to come forward', () => {
    const week = weekSnapshot([
      { date: '2026-08-31', dayType: 'lower_strength' },
      { date: '2026-09-05', dayType: 'recovery_mobility' },
    ]);
    expect(moveDecision(week, '2026-09-05', '2026-09-04')).toEqual({ ok: true });
  });

  it('gives the engine reason, never a contradiction of the header', () => {
    const week = weekSnapshot([
      { date: '2026-09-03', dayType: 'power_speed' },
      { date: '2026-09-05', dayType: 'power_speed' },
    ]);
    const decision = moveDecision(week, '2026-09-05', '2026-09-04');
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toContain('Power + Speed');
    expect(decision.reason).not.toBe(NOTHING_TO_MOVE);
  });

  it('says nothing is left only when the week really has nothing left', () => {
    expect(moveDecision(weekSnapshot([]), null, '2026-09-04')).toEqual({
      ok: false,
      reason: NOTHING_TO_MOVE,
      rule: 0,
    });
  });

  it('separates a missing week plan from an empty week', () => {
    const decision = moveDecision(null, '2026-09-05', '2026-09-04');
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toBe(NO_WEEK_PLAN);
  });
});

describe('isMostRecentLog', () => {
  const logs = [
    { sessionExerciseId: 'a', setNumber: 1, completedAt: '2026-10-22T18:00:00.000Z' },
    { sessionExerciseId: 'a', setNumber: 2, completedAt: '2026-10-22T18:04:00.000Z' },
    { sessionExerciseId: 'b', setNumber: 1, completedAt: '2026-10-22T18:02:00.000Z' },
  ];

  it('ends the rest the undone set started', () => {
    expect(isMostRecentLog(logs, 'a', 2)).toBe(true);
  });

  it('leaves the clock alone when an earlier row is taken back', () => {
    expect(isMostRecentLog(logs, 'a', 1)).toBe(false);
    expect(isMostRecentLog(logs, 'b', 1)).toBe(false);
  });

  it('has nothing to stop when nothing is logged', () => {
    expect(isMostRecentLog([], 'a', 1)).toBe(false);
  });
});


/**
 * D-47: the readiness verdict was on Today twice, in the Readiness row and
 * again as a Notice under the cards. The row carries the reading; the Notice
 * is for news, and "session as written" is not news.
 */
describe('the readiness notice', () => {
  const config = defaultReadinessConfig();
  const history: ReadinessTestSession[] = [7.0, 7.2, 7.1, 7.0, 7.2, 7.1, 7.1, 7.2, 7.0].map(
    (best, index) => ({
      id: `t${index}`,
      date: `2026-08-${String(10 + index).padStart(2, '0')}`,
      kind: 'seated_mb_throw' as const,
      attempts: [best],
      best,
      unit: 'm',
    }),
  );

  function outcomeFor(score: number, todayThrow: number | null): ReadinessOutcome {
    const band = score < 34 ? 'low' : score < 67 ? 'moderate' : 'high';
    const test: ReadinessTestSession | null =
      todayThrow === null
        ? null
        : {
            id: 'today',
            date: '2026-09-05',
            kind: 'seated_mb_throw',
            attempts: [todayThrow],
            best: todayThrow,
            unit: 'm',
          };
    return scoreReadiness(config, { date: '2026-09-05', score, band }, test, history, RULESET_V1);
  }

  function noticesFor(outcome: ReadinessOutcome): readonly string[] {
    const snapshot = {
      dayType: 'power',
      blocks: [],
      notices: [outcome.line, 'Repeat of week 7: same loads, same sets.'],
      trimmed: [],
      headerSuffixes: [],
      readiness: outcome,
    };
    return buildTodaySession([], snapshot).notices;
  }

  it('is dropped when the gate left the session exactly as written', () => {
    const outcome = outcomeFor(80, null);
    expect(outcome.adjustment.tierDown).toBe(false);
    expect(noticesFor(outcome)).toEqual(['Repeat of week 7: same loads, same sets.']);
  });

  it('stays when the gate actually changed the day', () => {
    const outcome = outcomeFor(20, 6.0);
    expect(outcome.adjustment.tierDown).toBe(true);
    expect(noticesFor(outcome)).toContain(outcome.line);
  });
});
