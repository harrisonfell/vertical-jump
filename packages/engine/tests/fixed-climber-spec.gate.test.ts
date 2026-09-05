/**
 * FIXED: SPEC FIDELITY, part 3 of 3.
 *
 * The readiness gate in the owner's athlete spec (climber-spec.md): two
 * channels never averaged, the four combined states, downward-only adjustments
 * applied to today's session alone, the swappable test configuration, the
 * asymmetry stream that is never canonical and never a personal record, and
 * the week the house rules claim.
 *
 * Every gap the lens found is fixed and this file now proves the fix. Two
 * readings the owner still has to settle are named OPEN, assert what the rule
 * book gives today, and quote the spec line they sit against.
 */
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/calendar.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { materializeWeek } from '../src/materialize.js';
import { readinessTestMatches } from '../src/select/filters.js';
import { adjustmentFor, applyReadinessAdjustment, scoreReadiness } from '../src/readiness/index.js';
import { asymmetryTrend } from '../src/analytics/asymmetry.js';
import { mmToIn } from '../src/units.js';
import {
  CLIMBER_SINGLE_LEG_TESTS,
  buildClimberFixture,
  climberSingleLegTests,
} from '../src/fixtures/climber.js';
import {
  FIVE_DAY,
  FOUR_DAY,
  START,
  allWeeks,
  buildWeek,
  byId,
  climber,
  climberOnDays,
  climbing,
  freshHistory,
  rowsOf,
  ruleset,
  seed,
} from './fixed-climber-spec.support.js';
import type { Athlete } from '../src/types/athlete.js';
import type { MaterializeContext, MaterializeHistory } from '../src/types/plan.js';
import type {
  ReadinessState,
  ReadinessTestConfig,
  ReadinessTestSession,
} from '../src/types/readiness.js';
/* ------------------------------------ 12. the readiness gate, four states */

