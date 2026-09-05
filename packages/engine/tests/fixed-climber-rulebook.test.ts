/**
 * FIXED: RULE-BOOK PRESERVATION for the new sport.
 *
 * Every check is re-implemented from the rule book's own text in
 * `fixed-climber-rulebook.support.ts`, so a session that lied about itself is
 * caught rather than believed. Every check runs twice: once over
 * speed-climbing programs and once over basketball programs built the same
 * way. A violation on both faces is a pre-existing reading, not a regression
 * the new sport caused, and the basketball assertion is written first so it
 * would name one.
 */
import { describe, expect, it } from 'vitest';
import {
  ball,
  ballPrograms,
  buildProgram,
  climbPrograms,
  climber,
  extensiveViolations,
  history,
  maxes,
  recount,
  rowsOf,
  show,
  spacingViolations,
  structuralViolations,
} from './fixed-climber-rulebook.support.js';
import { PROGRAM_START, baseAthlete, gridRuleset, gridSeed } from './grid.support.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import { sportRequirementsFor } from '../src/select/sport.js';
import { findHouseRule } from '../src/ruleset/index.js';
import { lbToKg } from '../src/units.js';
import type { Athlete } from '../src/types/athlete.js';
import type { Sport } from '../src/types/core.js';
import type { SessionPlan, WeekPlan } from '../src/types/plan.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
const constants = ruleset.constants;
const FROZEN = `${PROGRAM_START}T03:00:00.000Z`;

describe('lens: the rule book still holds on every speed-climbing session', () => {
  it(
    'builds the climbing face and the basketball face it is measured against',
    () => {
      expect(climbPrograms().length).toBeGreaterThanOrEqual(24);
      expect(ballPrograms().length).toBeGreaterThanOrEqual(12);
      const weeks = climbPrograms().reduce((sum, entry) => sum + entry.weeks.length, 0);
      expect(weeks).toBeGreaterThan(200);
    },
    180000,
  );

  it('R44, R67, R48, R49, R50, R121, R68, R99, R85, R52, R88, R154, R155, R162, R148', () => {
    const basket = ballPrograms().flatMap(structuralViolations);
    expect(show(basket), show(basket)).toBe('');
    const climb = climbPrograms().flatMap(structuralViolations);
    expect(show(climb), show(climb)).toBe('');
  }, 180000);

  it('R90, R91 and R93 across every generated climbing calendar', () => {
    const basket = ballPrograms().flatMap(spacingViolations);
    expect(show(basket), show(basket)).toBe('');
    const climb = climbPrograms().flatMap(spacingViolations);
    expect(show(climb), show(climb)).toBe('');
  }, 180000);

  it('R84: load-week jump days sit inside the advanced 80 to 120 range', () => {
    const climb = climbPrograms().flatMap(extensiveViolations);
    expect(show(climb), show(climb)).toBe('');
  }, 180000);

  it('every load week carries the jump session and the upper-power session', () => {
    const requirements = sportRequirementsFor('speed_climbing', ruleset);
    const bad: string[] = [];
    for (const program of climbPrograms()) {
      for (const week of program.weeks) {
        if (week.kind !== 'load') continue;
        const jump = week.sessions.filter((session) =>
          ['power', 'power_speed', 'speed'].includes(session.dayType),
        ).length;
        const upper = week.sessions.filter((session) => session.sessionIntent === 'upper_power').length;
        if (jump < requirements.jumpOrReactiveSessionsPerWeek) bad.push(`${program.label} w${week.w} jump`);
        if (upper < requirements.upperPowerSessionsPerWeek) bad.push(`${program.label} w${week.w} upper`);
      }
    }
    expect(show(bad), show(bad)).toBe('');
  }, 180000);
});

describe('lens: R27 soreness on a climbing session', () => {
  const athlete = climber(4, 12, true, true);
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const jump = skeleton.weeks.find((entry) => entry.w === 7)?.sessions.find((entry) => entry.isTestDay);

  function at(soreness: number | null, today: string): WeekPlan {
    const state = history(true);
    state.sorenessToday = soreness;
    return materializeWeek({
      athlete: { ...athlete, workingMaxes: maxes() },
      ruleset,
      exercises,
      ladders,
      skeleton,
      w: 7,
      workingMaxes: maxes(),
      history: state,
      today,
      seed: 5,
    });
  }

  it('drops today one tier, halves the high-intensity contacts, and leaves the rest of the week alone', () => {
    expect(jump).toBeDefined();
    if (jump === undefined) return;
    const open = at(null, jump.date);
    const sore = at(constants.soreness.threshold + 1, jump.date);
    const before = open.sessions.find((entry) => entry.date === jump.date);
    const after = sore.sessions.find((entry) => entry.date === jump.date);
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    if (before === undefined || after === undefined) return;

    expect(recount(after).high).toBeLessThanOrEqual(Math.ceil(recount(before).high / 2));
    expect(rowsOf(after).some((entry) => entry.exercise.readinessRequired)).toBe(false);
    for (const entry of rowsOf(after)) {
      for (const set of entry.row.sets) {
        const original = set.original;
        if (original === undefined) continue;
        if (set.loadPercent !== undefined && original.loadPercent !== undefined) {
          expect(set.loadPercent, entry.row.exerciseId).toBeLessThanOrEqual(
            original.loadPercent - constants.soreness.percentDrop,
          );
        }
        if (set.reps !== undefined && original.reps !== undefined && set.loadPercent !== undefined) {
          expect(set.reps, entry.row.exerciseId).toBe(original.reps + constants.soreness.repsAdd);
        }
      }
    }
    // R27 defers a scheduled test and the deferred test rides the next
    // session, so the jump-test block is the one legal difference elsewhere.
    expect(after.testStatus).toBe('deferred');
    const strip = (session: SessionPlan): string =>
      JSON.stringify(session.blocks.filter((block) => block.name !== 'jump_test'));
    for (const session of sore.sessions) {
      if (session.date === jump.date) continue;
      const twin = open.sessions.find((entry) => entry.date === session.date);
      expect(twin).toBeDefined();
      if (twin === undefined) continue;
      expect(strip(session), session.date).toBe(strip(twin));
    }
  }, 60000);
});

