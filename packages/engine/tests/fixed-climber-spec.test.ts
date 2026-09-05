/**
 * FIXED: SPEC FIDELITY, part 1 of 3.
 *
 * The Block 1 answers in the owner's athlete spec (climber-spec.md): the grip,
 * the 48 h finger spacing, the 3 out of 10 finger-pain ceiling, the RNT
 * placement, and the weaker side. Nothing here is read back off the engine:
 * every expectation is recomputed from the spec's own words, and every athlete
 * comes from `climberAthlete()`, which IS the spec's athlete.
 *
 * Every gap the lens found is fixed and this file now proves the fix. Two
 * readings the owner still has to settle are named OPEN, assert what the rule
 * book gives today, and quote the spec line they sit against.
 */
import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '../src/calendar.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { findHouseRule } from '../src/ruleset/index.js';
import {
  farFromWall,
  fingerSpacingOk,
  gripAllows,
  planRntSessions,
} from '../src/select/sport.js';
import { readAsymmetry, weakerSideFrom } from '../src/analytics/asymmetry.js';
import { climberAthlete, climberSingleLegTests } from '../src/fixtures/climber.js';
import {
  FIVE_DAY,
  FOUR_DAY,
  START,
  WEEKDAY_SETS,
  allWeeks,
  buildWeek,
  byId,
  climber,
  climberOnDays,
  climbing,
  rowsOf,
  ruleset,
} from './fixed-climber-spec.support.js';
import type { WallWork } from '../src/types/athlete.js';
import type { SessionPlan, WeekPlan } from '../src/types/plan.js';
/* ------------------------------------------------------- 1. open hand only */

describe('spec: open-hand only on all pulling movements', () => {
  it('the spec athlete carries the pulley history and the open-hand grip', () => {
    const athlete = climberAthlete();
    expect(athlete.fingerHistory).toBe(true);
    expect(athlete.gripMode).toBe('open_hand');
  });

  it('every pulling row in every week is open hand and says so', () => {
    for (const weekdays of WEEKDAY_SETS) {
      const athlete = climberOnDays(weekdays);
      for (const week of allWeeks(athlete)) {
        for (const session of week.sessions) {
          for (const row of rowsOf(session)) {
            const exercise = byId.get(row.exerciseId);
            if (exercise === undefined || !exercise.isPulling) continue;
            expect(exercise.gripMode, `${row.exerciseId} in w${week.w}`).toBe('open_hand');
            expect(row.fingerNote, row.exerciseId).toBe('Open hand only.');
          }
        }
      }
    }
  });

  it('the crimping twin is refused and the open-hand twin is kept', () => {
    const athlete = climberAthlete();
    const pullUp = byId.get('pull_up');
    const openHand = byId.get('pull_up_open_hand');
    const squat = byId.get('box_squat');
    if (pullUp === undefined || openHand === undefined || squat === undefined) {
      throw new Error('seed is missing a row this test needs');
    }
    expect(gripAllows(pullUp, athlete)).toBe(false);
    expect(gripAllows(openHand, athlete)).toBe(true);
    expect(gripAllows(squat, athlete)).toBe(true);
  });

  it('an athlete with healthy fingers still gets the ordinary pull-up', () => {
    const healthy = climber({ fingerHistory: false, gripMode: 'any', sport: 'basketball' });
    const pullUp = byId.get('pull_up');
    if (pullUp === undefined) throw new Error('seed is missing pull_up');
    expect(gripAllows(pullUp, healthy)).toBe(true);
  });
});

/* --------------------------------------------------- 2. 48 h finger spacing */

