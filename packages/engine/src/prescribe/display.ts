/**
 * Rounding and the display strings (R148, R159, R162).
 *
 * Barbells round to the nearest 5 lb, half up, falling back to the inventory's
 * plate increment when 5 lb is not loadable; dumbbells to the nearest available
 * increment with ties down; ballistic loads always down, because a jump squat
 * is never allowed to drift above its ceiling. Every string comes from the
 * formatters in `units.ts`, never from a template literal in a screen.
 */
import type { Athlete } from '../types/athlete.js';
import type { Exercise } from '../types/exercise.js';
import type { LoadType } from '../types/core.js';
import {
  TIMES,
  formatBodyweightSet,
  formatInteger,
  formatLoadedSet,
  kgToLb,
  lbToKg,
  roundHalfUp,
  roundLoadLb,
  type LoadGrid,
} from '../units.js';

/** The load grid an exercise is snapped to (R162 plus the ballistic override). */
export function gridFor(exercise: Exercise, loadType: LoadType): LoadGrid {
  if (loadType === 'ballistic') return 'ballistic';
  if (exercise.requiresBarbell) return 'barbell';
  if (exercise.equipment.includes('dumbbell') || exercise.equipment.includes('kettlebell')) {
    return 'dumbbell';
  }
  return 'barbell';
}

/**
 * The smallest jump the athlete can actually load: the dumbbell increment for
 * dumbbells, the smallest plate pair for a barbell when that pair is coarser
 * than 5 lb, and 5 lb otherwise.
 */
export function stepLbFor(athlete: Athlete, grid: LoadGrid): number {
  if (grid === 'dumbbell') {
    const increment = athlete.inventory.dumbbells?.incrementLb;
    return increment !== undefined && increment > 0 ? increment : 5;
  }
  const pair = athlete.inventory.plates.smallestPairLb;
  return Number.isFinite(pair) && pair > 5 ? pair : 5;
}

/**
 * Snap a load in pounds to the grid. The value is normalized to six decimals
 * first so a kilogram round trip cannot push a true 192.5 below the half-up
 * boundary and cost the athlete a 5 lb step.
 */
export function snapLoadLb(lb: number, grid: LoadGrid, stepLb: number): number {
  return roundLoadLb(roundHalfUp(lb, 6), grid, stepLb);
}

/** The load for one percent of a working max, snapped to the grid, in pounds. */
export function loadLbForPercent(
  workingMaxKg: number,
  percent: number,
  grid: LoadGrid,
  stepLb: number,
): number {
  return snapLoadLb((kgToLb(workingMaxKg) * percent) / 100, grid, stepLb);
}

/** Pounds back to the stored unit, so a row carries both. */
export function loadKgFromLb(lb: number): number {
  return lbToKg(lb);
}

/** An RPE reads as a whole number or one decimal, never "6.0". */
export function formatRpeValue(rpe: number): string {
  return Number.isInteger(rpe) ? `${rpe}` : `${roundHalfUp(rpe, 1)}`;
}

/**
 * RPE mode has no load to show, so the row states the effort and leaves the
 * load blank for the athlete to fill in: "5 reps / RPE 6 / __ lb".
 */
export function formatRpeRow(reps: number, rpe: number): string {
  return `${formatInteger(reps)} reps \u00b7 RPE ${formatRpeValue(rpe)} \u00b7 __ lb`;
}

/** R159: a non-loadable row shows reps only, plus a vest when one is worn. */
export function formatUnloadedRow(reps: number, addedLb: number | undefined): string {
  return formatBodyweightSet(reps, addedLb);
}

/** A loaded row: "5 x 205 lb" with the real multiplication sign. */
export function formatLoadedRow(reps: number, loadLb: number): string {
  return formatLoadedSet(reps, loadLb);
}

/**
 * Replace the leading rep count of a display string, so a soreness tier-down
 * keeps "BW + 20 lb vest" and the RPE tail intact.
 */
export function retitleReps(display: string, oldReps: number, newReps: number): string {
  const prefix = `${formatInteger(oldReps)} `;
  if (!display.startsWith(prefix)) return display;
  return `${formatInteger(newReps)} ${display.slice(prefix.length)}`;
}

/** The vest load an exercise carries, when the athlete owns one and it is tagged. */
export function vestLbFor(exercise: Exercise, athlete: Athlete): number | undefined {
  if (!exercise.equipment.includes('vest')) return undefined;
  const vest = athlete.inventory.vestLb;
  return vest !== undefined && vest > 0 ? vest : undefined;
}

/** Exported so a caller can build "3 x 3" style labels with the same sign. */
export const DISPLAY_TIMES = TIMES;