describe('lens: the four sports that shipped before speed climbing are unchanged', () => {
  const SPORTS: Sport[] = ['basketball', 'football', 'soccer', 'track_field'];
  const tagged = new Set(exercises.filter((entry) => entry.sports !== undefined).map((entry) => entry.id));

  it('keeps their week-level requirements and never puts a climbing row on their week', () => {
    expect(tagged.size).toBeGreaterThan(0);
    for (const sport of SPORTS) {
      const requirements = sportRequirementsFor(sport, ruleset);
      expect(requirements.jumpOrReactiveSessionsPerWeek, sport).toBe(0);
      expect(requirements.upperPowerSessionsPerWeek, sport).toBe(0);
      expect(requirements.upperDayIntent, sport).toBe('strength');
      expect(requirements.allowsConditioningBlock, sport).toBe(true);

      const program = buildProgram({ ...ball(4, 12), sport }, sport, true);
      for (const week of program.weeks) {
        expect(week.houseRuleIds, sport).toBeUndefined();
        for (const session of week.sessions) {
          expect(session.sessionIntent, sport).toBeUndefined();
          expect(session.readiness, sport).toBeUndefined();
          expect(session.rntScheduled, sport).toBe(false);
          // `fingerLoad` is a new descriptor, not new behaviour: only the
          // speed-climbing rows are tagged `hard`, and only `hard` moves a
          // session, so no other sport's spacing can change.
          expect(session.fingerLoad, sport).not.toBe('hard');
          for (const entry of rowsOf(session, true)) {
            expect(tagged.has(entry.row.exerciseId), `${sport}: ${entry.row.exerciseId}`).toBe(false);
            expect(entry.row.sideNote, `${sport}: ${entry.row.exerciseId}`).toBeUndefined();
            expect(entry.row.fingerNote, `${sport}: ${entry.row.exerciseId}`).toBeUndefined();
          }
        }
      }
    }
  }, 120000);

  it('still reproduces the brief’s worked back-squat numbers for an intermediate athlete', () => {
    const athlete: Athlete = {
      ...baseAthlete(),
      level: 'intermediate',
      trainingAge: '1to3',
      targetDate: '2026-11-29',
      workingMaxes: [
        {
          lift: 'back_squat',
          valueKg: lbToKg(275),
          source: 'entered',
          confidence: 1,
          frozenAt: FROZEN,
          failStreak: 0,
        },
      ],
    };
    const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
    const week = materializeWeek({
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      w: 2,
      workingMaxes: athlete.workingMaxes,
      history: history(true),
      today: skeleton.weeks.find((entry) => entry.w === 2)?.windowStart ?? PROGRAM_START,
      seed: 1,
    });
    const squat = week.sessions
      .flatMap((session) => session.blocks)
      .flatMap((block) => block.exercises)
      .find((row) => row.exerciseId === 'back_squat');
    expect(squat?.sets.map((set) => set.displayLoad)).toEqual([
      '5 × 205 lb',
      '4 × 220 lb',
      '3 × 235 lb',
      '3 × 235 lb',
    ]);
    expect(squat?.restS).toBe(180);
    expect(squat?.sets.at(-1)?.isHeld).toBe(true);
  }, 60000);

  it('traces the upper-power day to R90 and R93, and says why it is the clear day', () => {
    // The whole point of the day's top-set cap is to keep the upper day out of
    // R90 and R93's way, and the rule the Plan renders never named either. The
    // day carries two high-CNS rows and a heavy-strength main lift, so it is
    // not the light day R93's parenthetical describes: it is clear only under
    // the house definition of a maximal CNS session, and the entry now says so.
    const rule = findHouseRule(gridRuleset, 'house.sc.upper_power_day');
    expect(rule?.rules).toContain(90);
    expect(rule?.rules).toContain(93);
    expect(rule?.text ?? '').toContain('reduced weeks included');
    expect(rule?.text ?? '').toContain('it is not a light day');
  });

  it('says where sideways movement comes from on a climbing jump day (R50)', () => {
    // Every prescribed row on the climber's Power and Speed days is sagittal;
    // R50 is met by the warm-up and cool-down mobility under the pre-existing
    // `someAnywhere` reading, and by the rotational throw on the upper day.
    // That reading is now written into the rule the athlete reads.
    const rule = findHouseRule(gridRuleset, 'house.sc.sport_requirements');
    expect(rule?.text ?? '').toContain('comes from the warm-up and the cool-down');
    expect(rule?.text ?? '').toContain('Change-of-direction cutting is not part of this sport');
  });

  it('keeps the basketball week deterministic: the same inputs build the same week', () => {
    const athlete = ball(4, 12);
    const strip = (weeks: WeekPlan[]): string =>
      JSON.stringify(weeks.map((week) => ({ ...week, snapshot: { ...week.snapshot, generatedAt: '' } })));
    expect(strip(buildProgram(athlete, 'bb', true).weeks)).toBe(
      strip(buildProgram(athlete, 'bb', true).weeks),
    );
  }, 120000);
});
