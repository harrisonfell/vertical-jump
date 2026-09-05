/**
 * The shape of an ascending scheme before loads, caps or rounding:
 * percentages, the rep descent, the held-set rule, and the isometric hold.
 *
 * R150 to R153 pick the scheme, R155 holds the top set, R156 sets the start,
 * R157 adds the ramp sets, R161 descends the reps. Every number comes from the
 * ruleset, never from a literal in this file.
 */
import type { Level } from '../types/core.js';
import type { LoadScheme, Range, Ruleset } from '../types/ruleset.js';
import { clamp } from '../budgets.js';

/**
 * R66 gives the 30 to 45 s band but no step. Four rungs across the band is
 * the house reading, so a hold progresses 30, 35, 40, 45 and then holds.
 */
export const PREHAB_HOLD_STEP_S = 5;

/** Reps for a mobility or bodyweight row when the caller names none. */
export const DEFAULT_BODYWEIGHT_REPS = 8;

/**
 * The ascending percent ladder for a load type before caps and rounding:
 * start, start + step, start + 2 step, and so on, one entry per working set.
 */
export function ascendingPercents(startPct: number, stepPct: number, sets: number): number[] {
  if (!Number.isFinite(startPct)) throw new RangeError('startPct must be finite');
  if (!Number.isFinite(stepPct)) throw new RangeError('stepPct must be finite');
  if (!Number.isInteger(sets) || sets < 1) throw new RangeError('sets must be a positive integer');
  const out: number[] = [];
  for (let index = 0; index < sets; index += 1) out.push(startPct + stepPct * index);
  return out;
}

/**
 * R155: every step above the cap repeats the previous step, so the top set is
 * held rather than continuing to ascend. `heldFrom` is the index of the first
 * held set, or `percents.length` when nothing was held. The held sets repeat
 * the lowest rep value, which `repsForSets` produces independently (R161).
 */
export function applyTopSetCap(
  percents: number[],
  capPct: number,
): { percents: number[]; heldFrom: number } {
  const out: number[] = [];
  let heldFrom = percents.length;
  for (let index = 0; index < percents.length; index += 1) {
    const raw = percents[index];
    if (raw === undefined) continue;
    const previous = out[index - 1];
    let value: number;
    if (raw <= capPct) value = raw;
    else if (previous === undefined) value = capPct;
    else value = previous;
    out.push(value);
    if (value !== raw && heldFrom === percents.length) heldFrom = index;
  }
  return { percents: out, heldFrom };
}

/**
 * Every distinct step the scheme can reach for this athlete: the start, then
 * one step at a time while the value stays at or under the cap.
 */
export function distinctPercents(startPct: number, stepPct: number, capPct: number): number[] {
  const first = Math.min(startPct, capPct);
  if (stepPct <= 0) return [first];
  const out: number[] = [];
  for (let value = first; value <= capPct + 1e-9; value += stepPct) out.push(value);
  return out.length > 0 ? out : [first];
}

/**
 * R161: the first set takes the high end of the band, the last working set the
 * low end, and sets beyond the descent repeat the lowest value.
 */
export function repsForSets(descent: number[], sets: number): number[] {
  const first = descent[0];
  const last = descent[descent.length - 1];
  if (first === undefined || last === undefined) throw new RangeError('descent must not be empty');
  if (sets <= 1) return [first];
  if (sets < descent.length) return [...descent.slice(0, sets - 1), last];
  const out = [...descent];
  while (out.length < sets) out.push(last);
  return out;
}

/**
 * The peak session sharpens instead of holding: reps carry on descending one
 * per set from the descent's low end, never below the load type's rep floor.
 */
export function descendingRepsFrom(startReps: number, sets: number, floorReps: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < sets; index += 1) out.push(Math.max(floorReps, startReps - index));
  return out;
}

/** R66 with the house step: the hold rises 5 s per progressed week, then holds. */
export function holdSecondsFor(range: Range | undefined, k: number): number {
  const band = range ?? { bottom: 30, top: 45 };
  const steps = Math.max(0, Math.floor(k));
  return clamp(band.bottom + steps * PREHAB_HOLD_STEP_S, band.bottom, band.top);
}

/**
 * R158 with R76: set 1 RPE 6, set 2 RPE 7, set 3 RPE 8, later sets held at the
 * level cap. Week 1 of a first program is 6, 6.5, 7 with a hard cap of 7 for
 * every level, because R76 overrides R74 and R158 at every level.
 */
export function rpeForSet(
  setIndex: number,
  level: Level,
  isFirstProgramWeek1: boolean,
  ruleset: Ruleset,
): number {
  const constants = ruleset.constants;
  const ladder = isFirstProgramWeek1 ? constants.week1RpeLadder : constants.rpeLadder;
  const cap = isFirstProgramWeek1 ? constants.week1RpeCap : constants.rpeCap[level];
  const step = ladder[setIndex];
  return step === undefined ? cap : Math.min(step, cap);
}

/** R161: advanced may run 5/3/1; everyone else runs the default descent. */
export function descentFor(scheme: LoadScheme, level: Level, useFiveThreeOne: boolean): number[] {
  if (level === 'advanced' && useFiveThreeOne && scheme.repDescentAdvanced) {
    return scheme.repDescentAdvanced;
  }
  return scheme.repDescent ?? [1];
}
