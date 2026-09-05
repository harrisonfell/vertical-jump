/**
 * The Block 6 view of the week, plus the two small helpers the prescriber and
 * the materializer share. The fields themselves live on `WeekContext` in
 * `src/types/plan.ts`, so a plain `WeekContext` is assignable and the contract
 * signature `getPerSetPrescription(exercise, athlete, weekContext)` holds.
 */
import type { ExerciseRole } from '../types/core.js';
import type { WorkingMax } from '../types/athlete.js';
import type { Exercise } from '../types/exercise.js';
import type { WeekContext } from '../types/plan.js';

/**
 * The Block 6 view of the week. Every extra field the prescriber needs now
 * lives on `WeekContext` itself, so this alias is kept only so callers that
 * import `PrescribeContext` keep compiling.
 */
export type PrescribeContext = WeekContext;

/** A working max the engine may prescribe percentages from. */
export function hasWorkingMax(workingMax: WorkingMax | undefined): workingMax is WorkingMax {
  return workingMax !== undefined && Number.isFinite(workingMax.valueKg) && workingMax.valueKg > 0;
}

/** The rest category an exercise falls in when the caller names no role. */
export function defaultRole(exercise: Exercise): ExerciseRole {
  if (exercise.isMainLift) return 'main_lift';
  const first = exercise.roleCandidates[0];
  return first ?? 'accessory';
}
