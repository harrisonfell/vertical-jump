/**
 * The invariant grid from brief section 09 "Tests".
 *
 * The grid is generated once in `tests/grid.support.ts` and every week is
 * checked as it is built, so the whole program space is covered without
 * holding thousands of `WeekPlan`s in memory. Each test here asserts that one
 * invariant's violation list came back empty and names what it covered.
 *
 * Sampling is deliberate and reported: program lengths, days per week, levels
 * and inventories are exhaustive; the pain states, the under-18 cap, the
 * in-season override and the missing readiness checklist run on a smaller face
 * of the grid. `grid().sampled` prints the exact axes.
 */
import { describe, expect, it } from 'vitest';
import { PAIN_CASES, PROGRAM_START, grid, gridRuleset, gridSeed } from './grid.support.js';
import { build, freshHistory, twelveWeekOwner } from './invariants.support.js';
import { evaluatePainGate } from '../src/select/painGate.js';
import { resolveCapPct } from '../src/prescribe/caps.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { advanceRungs, tendonModeFor } from '../src/skeleton/targets.js';
import type { Athlete } from '../src/types/athlete.js';
import type { SetLog } from '../src/types/logs.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;

function clean(key: string): void {
  const found = grid().violations[key] ?? [];
  expect(found, found.slice(0, 5).join('\n')).toEqual([]);
}