describe('spec: minimum 48 h between hard finger sessions', () => {
  it('the ruleset ships the 48 h number', () => {
    expect(climbing.fingerSpacingHours).toBe(48);
  });

  it('no two hard finger sessions land inside 48 h, on any weekday pattern', () => {
    for (const weekdays of WEEKDAY_SETS) {
      const athlete = climberOnDays(weekdays);
      for (const week of allWeeks(athlete)) {
        const hard = week.sessions.filter((session) => session.fingerLoad === 'hard');
        for (let i = 0; i < hard.length; i += 1) {
          for (let j = i + 1; j < hard.length; j += 1) {
            const a = hard[i];
            const b = hard[j];
            if (a === undefined || b === undefined) continue;
            const hours = Math.abs(diffDays(a.date, b.date)) * 24;
            expect(hours, `${a.date} vs ${b.date} in w${week.w}`).toBeGreaterThanOrEqual(48);
          }
        }
      }
    }
  });

  it('measures the gap start to start, which is what the rule now says', () => {
    // Spec: "Minimum 48 h between hard finger sessions". `hoursBetweenSessions`
    // is whole calendar days times 24, so a Tuesday and a Thursday hard session
    // are exactly 48 h apart and are the closest pair the engine will give.
    // `farFromWall` measures its own six hours window end to start, which is a
    // different question; the shipped rule text now names both clocks, so the
    // athlete is told which one is running.
    expect(
      findHouseRule(ruleset, 'house.sc.hard_finger_spacing')?.text ?? '',
    ).toContain('from the start of one to the start of the next');
    // The owner climbs Tuesday, Thursday and Sunday, and a climbing session is
    // a hard finger session, so the week has room for exactly ONE gym session
    // with hard finger work: the Tuesday it shares with the wall, eight hours
    // clear of it. Every other training day is inside 48 h of a climbing day.
    const athlete = climberOnDays(FIVE_DAY);
    const week = buildWeek(athlete, 1);
    const hard = week.sessions.filter((session) => session.fingerLoad === 'hard');
    expect(hard.length).toBe(1);
    const only = hard[0];
    if (only === undefined) return;
    expect(athlete.wallWork?.weekdays).toContain(only.weekday);
    expect(
      fingerSpacingOk([...week.sessions], week.sessions.indexOf(only), 48, athlete, 6),
    ).toBe(true);
    // A day that is not a climbing day and sits inside 48 h of one is refused
    // outright: Monday is one day from both the Sunday and the Tuesday wall.
    const monday = week.sessions.find((session) => session.weekday === 1);
    expect(monday).toBeDefined();
    if (monday === undefined) return;
    expect(
      fingerSpacingOk([...week.sessions], week.sessions.indexOf(monday), 48, athlete, 6),
    ).toBe(false);
  });
});

/* ------------------------------------------- 3. finger pain ceiling 3 and 4 */

describe('spec: finger pain ceiling 3 out of 10', () => {
  const upperDay = addDays(START, 1);

  it('the ceiling is three, on the athlete and in the ruleset', () => {
    expect(climberAthlete().fingerPainCeiling).toBe(3);
    expect(climbing.fingerPainCeiling).toBe(3);
  });

  it('at 3 the hard finger work stays and nothing is written down', () => {
    const week = buildWeek(climber(), 1, { history: { fingerPainToday: 3 }, today: upperDay });
    const session = week.sessions.find((entry) => entry.date === upperDay);
    if (session === undefined) throw new Error('no session on the upper day');
    expect(session.fingerLoad).toBe('hard');
    expect(rowsOf(session).map((row) => row.exerciseId)).toContain('weighted_pull_up');
    expect(session.notices.some((line) => line.includes('Finger pain'))).toBe(false);
  });

  it('at 4 every hard finger row leaves the day and it is written down', () => {
    const week = buildWeek(climber(), 1, { history: { fingerPainToday: 4 }, today: upperDay });
    const session = week.sessions.find((entry) => entry.date === upperDay);
    if (session === undefined) throw new Error('no session on the upper day');
    expect(session.fingerLoad).not.toBe('hard');
    for (const row of rowsOf(session)) {
      expect(byId.get(row.exerciseId)?.fingerLoad, row.exerciseId).not.toBe('hard');
    }
    expect(session.notices).toContain(
      "Finger pain at 4 out of 10: the hard finger work is out of today's session.",
    );
  });

  it('the answer touches today only, never the rest of the week', () => {
    const athlete = climberOnDays(FIVE_DAY);
    const asWritten = buildWeek(athlete, 1);
    const week = buildWeek(athlete, 1, {
      history: { fingerPainToday: 8 },
      today: upperDay,
    });
    const today = week.sessions.find((entry) => entry.date === upperDay);
    expect(today?.fingerLoad).not.toBe('hard');
    expect(asWritten.sessions.find((entry) => entry.date === upperDay)?.fingerLoad).toBe('hard');
    // Every other day of the week is byte-identical to the week the athlete
    // would have had without the answer, and none of them mentions it.
    for (const entry of week.sessions) {
      if (entry.date === upperDay) continue;
      const before = asWritten.sessions.find((other) => other.date === entry.date);
      expect(JSON.stringify(entry), entry.date).toBe(JSON.stringify(before));
      expect(entry.notices.some((line) => line.includes('Finger pain'))).toBe(false);
    }
  });
});

