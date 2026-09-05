import { describe, expect, it } from 'vitest';
import { buildClimberFixture } from '@vert/engine/fixtures';
import type { SessionPlan, WeekPlan } from '@vert/engine';
import { planNoticesFor, readinessChangedSomething, weekDayLines } from './weekLines';

/**
 * The climbing fixture's week 7: Mon lower, Tue upper power, Wed the test day
 * with the readiness gate on it, Fri recovery.
 */
const climber = buildClimberFixture();

function week7(): WeekPlan {
  const week = climber.weeks[climber.weeks.length - 1];
  if (week === undefined) throw new Error('the fixture built no weeks');
  return week;
}

/** A copy of the week with one day's notices replaced. */
function withNotices(plan: WeekPlan, date: string, notices: string[]): WeekPlan {
  return {
    ...plan,
    sessions: plan.sessions.map((session) =>
      session.date === date ? { ...session, notices } : session,
    ),
  };
}

function gatedSession(): SessionPlan {
  const session = week7().sessions.find((entry) => entry.readiness !== undefined);
  if (session === undefined) throw new Error('the fixture scored no readiness gate');
  return session;
}

describe('readinessChangedSomething', () => {
  const none = {
    tierDown: false,
    holdVolume: false,
    removeMaximalJumps: false,
    jumpVolumeFactor: 1,
    loadFactor: 1,
    extraReps: 0,
    offerRecoverySwap: false,
  };

  it('is false for the day the gate read both channels as fine', () => {
    expect(readinessChangedSomething(none)).toBe(false);
  });

  it('is true for every downward move the gate can make', () => {
    expect(readinessChangedSomething({ ...none, tierDown: true })).toBe(true);
    expect(readinessChangedSomething({ ...none, holdVolume: true })).toBe(true);
    expect(readinessChangedSomething({ ...none, removeMaximalJumps: true })).toBe(true);
    expect(readinessChangedSomething({ ...none, jumpVolumeFactor: 0.75 })).toBe(true);
    expect(readinessChangedSomething({ ...none, loadFactor: 0.9 })).toBe(true);
    expect(readinessChangedSomething({ ...none, extraReps: 2 })).toBe(true);
    expect(readinessChangedSomething({ ...none, offerRecoverySwap: true })).toBe(true);
  });
});

describe('planNoticesFor', () => {
  const gated = gatedSession();

  it('the engine put the gate line on the session it scored', () => {
    expect(gated.notices).toContain(gated.readiness?.line);
  });

  it('drops a gate that changed nothing: the Plan is not the runner', () => {
    const outcome = gated.readiness;
    if (outcome === undefined) throw new Error('no outcome');
    expect(readinessChangedSomething(outcome.adjustment)).toBe(false);
    expect(planNoticesFor(gated)).not.toContain(outcome.line);
  });

  it('keeps the line once the gate reduced something', () => {
    const outcome = gated.readiness;
    if (outcome === undefined) throw new Error('no outcome');
    const adjusted: SessionPlan = {
      ...gated,
      readiness: { ...outcome, adjustment: { ...outcome.adjustment, tierDown: true } },
    };
    expect(planNoticesFor(adjusted)).toContain(outcome.line);
  });

  it('never touches a notice that is not the gate line', () => {
    const other: SessionPlan = { ...gated, notices: ['Something else entirely.'] };
    expect(planNoticesFor(other)).toEqual(['Something else entirely.']);
  });
});

describe('weekDayLines', () => {
  const plan = week7();

  it('says nothing for a week whose days had nothing to report', () => {
    expect(weekDayLines(plan)).toEqual([]);
  });

  it('names the day in front of a demoted pulling day', () => {
    const demoted = "Hard finger work needs 48 hours between sessions, so today's pulling is light.";
    const lines = weekDayLines(withNotices(plan, '2026-10-20', [demoted]));
    expect(lines).toEqual([`Tue · ${demoted}`]);
  });

  it('names the climbing day when the wall is what demoted the pulling', () => {
    // The engine's own wall-worded line (`house.sc.hard_finger_spacing`): it
    // names the climbing session that took the hard rows, and the Plan says
    // which of the athlete's own days carries it.
    const demoted = 'Pull-ups moved to light work: climbing Sun evening, 48 h finger rule';
    const lines = weekDayLines(withNotices(plan, '2026-10-20', [demoted]));
    expect(lines).toEqual([`Tue · ${demoted}`]);
  });

  it('names the day in front of a finger-pain answer over the ceiling', () => {
    const over = "Finger pain at 5 out of 10: the hard finger work is out of today's session.";
    const lines = weekDayLines(withNotices(plan, '2026-10-20', [over]));
    expect(lines[0]).toBe(`Tue · ${over}`);
  });

  it('says a notice on two days once, with both days', () => {
    const notice = 'Knee alignment work today.';
    let next = withNotices(plan, '2026-10-19', [notice]);
    next = withNotices(next, '2026-10-20', [notice]);
    expect(weekDayLines(next)).toEqual([`Mon, Tue · ${notice}`]);
  });

  it('drops the day names when the notice is on every day of the week', () => {
    let next = plan;
    for (const session of plan.sessions) {
      next = withNotices(next, session.date, ['Week 5 is a deload.']);
    }
    expect(weekDayLines(next)).toEqual(['Week 5 is a deload.']);
  });

  it('leaves a sentence the week already carries to the week', () => {
    const [first] = plan.lines;
    if (first === undefined) throw new Error('the week carries no lines');
    expect(weekDayLines(withNotices(plan, '2026-10-19', [first]))).toEqual([]);
  });

  it('reads days in date order, whatever order the sessions come in', () => {
    const notice = 'A line.';
    let next = withNotices(plan, '2026-10-21', [notice]);
    next = withNotices(next, '2026-10-19', ['Another line.']);
    next = { ...next, sessions: [...next.sessions].reverse() };
    expect(weekDayLines(next)).toEqual(['Mon · Another line.', 'Wed · A line.']);
  });

  it('is empty for a week with no sessions', () => {
    expect(weekDayLines({ ...plan, sessions: [] })).toEqual([]);
  });
});
