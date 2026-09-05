/**
 * The weighted pull-up's per-set prescription (house rules
 * `house.sc.upper_power_day`, `house.sc.open_hand_grip`).
 *
 * A weighted pull-up is loadable, but only the ADDED load is prescribed: the
 * athlete's own bodyweight is not on the bar and is not on the 5 lb grid. So
 * the working max here is a max of added load, R73's Epley runs on added load
 * alone, and every row displays as "5 x BW + 45 lb" rather than as a single
 * number. Everything else is unchanged: it is a heavy-strength lift, so it
 * takes the 75 percent start, the +5 percent step, the rep descent, the level
 * top-set cap, the held-set rule, R162 rounding and the R164 rest.
 *
 * Because only the display differs, the whole Block 6 ladder is the one in
 * `getPerSetPrescription`: the ramp sets, the deload and taper shapes, the
 * peak shape, RPE mode and the soreness reduction all run unchanged and the
 * added-load pass rewrites the strings at the end. A cluster row is the same
 * scheme with a cue on the exercise, never a scheme of its own.
 */
import type { Athlete, WorkingMax } from '../types/athlete.js';
import type { IsoInstant } from '../types/calendar.js';
import type { LiftId } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { SetPrescription } from '../types/plan.js';
import type { Ruleset } from '../types/ruleset.js';
import { formatAddedLoadSet, kgToLb, roundHalfUp } from '../units.js';
import type { PrescribeContext } from './context.js';
import { getPerSetPrescription } from './index.js';
import { enteredMaxCandidate, snapWorkingMaxKg, type EnteredOneRm } from './workingMax.js';

/**
 * Rows whose load is added to bodyweight rather than being the whole load.
 *
 * The seed tags them with `addedLoad`. A row seeded before that field existed
 * falls back to the shape read off the tags that do exist: a loadable
 * vertical pull off a bar that is not a barbell lift. That is exactly the
 * weighted pull-up and its cluster variant, and it stays true for any
 * weighted chin-up seeded later, so no other sport's display can change.
 */
export function usesAddedLoad(exercise: Exercise): boolean {
  if (exercise.addedLoad !== undefined) return exercise.addedLoad;
  return (
    exercise.loadable &&
    !exercise.requiresBarbell &&
    exercise.movementPattern === 'pull_vertical' &&
    exercise.equipment.includes('pullup_bar')
  );
}

/** The added load one row carries, in pounds, or undefined in RPE mode. */
function addedLoadLbFor(set: SetPrescription): number | undefined {
  if (set.loadKg === undefined || set.reps === undefined) return undefined;
  // The row's kilograms came from a pound value snapped to the grid, so the
  // trip back is exact once the binary noise is normalized away.
  return roundHalfUp(kgToLb(set.loadKg), 6);
}

/**
 * Rewrite loaded rows to the added-load notation: "5 x BW + 45 lb", and
 * "5 x BW" when nothing is added. RPE rows, holds, distances and unloaded
 * rows are returned untouched, and a row reduced by soreness keeps its
 * unreduced `original` in the same notation.
 */
export function withAddedLoadDisplay(sets: SetPrescription[]): SetPrescription[] {
  return sets.map((set) => {
    const addedLb = addedLoadLbFor(set);
    if (addedLb === undefined || set.reps === undefined) return set;
    const next: SetPrescription = { ...set, displayLoad: formatAddedLoadSet(set.reps, addedLb) };
    if (set.original !== undefined) {
      const [original] = withAddedLoadDisplay([set.original]);
      if (original !== undefined) next.original = original;
    }
    return next;
  });
}

/**
 * Per-set rows for a weighted pull-up, in the same shape
 * `getPerSetPrescription` returns, so the runner renders them with no special
 * case. Calling `getPerSetPrescription` on a weighted pull-up returns exactly
 * this; the named entry point exists so a caller that knows it holds an
 * added-load lift can say so.
 *
 * The rules that bind, in Rule 0 order: Block 1 caps first, then the heavy
 * strength scheme from `constants.schemes.heavy_strength`, then the level top
 * set cap with held sets above it, then R162 rounding on the added load, then
 * the R164 rest. `loadKg` carries the added load only; `displayLoad` is
 * "5 x BW + 45 lb"; `loadPercent` is a percent of the added-load working max.
 *
 * @param exercise the weighted pull-up row, whose `gripMode` is `open_hand`
 *   and whose `fingerLoad` is `hard`.
 * @param athlete read for level, bodyweight and the inventory's load grid.
 * @param weekContext the same context Block 6 hands every other lift; its
 *   `workingMax` is a max of ADDED load, never of bodyweight plus added load.
 */
export function addedLoadPrescription(
  exercise: Exercise,
  athlete: Athlete,
  weekContext: PrescribeContext,
): SetPrescription[] {
  // Idempotent: `getPerSetPrescription` already ran the added-load pass for a
  // row `usesAddedLoad` recognizes, and rewriting a string it produced yields
  // the same string.
  return withAddedLoadDisplay(getPerSetPrescription(exercise, athlete, weekContext));
}

/**
 * The first freeze for an added-load lift when the athlete gave a load they
 * work near rather than a true 1RM (the owner's spec: "weighted pull-up,
 * working near 5RM load, estimate via Epley").
 *
 * R72 straight through at one rep; R73's Epley above it, carrying the house
 * 0.95 confidence factor because a rep-max entered from memory is an estimate
 * and not a tested single. The value is snapped to the same 5 lb grid every
 * percentage of it will be shown on, and it is the ADDED load: bodyweight is
 * never part of it.
 *
 * @param lift the lift id the max is stored under.
 * @param entered the added load and the reps it was for.
 * @param ruleset read for the confidence factor and the barbell step.
 * @param asOf the generation instant this value is frozen at.
 */
export function addedLoadFirstFreeze(
  lift: LiftId,
  entered: EnteredOneRm,
  ruleset: Ruleset,
  asOf: IsoInstant,
): WorkingMax {
  const candidate = enteredMaxCandidate(entered, ruleset);
  const stepLb = ruleset.constants.loadGrid.barbellStepLb;
  return {
    lift,
    valueKg: snapWorkingMaxKg(candidate.valueKg, 'barbell', stepLb),
    source: candidate.source,
    confidence: candidate.confidence,
    frozenAt: asOf,
    lastRaiseAt: asOf,
    failStreak: 0,
  };
}