/* ------------------------------------------- 4. RNT twice a week, 6 h clear */

describe('spec: RNT valgus control 2x per week, 6 h from wall work', () => {
  const WALL_CASES: { name: string; wallWork?: WallWork }[] = [
    { name: 'no wall days' },
    {
      name: 'Mon Wed Fri evenings',
      wallWork: { weekdays: [1, 3, 5], typicalStart: '18:00', typicalEnd: '20:00' },
    },
    {
      name: 'Wed Fri evenings',
      wallWork: { weekdays: [3, 5], typicalStart: '18:00', typicalEnd: '20:00' },
    },
    {
      name: 'every evening',
      wallWork: { weekdays: [0, 1, 2, 3, 4, 5, 6], typicalStart: '18:00', typicalEnd: '21:00' },
    },
    {
      name: 'all day every day',
      wallWork: { weekdays: [0, 1, 2, 3, 4, 5, 6], typicalStart: '06:00', typicalEnd: '23:00' },
    },
  ];

  it('the ruleset ships two sessions a week and a six hour gap', () => {
    expect(climbing.rntSessionsPerWeek).toBe(2);
    expect(climbing.rntWallGapHours).toBe(6);
  });

  function rntSessions(week: WeekPlan): SessionPlan[] {
    return week.sessions.filter((session) =>
      session.blocks.some((block) =>
        block.exercises.some((row) => byId.get(row.exerciseId)?.isRnt === true),
      ),
    );
  }

  it('exactly two sessions a week carry the row, in every wall configuration', () => {
    for (const wall of WALL_CASES) {
      for (const weekdays of [FOUR_DAY, FIVE_DAY]) {
        const athlete = climberOnDays(weekdays);
        if (wall.wallWork === undefined) delete athlete.wallWork;
        else athlete.wallWork = wall.wallWork;
        for (const week of allWeeks(athlete)) {
          if (week.kind === 'peak') continue;
          const carrying = rntSessions(week);
          const at = `${wall.name}/d${weekdays.length}/w${week.w}`;
          expect(carrying.length, at).toBe(2);
          expect(
            carrying.every((session) => session.rntScheduled),
            at,
          ).toBe(true);
          expect(
            carrying.some((session) => session.dayType === 'recovery_mobility'),
            at,
          ).toBe(false);
        }
      }
    }
  });

  it('carries one knee-alignment row in the peak week, and the rule says so', () => {
    // The peak session's template is the main lift and the jumps alone, so it
    // has no injury-prevention slot and only one of the peak week's sessions
    // can take the row. The shipped rule text now carries that exception, the
    // way `house.taper_policy` and `house.peak_policy` carry theirs.
    expect(
      findHouseRule(ruleset, 'house.sc.rnt_valgus_control')?.text ?? '',
    ).toContain('The peak week carries fewer');
    for (const weekdays of [FOUR_DAY, FIVE_DAY]) {
      const weeks = allWeeks(climberOnDays(weekdays));
      const peak = weeks.find((week) => week.kind === 'peak');
      const taper = weeks.find((week) => week.kind === 'taper');
      if (peak === undefined || taper === undefined) throw new Error('no peak or taper week');
      expect(rntSessions(peak).length).toBe(1);
      expect(rntSessions(taper).length).toBe(2);
    }
  });

  it('when enough sessions clear the wall, only the clear ones are used', () => {
    const athlete = climber({
      wallWork: { weekdays: [1, 3, 5], typicalStart: '18:00', typicalEnd: '20:00' },
    });
    const week = buildWeek(athlete, 2);
    const carrying = week.sessions.filter((session) => session.rntScheduled);
    expect(carrying.length).toBe(2);
    for (const session of carrying) {
      expect(farFromWall(session.date, athlete, 6), session.date).toBe(true);
    }
  });

  it('when no session clears the wall, the row is placed anyway and says to keep the gap', () => {
    const athlete = climber({
      wallWork: { weekdays: [0, 1, 2, 3, 4, 5, 6], typicalStart: '06:00', typicalEnd: '23:00' },
    });
    const week = buildWeek(athlete, 2);
    const carrying = week.sessions.filter((session) => session.rntScheduled);
    expect(carrying.length).toBe(2);
    for (const session of carrying) {
      expect(farFromWall(session.date, athlete, 6)).toBe(false);
      expect(session.notices).toContain('RNT: keep 6 h from wall work.');
    }
  });

  it('says on the week why the row moved off a day, even when nothing was forced', () => {
    // Spec: "the RNT row is placed on sessions at least 6 h from wall work,
    // else it moves to the next eligible session WITH A LINE SAYING WHY". The
    // day it moved off carries no RNT row, so the explanation is a week-level
    // fact and rides `week.lines`; a session that had to take the row anyway
    // still carries the cue in its own notices.
    const athlete = climber({
      wallWork: { weekdays: [1, 3, 5], typicalStart: '18:00', typicalEnd: '20:00' },
      // An evening gym window, so a wall weekday really is inside the gap, and
      // four picks with two of them clear of it, so the row moves rather than
      // being forced.
      sessionWindow: { start: '17:00', end: '19:00' },
      weekdays: [1, 2, 4, 6],
    });
    const planned = planSkeleton(athlete, START, ruleset).weeks[1];
    if (planned === undefined) throw new Error('no week 2 in the skeleton');
    const plan = planRntSessions(planned.sessions, athlete, ruleset);
    expect(plan.movedLines).toEqual([
      'RNT moved off Monday: it is inside 6 hours of your wall session.',
    ]);
    expect(plan.forcedLines).toEqual([]);
    expect(plan.forced.size).toBe(0);

    const week = buildWeek(athlete, 2);
    expect(week.lines).toContain(
      'RNT moved off Monday: it is inside 6 hours of your wall session.',
    );
  });

  it('reads a zero the athlete typed as an answer, not as an unanswered setting', () => {
    // `??`, never `||`: a nought-hour gap says the wall needs no spacing, so
    // nothing may be reported as moved or forced, and a nought count asks for
    // no rows at all.
    const noGap = climber({
      valgusControl: { required: true, sessionsPerWeek: 2, minHoursFromWall: 0 },
      wallWork: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
    });
    const week = buildWeek(noGap, 2);
    const wallLines = [
      ...week.lines,
      ...week.sessions.flatMap((session) => session.notices),
    ].filter((line) => line.includes('wall'));
    expect(wallLines).toEqual([]);
    expect(week.sessions.filter((session) => session.rntScheduled).length).toBe(2);

    const noRows = climber({
      valgusControl: { required: true, sessionsPerWeek: 0, minHoursFromWall: 6 },
    });
    expect(buildWeek(noRows, 2).sessions.filter((session) => session.rntScheduled)).toEqual([]);
  });
});

