import type { SetPrescription } from '@vert/engine';
import { formatHold, TIMES } from '@vert/engine/units';
import type { SetRowKind } from '@/ui';

/**
 * One prescription, turned into the four things a set row draws: its index,
 * its prescription line, its kind, and the muted second line.
 *
 * Everything here is pure and every number arrives already formatted by the
 * engine: `displayLoad` is the engine's own notation and is never rebuilt.
 */

export interface LoggedSet {
  readonly setNumber: number;
  readonly repsDone: number | null;
  readonly durationS: number | null;
  readonly loadKg: number | null;
  readonly rpe: number | null;
}

/** "R1" for a ramp set, otherwise the set number (brief section 07). */
export function rowIndex(set: SetPrescription): string {
  return set.isRamp ? `R${set.setNumber}` : String(set.setNumber);
}

/**
 * Which row variant to draw. A row with a target RPE and no prescribed load is
 * the one place the athlete types a weight; a duration row counts down in
 * place; a distance row is a run, not a lift.
 */
export function rowKind(set: SetPrescription, loadMode: string): SetRowKind {
  if (set.durationS !== undefined) return 'timed';
  if (set.distanceM !== undefined) return 'distance';
  if (set.targetRpe !== undefined && set.loadKg === undefined) return 'rpe';
  if (loadMode === 'rpe' || loadMode === 'week1') {
    return set.loadKg === undefined ? 'rpe' : 'loadable';
  }
  if (set.loadKg === undefined) return 'bodyweight';
  return 'loadable';
}

export interface DetailInput {
  readonly set: SetPrescription;
  readonly bothSides: boolean;
  readonly log?: LoggedSet | null;
  /** The whole row's own qualifier, the same on every set: "6 lb ball". */
  readonly note?: string | null;
}

/**
 * The muted 14 px line under the prescription, so no row overflows: "2 cuts",
 * "6 lb ball", "each side", "ramp", "was 5 × 235 lb", "did 4", "held 25 s",
 * "done".
 */
export function rowDetail({
  set,
  bothSides,
  log = null,
  note = null,
}: DetailInput): string | undefined {
  const parts: string[] = [];

  // The engine's own qualifier for the row: "2 cuts" on a change-of-direction
  // rep, which is what makes "1 rep" a shuttle rather than a bodyweight set.
  if (set.detailLine !== undefined && set.detailLine !== '') parts.push(set.detailLine);
  // What the athlete is actually throwing, which the reps alone cannot say.
  if (note !== null && note !== '') parts.push(note);
  if (bothSides) parts.push('each side');
  if (set.isRamp) parts.push('ramp');
  if (set.isHeld) parts.push('held at the cap');
  if (set.original !== undefined) parts.push(`was ${set.original.displayLoad}`);

  if (log !== null) {
    if (log.durationS !== null && set.durationS !== undefined && log.durationS < set.durationS) {
      parts.push(`held ${formatHold(log.durationS)}`);
    } else if (log.repsDone !== null && set.reps !== undefined && log.repsDone !== set.reps) {
      parts.push(`did ${log.repsDone}`);
    } else {
      parts.push('done');
    }
    if (log.rpe !== null) parts.push(`RPE ${log.rpe}`);
  }

  return parts.length === 0 ? undefined : parts.join(' · ');
}

/**
 * The prescription line. It is the engine's `displayLoad` unless a logged load
 * disagrees with it, which happens in RPE mode, where what the athlete lifted
 * is the fact and the blank is only a prompt.
 */
export function rowPrescription(set: SetPrescription, log: LoggedSet | null, loadLb: number | null): string {
  if (log === null || loadLb === null) return set.displayLoad;
  if (set.loadKg !== undefined) return set.displayLoad;
  if (set.reps === undefined) return set.displayLoad;
  return `${set.reps} ${TIMES} ${loadLb} lb`;
}

/** Which set the athlete meets next: the first row of this exercise with no log. */
export function nextUnloggedSet(
  sets: readonly SetPrescription[],
  logged: ReadonlySet<number>,
): SetPrescription | null {
  for (const set of sets) {
    if (!logged.has(set.setNumber)) return set;
  }
  return null;
}

/** True once every prescribed row of an exercise has been written. */
export function exerciseComplete(
  sets: readonly SetPrescription[],
  logged: ReadonlySet<number>,
): boolean {
  return sets.length > 0 && sets.every((set) => logged.has(set.setNumber));
}

/** "done 5/5", the line an exercise folds to. */
export function doneLabel(sets: readonly SetPrescription[], logged: ReadonlySet<number>): string {
  const count = sets.filter((set) => logged.has(set.setNumber)).length;
  return `done ${count}/${sets.length}`;
}
