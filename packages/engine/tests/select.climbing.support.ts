/**
 * The speed-climbing selection sweep: the athlete, the four-case grid of day
 * counts and hangboards, and the first eight weeks of each.
 *
 * Split out of `select.climbing.test.ts` so both files stay under the 500-line
 * limit. Nothing here asserts.
 */
import { freshHistory } from './invariants.support.js';
import { evaluatePainGate } from '../src/select/painGate.js';
import { mulberry32 } from '../src/prng.js';
import type { SelectContext } from '../src/select/assemble.js';
import { FULL_INVENTORY, PROGRAM_START, WEEKDAYS, baseAthlete } from './grid.support.js';
import { gridRuleset, gridSeed } from './grid.seed.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import type { Athlete } from '../src/types/athlete.js';
import type { DaysPerWeek } from '../src/types/core.js';
import type { Exercise } from '../src/types/exercise.js';
import type { MaterializeContext, SessionPlan, WeekPlan } from '../src/types/plan.js';
import type { Ruleset } from '../src/types/ruleset.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;
const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));

export function climber(daysPerWeek: DaysPerWeek, hangboard: boolean): Athlete {
  return {
    ...baseAthlete(),
    sport: 'speed_climbing',
    secondaryGoal: 'speed',
    trainingAge: '4plus',
    level: 'advanced',
    daysPerWeek,
    weekdays: WEEKDAYS[daysPerWeek],
    inventory: { ...FULL_INVENTORY, hangboard, boxSquatBox: true, climbingWall: true },
    fingerHistory: true,
    gripMode: 'open_hand',
    fingerPainCeiling: 3,
    wallWork: {
      weekdays: [0, 2, 4],
      typicalStart: '18:00',
      typicalEnd: '20:00',
      fingerLoad: 'hard',
      sameDayGapHours: 6,
    },
    sessionWindow: { start: '08:00', end: '10:00' },
    valgusControl: { required: true, sessionsPerWeek: 2, minHoursFromWall: 6 },
    weakerSide: 'left',
    targetDate: '2026-11-29',
  };
}

/** Every displayed row of a session, with its seeded exercise. */
export function rowsOf(session: SessionPlan): { block: string; row: Exercise }[] {
  const out: { block: string; row: Exercise }[] = [];
  for (const block of session.blocks) {
    if (block.name === 'warm_up' || block.name === 'cool_down') continue;
    for (const row of block.exercises) {
      const exercise = byId.get(row.exerciseId);
      if (exercise !== undefined) out.push({ block: block.name, row: exercise });
    }
  }
  return out;
}

/** Weeks 1 to `count` for one athlete, so both blocks are covered. */
export function weeksFor(athlete: Athlete, count: number): WeekPlan[] {
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const out: WeekPlan[] = [];
  for (let w = 1; w <= Math.min(count, skeleton.W); w += 1) {
    const context: MaterializeContext = {
      athlete,
      ruleset,
      exercises,
      ladders,
      skeleton,
      w,
      workingMaxes: [],
      history: freshHistory(),
      today: skeleton.weeks.find((entry) => entry.w === w)?.windowStart ?? PROGRAM_START,
      seed: 11,
    };
    out.push(materializeWeek(context));
  }
  return out;
}

/** The grid the brief asks for: 4 and 5 days, with and without a hangboard. */
export const GRID: { label: string; athlete: Athlete }[] = [
  { label: '4d hangboard', athlete: climber(4, true) },
  { label: '4d no hangboard', athlete: climber(4, false) },
  { label: '5d hangboard', athlete: climber(5, true) },
  { label: '5d no hangboard', athlete: climber(5, false) },
];

/** Every load week of the first eight, which spans the Strength and Power blocks. */
export function sweep(): { label: string; week: WeekPlan; athlete: Athlete }[] {
  const out: { label: string; week: WeekPlan; athlete: Athlete }[] = [];
  for (const entry of GRID) {
    for (const week of weeksFor(entry.athlete, 8)) {
      out.push({ label: `${entry.label} w${week.w}`, week, athlete: entry.athlete });
    }
  }
  return out;
}

export const SWEEP = sweep();

/** The three day types the Power family covers (R135, R136). */
export const POWER_DAY_TYPES = new Set(['power_speed', 'power', 'speed']);

/**
 * The orchestrator's correction of 5 Sep 2026, as a violation list: R112
 * (vertical jump) is the primary goal and R113 (speed) the secondary, so on
 * the four-day week's Power day the weekly test and one maximal jump spend
 * R44's two high-CNS rows and the acceleration fills in behind them as a
 * moderate-CNS row, inside the contact caps. A sprint row is preferred, never
 * mandatory: it is dropped with a trimmed reason before the maximal jump is.
 */
export function goalPriorityAudit(ruleset: Ruleset): string[] {
  const bad: string[] = [];
  for (const entry of SWEEP) {
    if (entry.week.kind !== 'load' || entry.athlete.daysPerWeek !== 4) continue;
    for (const session of entry.week.sessions) {
      if (session.dayType !== 'power_speed') continue;
      const rows = rowsOf(session);
      const at = `${entry.label} ${session.dayType}`;
      const power = rows.filter(({ block }) => block === 'power');
      const maximal = power.filter(({ row }) => row.plyometric?.isMaximalJump === true);
      const accelerations = power.filter(
        ({ row }) =>
          row.movementPattern === 'sprint' &&
          row.loadType !== 'mobility' &&
          (row.sprintDistanceM ?? 0) <= 30,
      );
      const highCns = rows.filter(({ row }) => row.cnsCost === 'high').length;
      if (!session.isTestDay) bad.push(`${at}: not the test day`);
      if (maximal.length !== 1) bad.push(`${at}: ${maximal.length} maximal jumps`);
      if (accelerations.length < 1) bad.push(`${at}: no acceleration row`);
      if (highCns > ruleset.constants.maxHighCnsPerSession) bad.push(`${at} R44: ${highCns}`);
      if (session.contacts.highIntensity > 25) bad.push(`${at} R85: ${session.contacts.highIntensity}`);
      if (session.contacts.highAmplitude > 20) bad.push(`${at} R52: ${session.contacts.highAmplitude}`);
      for (const cut of session.trimmed) {
        if (byId.get(cut.exerciseId)?.plyometric?.isMaximalJump !== true) continue;
        bad.push(`${at}: trimmed the maximal jump ${cut.exerciseId}`);
      }
    }
  }
  return bad;
}

/**
 * One climber Power + Speed day as a selection context, with one exercise held
 * out of the pool so a slot has to fall back on its next candidate.
 */
export function climberPowerContext(without: string): SelectContext {
  const athlete = climber(4, true);
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const week = skeleton.weeks[1];
  const session = week?.sessions.find((entry) => entry.dayType === 'power_speed');
  if (week === undefined || session === undefined) throw new RangeError('no Power day in week 2');
  return {
    athlete,
    ruleset,
    exercises: exercises.filter((exercise) => exercise.id !== without),
    ladders,
    week,
    session,
    painGate: evaluatePainGate(
      { clearance: athlete.clearance, painStatus: [], isAdult: true, today: PROGRAM_START },
      ruleset,
    ),
    rotationHistory: {},
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    prng: mulberry32(11),
  };
}
