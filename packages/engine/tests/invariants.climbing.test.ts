/**
 * The speed-climbing face of the invariant grid, plus the guard that says the
 * four sports that shipped before it are untouched.
 *
 * The grid is generated once in `tests/grid.climbing.ts` and every week is
 * checked as it is built. Each test here asserts that one invariant's
 * violation list came back empty. `checkSession` is the same function the
 * basketball grid runs, so every invariant brief section 09 "Tests" names is
 * asserted over this face too, not only the climbing ones.
 */
import { describe, expect, it } from 'vitest';
import { climbingGrid, climbingAthlete, readinessInputFor } from './grid.climbing.js';
import { PROGRAM_START, gridRuleset, gridSeed } from './grid.support.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { sportRequirementsFor } from '../src/select/sport.js';
import type { Athlete } from '../src/types/athlete.js';
import type { Sport } from '../src/types/core.js';
import type { MaterializeContext, MaterializeHistory, WeekPlan } from '../src/types/plan.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
const climbing = ruleset.constants.climbing;

function clean(key: string): void {
  const found = climbingGrid().violations[key] ?? [];
  expect(found, found.slice(0, 5).join('\n')).toEqual([]);
}

function freshHistory(): MaterializeHistory {
  return {
    rotationHistory: {},
    ladderState: {},
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    consecutiveAdherence: [],
    testPlateau: false,
    liftPlateau: {},
    liftRaisedSinceBlockStart: {},
  };
}

function build(athlete: Athlete, w: number, history = freshHistory(), today?: string): WeekPlan {
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const week = skeleton.weeks.find((entry) => entry.w === w);
  if (week === undefined) throw new RangeError(`no week ${w}`);
  const context: MaterializeContext = {
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton,
    w,
    workingMaxes: [],
    history,
    today: today ?? week.windowStart,
    seed: 11,
  };
  return materializeWeek(context);
}

describe('invariants over the speed-climbing grid', () => {
  it(
    'covers the axes the spec names and reports what it sampled',
    () => {
      const report = climbingGrid();
      expect(report.programs).toBeGreaterThan(100);
      expect(report.weeks).toBeGreaterThan(700);
      expect(report.sessions).toBeGreaterThan(3000);
      expect(report.sampled).toHaveLength(5);
    },
    120000,
  );

  it('at most 2 high-CNS exercises in every session (R44)', () => clean('R44'));

  it('at most 2 knee-, spine- or shoulder-high exercises per session (R23 to R25)', () =>
    clean('R23_R25'));

  it('at most 25 high-intensity and 20 high-amplitude contacts per session (R85, R52)', () => {
    clean('R85');
    clean('R52');
  });

  it('extensive contacts sit inside the level range and on the R89 target on load-week jump days', () => {
    clean('R82_R84_range');
    clean('R82_R84');
    clean('R89');
  });

  it('every ascending top set respects the level cap and the held-set rule (R154, R155)', () => {
    clean('R154');
    clean('R155');
    clean('R1');
  });

  it('reps descend, every set carries its own load, and non-loadable rows carry none (R148, R159, R161)', () => {
    clean('R148');
    clean('R159');
    clean('R161');
  });

  it('at most 8 displayed exercises, both-sides reminders, and display modes hold', () => {
    clean('display_cap');
    clean('both_sides');
    clean('display_mode');
  });

  it('loads land on the grid, ballistic loads stay under the ceiling, heights come from the inventory', () => {
    clean('R162');
    clean('ballistic');
    clean('heights');
  });

  it('depth jumps stay behind their gate on every climbing week', () => clean('depth_jump_gate'));

  it('every week carries a tendon loading exercise, hangboard or no hangboard (R99)', () =>
    clean('R99'));

  it('maximal CNS sessions are at least 2 calendar days apart (R90, R93)', () => clean('R90_R93'));

  it('the upper-power day is never a maximal CNS session, so R90 holds across the week', () =>
    clean('sc_upper_not_cns'));

  it('no change-of-direction rep and no conditioning block, ever', () => {
    clean('sc_no_cod');
    clean('sc_no_conditioning');
  });

  it('one 10 to 30 m acceleration sprint on every load-week Power day (R102, R104, R113)', () => {
    clean('sc_sprint_present');
    clean('sc_sprint_block');
    clean('sc_sprint_class');
    clean('sc_sprint_rest');
  });

  it('hard finger work only where the wall allows it (house `house.sc.hard_finger_spacing`)', () => {
    clean('sc_wall_finger');
    clean('sc_demotion_line');
  });

  it('the upper-power day lands on a day that can carry hard finger work', () => {
    clean('sc_upper_placement');
    clean('sc_upper_hard_finger');
  });

  it('every pulling row is an open-hand variant (house `house.sc.open_hand_grip`)', () =>
    clean('sc_open_hand'));

  it('hard finger sessions sit at least 48 hours apart (house `house.sc.hard_finger_spacing`)', () =>
    clean('sc_finger_spacing'));

  it('a finger-pain answer over the ceiling leaves no hard finger row (house `house.sc.finger_pain_ceiling`)', () =>
    clean('sc_finger_pain'));

  it('the knee-alignment row runs twice a week and clears the wall gap (house `house.sc.rnt_valgus_control`)', () => {
    clean('sc_rnt_count');
    clean('sc_rnt_wall_gap');
  });

  it('calf volume runs on one day a week at two sets (house `house.sc.calf_volume_low`)', () =>
    clean('sc_calf'));

  it('every unilateral row names the weaker side (house `house.sc.weaker_side_first`)', () =>
    clean('sc_weaker_side'));

  it('every load week carries one jump session and one upper-power session (house `house.sc.sport_requirements`)', () =>
    clean('sc_weekly_sessions'));

  it('the seed never leaks: no other check recorded a violation key', () => {
    const keys = Object.keys(climbingGrid().violations);
    expect(keys, keys.join(', ')).toEqual([]);
  });
});

