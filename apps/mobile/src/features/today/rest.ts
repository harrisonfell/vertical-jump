import type { SetPrescription } from '@vert/engine';
import { isGroupedBlock } from './blocks';
import { climbPrescription } from './climbRows';
import { loadDelta } from './footer';
import type { TodayExercise } from './model';

/**
 * What the rest bar says while the athlete waits.
 *
 * The bar names the next set and its load so the bar is loaded during the rest
 * rather than after it. The delta is the whole reason the line exists: "4 × 220
 * lb (+15 lb)" is the difference between adding a plate and guessing.
 */

export interface NextSetInput {
  readonly next: SetPrescription | null;
  readonly previous: SetPrescription | null;
  /** The next exercise's name, when the rest ends this one. */
  readonly nextExerciseName?: string | null;
  /** True on a row counted in repetitions: "3 reps", never "3 × BW". */
  readonly repCounted?: boolean;
}

/** "next: set 3 · 3 × 235 lb (+15 lb)" or "next: Hurdle hop". */
export function nextSetLabel({
  next,
  previous,
  nextExerciseName = null,
  repCounted = false,
}: NextSetInput): string {
  if (next === null) {
    return nextExerciseName === null ? 'last set' : `next: ${nextExerciseName}`;
  }
  const index = next.isRamp ? `ramp set ${next.setNumber}` : `set ${next.setNumber}`;
  const delta = loadDelta(previous?.loadKg, next.loadKg);
  return `next: ${index} · ${climbPrescription(next, repCounted)}${delta}`;
}

/** Set rows read "set 3" or "ramp set 3"; the bar uses the same words. */
function setIndexLabel(set: SetPrescription): string {
  return set.isRamp ? `ramp set ${set.setNumber}` : `set ${set.setNumber}`;
}

export interface NextUpInput {
  /** Every loggable exercise, in the order the athlete meets them. */
  readonly exercises: readonly TodayExercise[];
  readonly isLogged: (exerciseId: string, setNumber: number) => boolean;
  /** The row that just went in, for the delta when the next set is the same lift. */
  readonly from: { readonly exerciseId: string; readonly set: SetPrescription } | null;
}

/**
 * What the bar should say, recomputed from the first undone row in the WHOLE
 * session rather than from the exercise that was just logged. Finishing a lift
 * with "Done as written" leaves nothing undone in it, and the bar has to name
 * the next thing the athlete walks to, not the set they already did.
 *
 * Warm-up and cool-down rows are skipped. They render as one grouped block
 * with a single control and no counted contacts, so they have no "set 1" for
 * a rest bar to point at: naming an unticked banded lateral walk after a set
 * of pogo hops sends the athlete back to the start of the session.
 */
export function nextUpLabel({ exercises, isLogged, from }: NextUpInput): string {
  for (const exercise of exercises) {
    if (isGroupedBlock(exercise.block)) continue;
    for (const set of exercise.sets) {
      if (isLogged(exercise.id, set.setNumber)) continue;
      if (from !== null && exercise.id === from.exerciseId) {
        return nextSetLabel({ next: set, previous: from.set, repCounted: exercise.repCounted });
      }
      const line = climbPrescription(set, exercise.repCounted);
      return `next: ${exercise.name} · ${setIndexLabel(set)} · ${line}`;
    }
  }
  return 'last set';
}

export interface LoggedRow {
  readonly sessionExerciseId: string;
  readonly setNumber: number;
  readonly completedAt: string;
}

/**
 * Whether the row being taken back is the one the running rest was started for.
 *
 * Undoing the most recent set ends the rest with it: a bar counting down to a
 * set that is no longer logged is a clock for nothing (D-36). Undoing an
 * earlier row leaves the clock alone, because the athlete is still resting
 * from the set they did do.
 */
export function isMostRecentLog(
  logs: readonly LoggedRow[],
  exerciseId: string,
  setNumber: number,
): boolean {
  let latest: LoggedRow | null = null;
  for (const log of logs) {
    if (latest === null || log.completedAt.localeCompare(latest.completedAt) > 0) latest = log;
  }
  return latest !== null && latest.sessionExerciseId === exerciseId && latest.setNumber === setNumber;
}

/**
 * The rest to start after a row is logged. One value for the whole exercise:
 * the longest applicable rule (R164), which the engine already resolved.
 */
export function restSecondsFor(exercise: TodayExercise, set: SetPrescription): number {
  return set.restS > 0 ? set.restS : exercise.restS;
}

const EMPTY_SET: SetPrescription = {
  setNumber: 1,
  displayLoad: '',
  restS: 0,
  restRule: '',
  isRamp: false,
  isHeld: false,
};

/**
 * A rest bar is a lifting affordance. Recovery and mobility days have loads to
 * hold rather than loads to add, so they never start one (brief section 05).
 */
export function restBarApplies(exercise: TodayExercise): boolean {
  if (exercise.loadType === 'mobility') return false;
  if (exercise.block === 'warm_up' || exercise.block === 'cool_down') return false;
  if (exercise.block === 'recovery') return false;
  return restSecondsFor(exercise, exercise.sets[0] ?? EMPTY_SET) > 0;
}