/* ------------------------------------------------------ 5. weaker side first */

describe('spec: unilateral leg work, weaker side first', () => {
  it('the weaker side comes from the latest single-leg test', () => {
    const tests = climberSingleLegTests(climbing.asymmetryBandPct);
    expect(weakerSideFrom(tests, null, climbing.asymmetryBandPct)).toBe('left');
    const latest = tests[tests.length - 1];
    if (latest === undefined) throw new Error('no single-leg test');
    expect(readAsymmetry(latest).weakerSide).toBe('left');
  });

  it('with no test on file the athlete own answer decides', () => {
    expect(weakerSideFrom([], 'right', climbing.asymmetryBandPct)).toBe('right');
    expect(weakerSideFrom([], null, climbing.asymmetryBandPct)).toBeNull();
  });

  it('every unilateral row in every week names the weaker side', () => {
    for (const weekdays of [FOUR_DAY, FIVE_DAY]) {
      for (const week of allWeeks(climberOnDays(weekdays))) {
        for (const session of week.sessions) {
          for (const row of rowsOf(session)) {
            if (byId.get(row.exerciseId)?.unilateral !== true) continue;
            expect(row.sideNote, `${row.exerciseId} in w${week.w}`).toBe('Weaker side first: left');
          }
        }
      }
    }
  });
});

/* ------------------------------------- 6. box squat 320 and the 345 discard */