describe('the finger-pain ceiling end to end', () => {
  const athlete = climbingAthlete(4);

  it('keeps the hard finger work at or under the ceiling and removes it above', () => {
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const week = skeleton.weeks.find((entry) => entry.w === 7);
    const upper = week?.sessions.find((session) => session.dayType === 'upper_strength');
    expect(upper).toBeDefined();
    if (upper === undefined) return;

    const at = (pain: number): WeekPlan => {
      const history = freshHistory();
      history.fingerPainToday = pain;
      return build(athlete, 7, history, upper.date);
    };

    const fine = at(climbing.fingerPainCeiling).sessions.find((s) => s.date === upper.date);
    expect(fine?.fingerLoad).toBe('hard');

    const sore = at(climbing.fingerPainCeiling + 1).sessions.find((s) => s.date === upper.date);
    expect(sore?.fingerLoad).not.toBe('hard');
    expect(sore?.notices.join(' ')).toContain('Finger pain');
    // Today only: every other session in the same week keeps its own answer.
    const others = at(climbing.fingerPainCeiling + 1).sessions.filter((s) => s.date !== upper.date);
    for (const session of others) {
      expect(session.notices.join(' ')).not.toContain('Finger pain');
    }
  });
});

describe('the readiness gate end to end', () => {
  const athlete = climbingAthlete(4);
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const jumpDate =
    skeleton.weeks.find((entry) => entry.w === 7)?.sessions.find((s) => s.isTestDay)?.date ?? '';

  function gated(state: Parameters<typeof readinessInputFor>[0]): WeekPlan {
    const history = freshHistory();
    history.readinessToday = readinessInputFor(state, jumpDate);
    return build(athlete, 7, history, jumpDate);
  }

  it('writes a line on today and on no other session', () => {
    const week = gated('both_high');
    const today = week.sessions.find((session) => session.date === jumpDate);
    expect(today?.readiness?.state).toBe('both_high');
    expect(today?.notices.join(' ')).toContain('Readiness:');
    for (const session of week.sessions) {
      if (session.date === jumpDate) continue;
      expect(session.readiness).toBeUndefined();
    }
  });

  it('holds the volume on an autonomic-low day and never raises it', () => {
    const open = gated('both_high').sessions.find((session) => session.date === jumpDate);
    const held = gated('autonomic_low').sessions.find((session) => session.date === jumpDate);
    expect(held?.headerSuffixes).toContain('· Readiness: volume held');
    expect(held?.contacts.targetExtensive ?? 0).toBeLessThanOrEqual(
      open?.contacts.targetExtensive ?? 0,
    );
    expect(held?.contacts.extensive ?? 0).toBeLessThanOrEqual(open?.contacts.extensive ?? 0);
  });

  it('drops a neuromuscular-low day one tier and takes the maximal jumps out', () => {
    const open = gated('both_high').sessions.find((session) => session.date === jumpDate);
    const cut = gated('neuromuscular_low').sessions.find((session) => session.date === jumpDate);
    expect(cut?.headerSuffixes).toContain('· Readiness: one tier down');
    expect(cut?.contacts.highIntensity ?? 0).toBeLessThanOrEqual(
      open?.contacts.highIntensity ?? 0,
    );
    expect(cut?.trimmed.some((entry) => entry.reason.startsWith('Readiness low'))).toBe(true);
  });

  it('drops everything one tier on a both-low day and keeps the unreduced rows', () => {
    const cut = gated('both_low').sessions.find((session) => session.date === jumpDate);
    expect(cut?.readiness?.state).toBe('both_low');
    expect(cut?.headerSuffixes).toContain('· Readiness: one tier down');
    const reduced = cut?.blocks
      .flatMap((block) => block.exercises)
      .flatMap((row) => row.sets)
      .filter((set) => set.original !== undefined);
    expect((reduced ?? []).length).toBeGreaterThan(0);
    // Downward only, along whichever axis the row runs on: a jump row loses
    // reps, a loaded row gains reps at a lighter load. Neither gets harder.
    for (const set of reduced ?? []) {
      const before = set.original;
      if (before === undefined) continue;
      const lighter = (set.loadKg ?? 0) <= (before.loadKg ?? 0);
      const fewer = (set.reps ?? 0) <= (before.reps ?? 0);
      expect(lighter || fewer).toBe(true);
      if ((set.reps ?? 0) > (before.reps ?? 0)) {
        expect(set.loadKg ?? 0).toBeLessThan(before.loadKg ?? Number.POSITIVE_INFINITY);
      }
    }
  });

  it('changes nothing when neither channel has a number', () => {
    const blind = gated('unknown').sessions.find((session) => session.date === jumpDate);
    const open = build(athlete, 7, freshHistory(), jumpDate).sessions.find(
      (session) => session.date === jumpDate,
    );
    expect(blind?.headerSuffixes).toEqual(open?.headerSuffixes);
    expect(blind?.contacts.extensive).toBe(open?.contacts.extensive);
    expect(blind?.notices).toEqual(open?.notices);
  });
});