describe('spec: readiness gate, two channels, four states, downward only', () => {
  function jumpDateFor(athlete: Athlete, w: number): string {
    const week = planSkeleton(athlete, START, ruleset).weeks[w - 1];
    const session = week?.sessions.find(
      (entry) => entry.dayType === 'power_speed' || entry.dayType === 'power',
    );
    if (session === undefined) throw new Error('no jump day');
    return session.date;
  }

  function priors(upTo: string): ReadinessTestSession[] {
    return [1, 2, 3, 4].map((index) => ({
      id: `prior-${index}`,
      date: addDays(upTo, -7 * index),
      kind: 'seated_mb_throw' as const,
      attempts: [7.0, 7.1, 7.05],
      best: 7.1,
      unit: 'm',
    }));
  }

  function channels(state: ReadinessState, date: string): MaterializeHistory['readinessToday'] {
    const good: ReadinessTestSession = {
      id: 'today',
      date,
      kind: 'seated_mb_throw',
      attempts: [7.0, 7.1, 7.05],
      best: 7.1,
      unit: 'm',
    };
    const poor: ReadinessTestSession = { ...good, attempts: [6.0, 6.1, 6.2], best: 6.2 };
    const high = { date, score: 72, band: 'high' as const };
    const low = { date, score: 28, band: 'low' as const };
    const history = priors(date);
    if (state === 'both_high') return { whoop: high, test: good, history };
    if (state === 'autonomic_low') return { whoop: low, test: good, history };
    if (state === 'neuromuscular_low') return { whoop: high, test: poor, history };
    if (state === 'both_low') return { whoop: low, test: poor, history };
    return { whoop: null, test: null, history };
  }

  it('the four states carry exactly the adjustments the spec names', () => {
    expect(adjustmentFor('both_high', ruleset)).toMatchObject({
      tierDown: false,
      holdVolume: false,
      removeMaximalJumps: false,
      jumpVolumeFactor: 1,
      loadFactor: 1,
      extraReps: 0,
    });
    expect(adjustmentFor('autonomic_low', ruleset)).toMatchObject({
      tierDown: false,
      holdVolume: true,
      removeMaximalJumps: false,
      jumpVolumeFactor: 1,
      loadFactor: 1,
    });
    expect(adjustmentFor('neuromuscular_low', ruleset)).toMatchObject({
      tierDown: true,
      removeMaximalJumps: true,
      jumpVolumeFactor: 0.75,
      loadFactor: 1,
      extraReps: 0,
    });
    expect(adjustmentFor('both_low', ruleset)).toMatchObject({
      tierDown: true,
      removeMaximalJumps: true,
      jumpVolumeFactor: 0.5,
      loadFactor: 0.9,
      extraReps: 2,
      offerRecoverySwap: true,
    });
  });

  it('no state may raise anything, and the channels stay in their own order', () => {
    for (const state of ['both_high', 'autonomic_low', 'neuromuscular_low', 'both_low'] as const) {
      const adjustment = adjustmentFor(state, ruleset);
      expect(adjustment.jumpVolumeFactor).toBeLessThanOrEqual(1);
      expect(adjustment.loadFactor).toBeLessThanOrEqual(1);
      expect(adjustment.extraReps).toBeGreaterThanOrEqual(0);
    }
    const outcome = scoreReadiness(
      climbing.readiness,
      { date: START, score: 28, band: 'low' },
      { id: 't', date: START, kind: 'seated_mb_throw', attempts: [7.1], best: 7.1, unit: 'm' },
      priors(START),
      ruleset,
    );
    expect(outcome.channels[0].name).toBe('autonomic');
    expect(outcome.channels[1].name).toBe('neuromuscular');
    expect(outcome.state).toBe('autonomic_low');
  });

  it('a missing recovery score adjusts on the neuromuscular channel alone', () => {
    const low = scoreReadiness(
      climbing.readiness,
      null,
      { id: 't', date: START, kind: 'seated_mb_throw', attempts: [6.2], best: 6.2, unit: 'm' },
      priors(START),
      ruleset,
    );
    expect(low.state).toBe('neuromuscular_low');
    const missing = scoreReadiness(
      climbing.readiness,
      { date: START, score: 28, band: 'low' },
      null,
      [],
      ruleset,
    );
    expect(missing.state).toBe('unknown');
    expect(missing.adjustment.tierDown).toBe(false);
  });

  it('each state reaches today only, with its own line and suffix', () => {
    const athlete = climber();
    const jumpDate = jumpDateFor(athlete, 7);
    for (const state of ['both_high', 'autonomic_low', 'neuromuscular_low', 'both_low'] as const) {
      const week = buildWeek(athlete, 7, {
        history: { readinessToday: channels(state, jumpDate) },
        today: jumpDate,
      });
      const today = week.sessions.find((session) => session.date === jumpDate);
      if (today === undefined) throw new Error('no jump session');
      expect(today.readiness?.state).toBe(state);
      expect(today.notices.some((line) => line.startsWith('Readiness:'))).toBe(true);
      for (const other of week.sessions) {
        if (other.date === jumpDate) continue;
        expect(other.readiness, `${state} bled onto ${other.date}`).toBeUndefined();
      }
      if (state === 'neuromuscular_low' || state === 'both_low') {
        expect(today.headerSuffixes).toContain('· Readiness: one tier down');
        expect(today.trimmed.some((entry) => entry.reason.startsWith('Readiness low'))).toBe(true);
        for (const row of rowsOf(today)) {
          expect(byId.get(row.exerciseId)?.plyometric?.isMaximalJump ?? false, row.exerciseId).toBe(
            false,
          );
        }
      }
      if (state === 'autonomic_low') {
        expect(today.headerSuffixes).toContain('· Readiness: volume held');
        expect(today.trimmed).toEqual([]);
      }
    }
  });

  it('holding the volume takes exactly one R89 step off the target', () => {
    const athlete = climber();
    const raw = planSkeleton(athlete, START, ruleset);
    const skeleton = { ...raw, weeks: raw.weeks.map((week) => ({ ...week, k: 6 })) };
    const jump = skeleton.weeks[6]?.sessions.find((session) => session.dayType === 'power_speed');
    if (jump === undefined) throw new Error('no jump day in week 7');
    const run = (state: ReadinessState): number => {
      const context: MaterializeContext = {
        athlete,
        ruleset,
        exercises: seed.exercises,
        ladders: seed.ladders,
        skeleton,
        w: 7,
        workingMaxes: athlete.workingMaxes,
        history: { ...freshHistory(), readinessToday: channels(state, jump.date) },
        today: jump.date,
        seed: 42,
      };
      const week = materializeWeek(context);
      return (
        week.sessions.find((session) => session.date === jump.date)?.contacts.targetExtensive ?? 0
      );
    };
    expect(run('both_high') - run('autonomic_low')).toBe(ruleset.constants.r89.extensiveStepPerWeek);
  });

  it('a hand-edited adjustment that tries to raise still cannot', () => {
    const athlete = climber();
    const jumpDate = jumpDateFor(athlete, 7);
    const week = buildWeek(athlete, 7, { today: jumpDate });
    const session = week.sessions.find((entry) => entry.date === jumpDate);
    if (session === undefined) throw new Error('no jump session');
    const base = scoreReadiness(
      climbing.readiness,
      { date: jumpDate, score: 28, band: 'low' },
      { id: 't', date: jumpDate, kind: 'seated_mb_throw', attempts: [6.2], best: 6.2, unit: 'm' },
      priors(jumpDate),
      ruleset,
    );
    const hostile = {
      ...base,
      adjustment: {
        ...base.adjustment,
        removeMaximalJumps: false,
        jumpVolumeFactor: 3,
        loadFactor: 2.5,
        extraReps: -4,
      },
    };
    const out = applyReadinessAdjustment(session, hostile, { exercisesById: byId, stepLb: 5 });
    session.blocks.forEach((block, blockIndex) => {
      block.exercises.forEach((row, rowIndex) => {
        const after = out.blocks[blockIndex]?.exercises[rowIndex];
        if (after === undefined) return;
        row.sets.forEach((set, setIndex) => {
          const next = after.sets[setIndex];
          if (next === undefined) return;
          if (set.reps !== undefined && next.reps !== undefined) {
            expect(next.reps, row.exerciseId).toBeLessThanOrEqual(set.reps);
          }
          if (set.loadKg !== undefined && next.loadKg !== undefined) {
            expect(next.loadKg, row.exerciseId).toBeLessThanOrEqual(set.loadKg);
          }
        });
      });
    });
    expect(applyReadinessAdjustment(out, hostile, { exercisesById: byId })).toBe(out);
  });

  it('every reduced set keeps its unreduced twin, so the answer can be undone', () => {
    const athlete = climber();
    const jumpDate = jumpDateFor(athlete, 7);
    const week = buildWeek(athlete, 7, {
      history: { readinessToday: channels('both_low', jumpDate) },
      today: jumpDate,
    });
    const today = week.sessions.find((session) => session.date === jumpDate);
    if (today === undefined) throw new Error('no jump session');
    let twins = 0;
    for (const row of rowsOf(today)) {
      for (const set of row.sets) {
        if (set.original === undefined) continue;
        twins += 1;
        expect(set.original.original).toBeUndefined();
      }
    }
    expect(twins).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------- 13. the swappable test kind */

describe('spec: the readiness test is configuration, not a constant', () => {
  function config(kind: ReadinessTestConfig['kind']): ReadinessTestConfig {
    return {
      ...climbing.readiness,
      kind,
      metric: kind === 'cmj' ? 'height_in' : kind === 'rsi' ? 'rsi' : 'distance_m',
    };
  }

  it('the default is the seated throw, best of three, 7-test median, 5 percent', () => {
    expect(climbing.readiness).toMatchObject({
      kind: 'seated_mb_throw',
      metric: 'distance_m',
      attempts: 3,
      baselineWindow: 7,
      lowThresholdPct: 5,
      whoopLowScore: 40,
    });
  });

  it('the gate scores a CMJ and an RSI configuration the same way', () => {
    for (const kind of ['cmj', 'rsi'] as const) {
      const current = config(kind);
      const history: ReadinessTestSession[] = [1, 2, 3, 4].map((index) => ({
        id: `p${index}`,
        date: addDays(START, -7 * index),
        kind,
        attempts: [10],
        best: 10,
        unit: kind === 'cmj' ? 'in' : 'RSI',
      }));
      const high = scoreReadiness(
        current,
        { date: START, score: 72, band: 'high' },
        { id: 't', date: START, kind, attempts: [9.8], best: 9.8, unit: 'x' },
        history,
        ruleset,
      );
      expect(high.state).toBe('both_high');
      const low = scoreReadiness(
        current,
        { date: START, score: 72, band: 'high' },
        { id: 't', date: START, kind, attempts: [8], best: 8, unit: 'x' },
        history,
        ruleset,
      );
      expect(low.state).toBe('neuromuscular_low');
      expect(low.line).toContain(kind === 'cmj' ? 'jump' : 'RSI');
    }
  });

  it('the configured test is the only selectable one, so the swap is real', () => {
    const cmj = byId.get('cmj_test');
    const throwRow = byId.get('seated_med_ball_throw');
    if (cmj === undefined || throwRow === undefined) throw new Error('seed is missing a test row');
    const throwAthlete = climber({ readinessConfig: config('seated_mb_throw') });
    const cmjAthlete = climber({ readinessConfig: config('cmj') });
    expect(readinessTestMatches(throwRow, throwAthlete)).toBe(true);
    expect(readinessTestMatches(cmj, throwAthlete)).toBe(false);
    expect(readinessTestMatches(cmj, cmjAthlete)).toBe(true);
    expect(readinessTestMatches(throwRow, cmjAthlete)).toBe(false);
    // With nothing configured the ruleset's own default decides, so the row
    // the athlete performs and the channel the gate scores are one test.
    const unset = climber({});
    delete unset.readinessConfig;
    expect(readinessTestMatches(throwRow, unset, ruleset)).toBe(true);
    expect(readinessTestMatches(cmj, unset, ruleset)).toBe(false);
  });

  it('prescribes a row for every one of the three settings, on the upper day', () => {
    // Spec: "the neuromuscular test configured in Settings (default seated med
    // ball throw distance, 3 attempts, best of 3; alternatives CMJ height or
    // RSI)" and "Test config is swappable, not hardcoded." All three now
    // resolve to a prescribed row, and the row is the upper-power day's
    // primer in each case. The two alternatives are their own check
    // protocols, three attempts at moderate CNS: the maximal `cmj_test` stays
    // out of every primer, because a high-CNS primer would spend the day's
    // two-row CNS budget (R42, R44) before the pull-up and the explosive pull
    // are placed.
    function rowsCarryingTheTest(kind: ReadinessTestConfig['kind']): string[] {
      const athlete = climber({ readinessConfig: config(kind) });
      return buildWeek(athlete, 1)
        .sessions.filter((session) => session.sessionIntent === 'upper_power')
        .flatMap((session) => rowsOf(session).map((row) => row.exerciseId))
        .filter((id) => byId.get(id)?.readinessTest?.kind === kind);
    }
    expect(rowsCarryingTheTest('seated_mb_throw')).toEqual(['seated_med_ball_throw']);
    expect(rowsCarryingTheTest('cmj')).toEqual(['cmj_readiness_check']);
    expect(rowsCarryingTheTest('rsi')).toEqual(['rsi_hop_check']);
    expect(
      seed.exercises.filter((exercise) => exercise.readinessTest?.kind === 'rsi').length,
    ).toBe(1);
    // The upper day still carries its main pull and its velocity pull, so the
    // swap never costs the athlete the work the day exists for.
    for (const kind of ['seated_mb_throw', 'cmj', 'rsi'] as const) {
      const athlete = climber({ readinessConfig: config(kind) });
      for (const session of buildWeek(athlete, 1).sessions) {
        if (session.sessionIntent !== 'upper_power') continue;
        const ids = rowsOf(session).map((row) => row.exerciseId);
        expect(ids, kind).toContain('weighted_pull_up');
        expect(ids.some((id) => byId.get(id)?.intent === 'velocity'), kind).toBe(true);
        const highCns = rowsOf(session).filter(
          (row) => byId.get(row.exerciseId)?.cnsCost === 'high',
        );
        expect(highCns.length, kind).toBeLessThanOrEqual(2);
      }
    }
  });
});

/* --------------------------------------------- 14. asymmetry is never a PR */

describe('spec: single-leg asymmetry is never canonical and never a PR', () => {
  it('the single-leg tests live outside the canonical jump stream', () => {
    const fixture = buildClimberFixture();
    expect(fixture.singleLegTests.length).toBe(CLIMBER_SINGLE_LEG_TESTS.length);
    const singleLegDates = new Set(fixture.singleLegTests.map((test) => test.date));
    for (const test of fixture.tests) {
      expect(test.canonical).toBe(true);
      expect(singleLegDates.has(test.date), test.date).toBe(false);
    }
    const canonicalHeights = fixture.tests.flatMap((test) =>
      test.reps.map((rep) => Number(mmToIn(rep.heightMm).toFixed(1))),
    );
    for (const test of fixture.singleLegTests) {
      expect(canonicalHeights, `${test.leftIn} in`).not.toContain(test.leftIn);
      expect(canonicalHeights, `${test.rightIn} in`).not.toContain(test.rightIn);
    }
  });

  it('the asymmetry section appears at the second test and never before', () => {
    const tests = climberSingleLegTests(climbing.asymmetryBandPct);
    expect(asymmetryTrend(tests.slice(0, 1))).toBeNull();
    const trend = asymmetryTrend(tests);
    expect(trend).not.toBeNull();
    expect(trend?.tests).toBe(2);
    expect(trend?.direction).toBe('narrowing');
  });

  it('the gap decides which leg goes first and nothing else', () => {
    const fixture = buildClimberFixture();
    expect(fixture.weakerSide).toBe('left');
    expect(fixture.athlete.weakerSide).toBe('left');
  });
});

/* --------------------------------------- 15. the week the house rules claim */

describe('spec: one jump session and one upper-power session a week', () => {
  it('every non-peak week has both, on four and on five days', () => {
    for (const weekdays of [FOUR_DAY, FIVE_DAY]) {
      for (const week of allWeeks(climberOnDays(weekdays))) {
        if (week.kind === 'peak') continue;
        const jump = week.sessions.filter((session) =>
          session.blocks.some((block) => block.name === 'power' || block.name === 'jump_test'),
        );
        const upper = week.sessions.filter((session) => session.sessionIntent === 'upper_power');
        expect(jump.length, `w${week.w}`).toBeGreaterThanOrEqual(1);
        expect(upper.length, `w${week.w}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('the applied house rules are reported on the week, in ruleset order', () => {
    const ids = buildWeek(climber(), 7).houseRuleIds ?? [];
    for (const id of [
      'house.sc.sport_requirements',
      'house.sc.upper_power_day',
      'house.sc.open_hand_grip',
      'house.sc.hard_finger_spacing',
      'house.sc.finger_pain_ceiling',
      'house.sc.rnt_valgus_control',
      'house.sc.weaker_side_first',
      'house.sc.box_squat_main_lift',
      'house.sc.readiness_gate',
      'house.sc.asymmetry_tracking',
    ]) {
      expect(ids, id).toContain(id);
    }
    const order = ruleset.houseRules.map((rule) => rule.id);
    const positions = ids.map((id) => order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('no other sport gains any of it', () => {
    for (const sport of ['basketball', 'football', 'soccer', 'track_field'] as const) {
      const athlete = climber({ sport, fingerHistory: false, gripMode: 'any', weakerSide: null });
      delete athlete.valgusControl;
      delete athlete.wallWork;
      delete athlete.readinessConfig;
      delete athlete.fingerPainCeiling;
      const week = buildWeek(athlete, 7);
      expect(week.houseRuleIds, sport).toBeUndefined();
      for (const session of week.sessions) {
        expect(session.sessionIntent, sport).toBeUndefined();
        expect(session.readiness, sport).toBeUndefined();
        for (const row of rowsOf(session)) {
          expect(row.sideNote, `${sport} ${row.exerciseId}`).toBeUndefined();
          expect(row.fingerNote, `${sport} ${row.exerciseId}`).toBeUndefined();
        }
      }
    }
  });
});
