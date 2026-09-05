/**
 * Moving a session inside its week, and the setup-time weekday refusals.
 * "Next training day" is the next calendar day (R24, R90, R91).
 */
import { describe, expect, it } from 'vitest';

import { RULESET_V1 } from '../src/ruleset/index.js';
import {
  canMoveSession,
  dayTypeLabel,
  legalMoveTargets,
  validateWeekdayLayout,
  validateWeekdays,
} from '../src/move.js';
import { buildOwnerWeek, buildSession, buildWeekPlan } from './skeleton.support.js';

/** Mon Lower Strength (maximal), Thu Power + Speed (maximal), Sat Recovery. */
function threeDayWeek() {
  return buildWeekPlan([
    buildSession('s1', '2026-10-19', 'lower_strength', { isMaximalCns: true }),
    buildSession('s3', '2026-10-22', 'power_speed', { isMaximalCns: true, isTestDay: true }),
    buildSession('s4', '2026-10-24', 'recovery_mobility'),
  ]);
}

describe('canMoveSession', () => {
  it('allows a move that keeps the hard days apart', () => {
    expect(canMoveSession(threeDayWeek(), '2026-10-22', '2026-10-23', RULESET_V1)).toEqual({ ok: true });
  });

  it('refuses maximal plyometrics the day after a heavy squat session (R91)', () => {
    const decision = canMoveSession(threeDayWeek(), '2026-10-22', '2026-10-20', RULESET_V1);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.rule).toBe(91);
    expect(decision.reason).toBe("Can't move Power + Speed here: heavy squat yesterday");
  });

  it('refuses a heavy squat session the day before maximal jumps (R91)', () => {
    const decision = canMoveSession(threeDayWeek(), '2026-10-19', '2026-10-21', RULESET_V1);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.rule).toBe(91);
    expect(decision.reason).toContain('maximal jumps the next day');
  });

  it('keeps maximal sessions 2 calendar days apart (R90, house)', () => {
    const week = buildWeekPlan([
      buildSession('s1', '2026-10-19', 'power', { isMaximalCns: true }),
      buildSession('s2', '2026-10-23', 'power_speed', { isMaximalCns: true }),
    ]);
    const decision = canMoveSession(week, '2026-10-23', '2026-10-20', RULESET_V1);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.rule).toBe(90);
    expect(decision.reason).toContain('2 days apart');
  });

  it('needs a non-CNS day between maximal days at 4 days a week (R93)', () => {
    const week = buildWeekPlan([
      buildSession('s1', '2026-10-19', 'lower_strength', { isMaximalCns: true }),
      buildSession('s2', '2026-10-22', 'power_speed', { isMaximalCns: true, isTestDay: true }),
      buildSession('s3', '2026-10-23', 'upper_strength'),
      buildSession('s4', '2026-10-24', 'recovery_mobility'),
    ]);
    const decision = canMoveSession(week, '2026-10-22', '2026-10-21', RULESET_V1);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.rule).toBe(93);
    expect(decision.reason).toContain('nothing easy sits between');
  });

  it('allows the same move when a light session sits between (R93)', () => {
    expect(canMoveSession(buildOwnerWeek(), '2026-10-22', '2026-10-21', RULESET_V1)).toEqual({
      ok: true,
    });
  });

  it('keeps a session inside its own training week', () => {
    const decision = canMoveSession(threeDayWeek(), '2026-10-22', '2026-10-26', RULESET_V1);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.reason).toContain('own training week');
  });

  it('refuses a day that already holds a session, and a day that holds none', () => {
    const occupied = canMoveSession(threeDayWeek(), '2026-10-22', '2026-10-24', RULESET_V1);
    expect(occupied.ok).toBe(false);
    const missing = canMoveSession(threeDayWeek(), '2026-10-21', '2026-10-23', RULESET_V1);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.reason).toBe('No session on that day.');
  });

  it('moves only the next scheduled session of the week when today is known', () => {
    const week = threeDayWeek();
    const early = canMoveSession(week, '2026-10-22', '2026-10-23', RULESET_V1, '2026-10-19');
    expect(early.ok).toBe(false);
    if (early.ok) return;
    expect(early.reason).toContain('next session');
    expect(canMoveSession(week, '2026-10-19', '2026-10-20', RULESET_V1, '2026-10-19').ok).toBe(true);
  });

  it('lists only the legal targets', () => {
    const targets = legalMoveTargets(threeDayWeek(), '2026-10-22', RULESET_V1);
    expect(targets).toEqual(['2026-10-21', '2026-10-23', '2026-10-25']);
  });

  it('names day types the way the athlete reads them', () => {
    expect(dayTypeLabel('power_speed')).toBe('Power + Speed');
    expect(dayTypeLabel('recovery_mobility')).toBe('Recovery - Mobility');
  });
});

describe('validateWeekdayLayout', () => {
  it('accepts Mon, Tue, Thu, Sat at 4 days', () => {
    expect(validateWeekdayLayout([1, 2, 4, 6], 4, RULESET_V1)).toEqual({ ok: true });
  });

  it('accepts every workable pick at 2, 3, 4 and 5 days', () => {
    expect(validateWeekdayLayout([1, 4], 2, RULESET_V1)).toEqual({ ok: true });
    expect(validateWeekdayLayout([1, 3, 5], 3, RULESET_V1)).toEqual({ ok: true });
    expect(validateWeekdayLayout([1, 2, 3, 5], 4, RULESET_V1)).toEqual({ ok: true });
    expect(validateWeekdayLayout([1, 2, 3, 4, 5], 5, RULESET_V1)).toEqual({ ok: true });
  });

  it('wraps the week around a Saturday day 0', () => {
    expect(validateWeekdayLayout([6, 0, 2, 4], 4, RULESET_V1)).toEqual({ ok: true });
  });

  it('refuses Strength and Power on consecutive days with the exact copy', () => {
    const decision = validateWeekdayLayout([1, 2], 2, RULESET_V1);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.rule).toBe(91);
    expect(decision.reason).toBe(
      "Strength and Power can't be on consecutive days (rule 91). Pick another day.",
    );
  });

  it('refuses the wrong number of days and repeated days', () => {
    const count = validateWeekdayLayout([1, 2, 4], 4, RULESET_V1);
    expect(count.ok).toBe(false);
    if (count.ok) return;
    expect(count.reason).toBe('Pick 4 training days.');
    const repeated = validateWeekdayLayout([1, 1, 4, 6], 4, RULESET_V1);
    expect(repeated.ok).toBe(false);
    const outOfRange = validateWeekdayLayout([1, 2, 4, 9], 4, RULESET_V1);
    expect(outOfRange.ok).toBe(false);
    const days = validateWeekdayLayout([1, 2, 4, 6, 0, 3], 6, RULESET_V1);
    expect(days.ok).toBe(false);
  });

  it('is the same function the setup screen calls', () => {
    expect(validateWeekdays).toBe(validateWeekdayLayout);
  });
});