describe('the knee-alignment row and the wall gap', () => {
  it('says why when the week has nowhere far enough from the wall', () => {
    const athlete = climbingAthlete(4);
    // Climbing Monday, Tuesday and Thursday evenings with the gym in the
    // evening too: only the Saturday clears the six-hour gap, so one row goes
    // there, the second is placed on a wall day anyway and says to keep the
    // gap, and the day it moved off says why.
    athlete.wallWork = { weekdays: [1, 2, 4], typicalStart: '18:00', typicalEnd: '20:00' };
    athlete.sessionWindow = { start: '17:00', end: '19:00' };
    const week = build(athlete, 7);
    const forced = week.sessions.filter((session) =>
      session.notices.some((line) => line.startsWith('RNT')),
    );
    expect(forced.length).toBeGreaterThan(0);
    expect(forced[0]?.notices.join(' ')).toContain('inside 6 hours of your wall session');
    expect(forced[0]?.notices.join(' ')).toContain('keep 6 h from wall work');
    expect(week.sessions.filter((session) => session.rntScheduled)).toHaveLength(2);
  });

  it('measures the gap from the hour the athlete says they train', () => {
    const morning = climbingAthlete(4);
    morning.wallWork = { weekdays: [1, 2], typicalStart: '18:00', typicalEnd: '20:00' };
    morning.sessionWindow = { start: '06:00', end: '08:00' };
    // A 6 a.m. session on a wall evening clears the six-hour gap, so nothing
    // is forced and no line is written.
    const week = build(morning, 7);
    expect(week.sessions.filter((session) => session.rntScheduled)).toHaveLength(2);
    for (const session of week.sessions) {
      expect(session.notices.some((line) => line.startsWith('RNT'))).toBe(false);
    }
  });
});

describe('the four sports that shipped before speed climbing are untouched', () => {
  const SPORTS: Sport[] = ['basketball', 'football', 'soccer', 'track_field'];

  it('keeps their week-level requirements exactly as they were', () => {
    for (const sport of SPORTS) {
      const requirements = sportRequirementsFor(sport, ruleset);
      expect(requirements.jumpOrReactiveSessionsPerWeek, sport).toBe(0);
      expect(requirements.upperPowerSessionsPerWeek, sport).toBe(0);
      expect(requirements.allowsConditioningBlock, sport).toBe(true);
      expect(requirements.upperDayIntent, sport).toBe('strength');
      expect(requirements.houseRuleId, sport).toBeUndefined();
    }
    expect(sportRequirementsFor('basketball', ruleset).requiresCod).toBe(true);
    expect(sportRequirementsFor('soccer', ruleset).requiresCod).toBe(true);
    expect(sportRequirementsFor('football', ruleset).sprintClass).toBe('acceleration');
    expect(sportRequirementsFor('track_field', ruleset).sprintClass).toBe('max_velocity');
  });

  it('never puts a speed-climbing row in their pool, and never a house rule on their week', () => {
    const tagged = new Set(exercises.filter((entry) => entry.sports !== undefined).map((e) => e.id));
    expect(tagged.size).toBeGreaterThan(0);
    for (const sport of SPORTS) {
      const athlete: Athlete = { ...climbingAthlete(4), sport };
      delete athlete.fingerHistory;
      delete athlete.gripMode;
      delete athlete.fingerPainCeiling;
      delete athlete.valgusControl;
      delete athlete.weakerSide;
      delete athlete.readinessConfig;
      delete athlete.secondaryGoal;
      const week = build(athlete, 7);
      expect(week.houseRuleIds, sport).toBeUndefined();
      for (const session of week.sessions) {
        expect(session.sessionIntent, sport).toBeUndefined();
        expect(session.readiness, sport).toBeUndefined();
        for (const block of session.blocks) {
          for (const row of block.exercises) {
            expect(tagged.has(row.exerciseId), `${sport}: ${row.exerciseId}`).toBe(false);
            expect(row.sideNote, `${sport}: ${row.exerciseId}`).toBeUndefined();
            expect(row.fingerNote, `${sport}: ${row.exerciseId}`).toBeUndefined();
          }
        }
      }
    }
  });
});