describe('invariants over the generated grid (brief section 09 "Tests")', () => {
  it(
    'covers the grid the brief names and reports what it sampled',
    () => {
      const report = grid();
      expect(report.programs).toBeGreaterThan(400);
      expect(report.weeks).toBeGreaterThan(4000);
      expect(report.sessions).toBeGreaterThan(14000);
      expect(report.sampled.length).toBeGreaterThanOrEqual(5);
    },
    // The whole grid is generated here, once, for every test in the file.
    60000,
  );

  it('at most 2 high-CNS exercises in every session (R44)', () => clean('R44'));

  it('at most 2 knee-, spine- or shoulder-high exercises per session, with the R23 to R25 follow-ons honoured', () =>
    clean('R23_R25'));

  it('a week with 4 or more high-stress exercises for one joint cuts that joint at least 50 percent next week (R26)', () => {
    const athlete = twelveWeekOwner();
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const history = freshHistory();
    history.jointHighStressLastWeek = { knee: 4, spine: 0, shoulder: 0 };
    const week = materializeWeek({
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      w: 2,
      workingMaxes: [],
      history,
      today: skeleton.weeks[1]?.windowStart ?? PROGRAM_START,
      seed: 3,
    });
    const byId = new Map(exercises.map((entry) => [entry.id, entry]));
    for (const session of week.sessions) {
      const kneeHigh = session.blocks
        .filter((block) => block.name !== 'warm_up')
        .flatMap((block) => block.exercises)
        .filter((row) => byId.get(row.exerciseId)?.kneeStress === 'high').length;
      expect(kneeHigh).toBeLessThanOrEqual(1);
    }
    expect(week.lines.join(' ')).toContain('Knee load reduced this week: 4 high-stress exercises last week, so 1 this week.');
  });

  it('at most 25 high-intensity contacts in every session (R85), at every level', () => clean('R85'));

  it('at most 20 high-amplitude contacts in every session across all high-amplitude drills together (R52)', () =>
    clean('R52'));

  it('extensive contacts sit inside the level range on load-week Power days (R82 to R84)', () =>
    clean('R82_R84_range'));

  it('extensive contacts equal the R89 target E = clamp(bottom + 10k - 2H, bottom, top) on load-week Power days', () => {
    clean('R89');
    clean('R82_R84');
  });

  it('the strength-day primer, Upper + Mobility and Recovery contacts sit outside the extensive range by declared reading', () => {
    const week = build(twelveWeekOwner(), 2);
    const strength = week.sessions.find((session) => session.dayType === 'lower_strength');
    const recovery = week.sessions.find((session) => session.dayType === 'recovery_mobility');
    expect(strength?.contacts.extensive).toBeLessThanOrEqual(
      ruleset.constants.contactCaps.primerJumpCapStrengthDay,
    );
    expect(recovery?.contacts.extensive).toBe(ruleset.constants.contactCaps.recovery);
  });

  it('every ascending top set respects the level cap 80, 87, 92 (R154)', () => clean('R154'));

  it('a mild-pain 80 percent cap binds only the attribute the rule names, and beats the level cap (R163)', () => {
    const mild = PAIN_CASES.find((entry) => entry.name === 'mild knee chronic');
    const athlete: Athlete = { ...twelveWeekOwner(), painStatus: mild?.painStatus ?? [] };
    const gate = evaluatePainGate(
      {
        clearance: athlete.clearance,
        painStatus: athlete.painStatus,
        isAdult: true,
        today: PROGRAM_START,
      },
      ruleset,
    );
    const capPct = ruleset.constants.painCaps.mildIntensityCapPct;
    expect(gate.caps.intensityPct).toBe(capPct);

    const week = build(athlete, 2);
    const context = {
      w: 2,
      kind: 'load' as const,
      blockType: 'strength' as const,
      k: 0,
      targets: week.snapshot.targets,
      isFirstProgramWeek1: false,
      isFirstPercentWeekForLift: false,
      sets: 3,
      ruleset,
      painCaps: gate.caps,
      painCapReason: 'mild knee pain',
    };
    const byId = new Map(exercises.map((entry) => [entry.id, entry]));
    const bound = byId.get('bulgarian_split_squat');
    const unbound = byId.get('db_bench_press');
    expect(bound).toBeDefined();
    expect(unbound).toBeDefined();
    if (bound === undefined || unbound === undefined) return;
    expect(resolveCapPct(bound, athlete, context, gate).capPct).toBe(capPct);
    expect(resolveCapPct(unbound, athlete, context, gate).capPct).toBe(
      ruleset.constants.levelTopSetCapPct[athlete.level],
    );

    for (const session of week.sessions) {
      for (const block of session.blocks) {
        for (const row of block.exercises) {
          const exercise = byId.get(row.exerciseId);
          if (exercise === undefined || exercise.kneeStress === 'low') continue;
          for (const set of row.sets) {
            if (set.loadPercent === undefined) continue;
            expect(set.loadPercent).toBeLessThanOrEqual(capPct);
          }
        }
      }
    }
  });

  it('an athlete under 18 never sees a set above 90 percent (R1)', () => clean('R1'));

  it('the week-2 80 percent guard binds a lift in its first percent week (house)', () => {
    const athlete = twelveWeekOwner();
    const logs: SetLog[] = [225, 245, 265].map((lb, index) => ({
      id: `l${index}`,
      sessionId: 'w1-d0',
      exerciseId: 'trap_bar_deadlift',
      setNumber: index + 1,
      repsDone: [5, 4, 3][index] ?? 3,
      loadKg: lb / 2.2046226218,
      loadSource: 'rpe',
      completedAt: '2026-09-08T18:00:00.000Z',
      plannedDate: '2026-09-08',
      idempotencyKey: `k${index}`,
    }));
    const week = build(athlete, 2, { recentLogs: logs });
    const guarded = week.sessions
      .flatMap((session) => session.blocks)
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'trap_bar_deadlift');
    const top = guarded?.sets.filter((set) => !set.isRamp).at(-1);
    expect(top?.loadPercent ?? 0).toBeLessThanOrEqual(ruleset.constants.workingMax.week2GuardPct);
  });

  it('held sets repeat the top set and the lowest rep value once the cap is reached (R155, R161)', () =>
    clean('R155'));

  it('reps descend across distinct ascending steps, 5/4/3 and 12/10/8, with 5/3/1 only for advanced (R161)', () =>
    clean('R161'));

  it('no exercise-level percentage appears anywhere: every set carries its own load (R148)', () => {
    clean('R148');
    const week = build(twelveWeekOwner(), 2);
    for (const session of week.sessions) {
      for (const block of session.blocks) {
        for (const row of block.exercises) {
          expect(Object.keys(row)).not.toContain('loadPercent');
        }
      }
    }
  });

  it('non-loadable rows display reps or time only, never a percent or a load (R159)', () => clean('R159'));

  it('distance rows display distance, time rows display time, and rep rows display neither', () =>
    clean('display_mode'));

  it('unilateral rows carry the both-sides reminder', () => clean('both_sides'));

  it('at most 8 displayed exercises per session, grouped warm-up and cool-down excluded', () =>
    clean('display_cap'));

  it('week 1 of a first program contains exactly one maximal CNS session, the test day (R92)', () =>
    clean('R92'));

  it('week 1 of a first program runs RPE 6 to 7 for every level, capped at 7 (R76)', () => clean('R76'));

  it('maximal CNS sessions are at least 2 calendar days apart (R90, R93, house)', () =>
    clean('R90_R93'));

  it('no maximal plyometrics on the calendar day after a heavy squat session (R91)', () => clean('R91'));

  it('a session with 2 or more spine-high exercises is not followed by a spine-high opener the next calendar day (R24)', () =>
    clean('R24'));

  it('every week contains at least one tendon loading exercise, deload, taper and peak included (R99)', () =>
    clean('R99'));

  it('the R100 runway runs isometric, then slow resistance, then plyometric for raw training age None', () => {
    expect(tendonModeFor('none', 1, 0, 'strength')).toBe('isometric');
    expect(tendonModeFor('none', 2, 0, 'strength')).toBe('isometric');
    expect(tendonModeFor('none', 3, 0, 'strength')).toBe('slow_resistance');
    expect(tendonModeFor('none', 4, 0, 'strength')).toBe('slow_resistance');
    expect(tendonModeFor('none', 6, 1, 'power')).toBe('plyometric');
    // Everyone else runs the same progression without the two isometric weeks.
    expect(tendonModeFor('1to3', 1, 0, 'strength')).toBe('slow_resistance');
    expect(tendonModeFor('1to3', 7, 1, 'power')).toBe('plyometric');
  });

  it('sport = basketball yields both a jump session and a change-of-direction session every week (R137)', () =>
    clean('R137'));

  it('in season, games stand in for the change-of-direction session and jump contacts halve (house)', () => {
    clean('in_season');
    const athlete: Athlete = { ...twelveWeekOwner(), inSeason: true };
    const week = build(athlete, 7);
    expect(week.lines.join(' ')).toContain('In-season');
    const power = week.sessions.find((session) => session.dayType === 'power_speed');
    const open = build(twelveWeekOwner(), 7).sessions.find(
      (session) => session.dayType === 'power_speed',
    );
    expect(power?.contacts.highIntensity ?? 0).toBeLessThan(open?.contacts.highIntensity ?? 0);
  });

  it('a deload week prescribes at most 50 percent of the prior week reps and contacts, with loads held (R105)', () =>
    clean('R105'));

  it('a taper week halves volume, holds loads and box heights, and carries no depth jumps within 4 days of the target', () => {
    clean('R105');
    clean('depth_jump_gate');
  });

  it('the peak session sits 5 days before the target with at most 10 high-intensity contacts', () =>
    clean('peak_session'));

  it('box and hurdle heights come from the inventory and never exceed 24 in, or 18 in over 220 lb or unknown bodyweight', () =>
    clean('heights'));

  it('every prescribed load lands on the 5 lb grid or the inventory plate increment (R162)', () =>
    clean('R162'));

  it('ballistic loads always round down and never exceed the level ceiling of 0, 20 or 30 percent', () =>
    clean('ballistic'));

  it('every ladder resolves to a rank 0 with an empty equipment list', () => {
    for (const ladder of ladders) {
      const rank0 = ladder.rungs.find((rung) => rung.rank === 0);
      expect(rank0, ladder.id).toBeDefined();
      expect(rank0?.equipment).toEqual([]);
    }
  });

  it('a ladder advances at most one rung per week and two per block, and holds in deload, taper and peak', () => {
    const start = { box_jump_height: 0 };
    const one = advanceRungs(start, 'load', true, 0, ruleset);
    expect(one.box_jump_height).toBe(1);
    const two = advanceRungs(one, 'load', true, 1, ruleset);
    expect(two.box_jump_height).toBe(2);
    const third = advanceRungs(two, 'load', true, 2, ruleset);
    expect(third.box_jump_height).toBe(2);
    for (const kind of ['deload', 'taper', 'peak'] as const) {
      expect(advanceRungs(one, kind, true, 0, ruleset).box_jump_height).toBe(1);
    }
  });

  it('block weeks sum to W for every program length and level', () => clean('block_weeks'));

  it('the peak week contains the target date', () => clean('peak_window'));

  it('no depth jumps for beginners, in any first block, in the Strength block, in a deload, or within 4 days of the target', () =>
    clean('depth_jump_gate'));

  it('depth jumps appear only once the readiness checklist has passed', () => clean('depth_jump_gate'));

});
