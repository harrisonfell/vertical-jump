/**
 * The Block 6 row builders that carry no percent of a working max: a distance
 * run, a timed hold, a change-of-direction drill and a plain bodyweight set.
 *
 * They live beside the loaded ladder rather than inside it because none of
 * them reads a working max, a cap or a scheme step; each is one measurement
 * repeated across the set count, and each has its own notation (R159, R66).
 */
import type { Athlete } from '../types/athlete.js';
import type { Exercise } from '../types/exercise.js';
import type { LoadType } from '../types/core.js';
import type { LoadScheme } from '../types/ruleset.js';
import type { SetPrescription } from '../types/plan.js';
import {
  formatCuts,
  formatDistance,
  formatHold,
  formatRepsOnly,
  type LoadGrid,
} from '../units.js';
import type { PrescribeContext } from './context.js';
import { DEFAULT_BODYWEIGHT_REPS, holdSecondsFor } from './scheme.js';
import { formatUnloadedRow, vestLbFor } from './display.js';
import type { RestDecision } from './rest.js';

/** Everything one row builder needs, resolved once per exercise. */
export interface RowContext {
  exercise: Exercise;
  athlete: Athlete;
  ctx: PrescribeContext;
  loadType: LoadType;
  scheme: LoadScheme;
  setCount: number;
  rest: RestDecision;
  grid: LoadGrid;
  stepLb: number;
}

/** An empty row carrying only what every row shares: its number and its rest. */
export function baseRow(setNumber: number, rest: RestDecision): SetPrescription {
  return {
    setNumber,
    displayLoad: '',
    restS: rest.restS,
    restRule: rest.restRule,
    isRamp: false,
    isHeld: false,
  };
}

/**
 * The cuts one set of a change-of-direction drill contains, for the row's
 * second line: "2 cuts" on a 5-10-5 shuttle rep, "1 cut" on a cut and sprint.
 * Undefined on anything that is not a change-of-direction drill.
 */
export function cutsDetailFor(exercise: Exercise, reps: number): string | undefined {
  const perRep = exercise.codCutsPerRep;
  if (perRep === undefined || perRep <= 0) return undefined;
  return formatCuts(perRep * Math.max(1, reps));
}

/** R159 and the implementation checklist: a distance row shows distance only. */
export function distanceRows(context: RowContext): SetPrescription[] {
  const meters = context.exercise.sprintDistanceM ?? 0;
  // A distance row displays distance only (R159); it carries a rep count only
  // when the caller supplied one, so a change-of-direction drill's cuts stay
  // countable without putting a rep number on the runner row.
  const reps = context.ctx.repsPerSet;
  const cuts = cutsDetailFor(context.exercise, reps ?? 1);
  const rows: SetPrescription[] = [];
  for (let index = 0; index < context.setCount; index += 1) {
    const row = baseRow(index + 1, context.rest);
    row.distanceM = meters;
    if (reps !== undefined) row.reps = reps;
    row.displayLoad = formatDistance(meters);
    if (cuts !== undefined) row.detailLine = cuts;
    rows.push(row);
  }
  return rows;
}

/**
 * A change-of-direction drill counted in reps is a run, not a bodyweight lift,
 * so the row reads "1 rep" and the cuts ride the second line rather than
 * borrowing the "1 x BW" notation a loadable movement owns.
 */
export function codRows(context: RowContext): SetPrescription[] {
  const reps = context.ctx.repsPerSet ?? context.scheme.repDescent?.[0] ?? 1;
  const cuts = cutsDetailFor(context.exercise, reps);
  const rows: SetPrescription[] = [];
  for (let index = 0; index < context.setCount; index += 1) {
    const row = baseRow(index + 1, context.rest);
    row.reps = reps;
    row.displayLoad = formatRepsOnly(reps);
    if (cuts !== undefined) row.detailLine = cuts;
    rows.push(row);
  }
  return rows;
}

/** R66 and R161: the hold is constant within a session and rises week to week. */
export function holdRows(context: RowContext): SetPrescription[] {
  const tagged = context.exercise.holdSecondsRange;
  const range = tagged ? { bottom: tagged.minS, top: tagged.maxS } : context.scheme.holdSecondsRange;
  const seconds = holdSecondsFor(range, context.ctx.holdWeekIndex ?? context.ctx.k);
  const rows: SetPrescription[] = [];
  for (let index = 0; index < context.setCount; index += 1) {
    const row = baseRow(index + 1, context.rest);
    row.durationS = seconds;
    row.displayLoad = formatHold(seconds);
    rows.push(row);
  }
  return rows;
}

/** R159: a non-loadable row never carries a load or a percent. */
export function unloadedRows(context: RowContext, repsOverride?: number): SetPrescription[] {
  const fallback = context.scheme.repDescent?.[0] ?? DEFAULT_BODYWEIGHT_REPS;
  const reps = repsOverride ?? context.ctx.repsPerSet ?? fallback;
  const vest = vestLbFor(context.exercise, context.athlete);
  const rows: SetPrescription[] = [];
  for (let index = 0; index < context.setCount; index += 1) {
    const row = baseRow(index + 1, context.rest);
    row.reps = reps;
    row.displayLoad = formatUnloadedRow(reps, vest);
    rows.push(row);
  }
  return rows;
}
