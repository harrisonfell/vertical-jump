import type { Exercise, SetPrescription } from '@vert/engine';
import { formatLoadLb, formatRepsOnly } from '@vert/engine/units';

/**
 * How the upper power day draws (house rule `house.sc.upper_power_day`).
 *
 * Four row shapes the strength days never needed. A weighted pull-up shows the
 * added load and nothing else, which is already the engine's own notation. A
 * throw and an overspeed pull are counted in repetitions, not in bodyweight:
 * "3 reps", the way a shuttle reads "1 rep", because nobody is lifting their
 * bodyweight when they push a ball. The band knee-alignment row says what ends
 * the set, and a unilateral row says which leg goes first.
 *
 * Everything here is pure and reads the seeded exercise, so a row's shape is
 * decided by its tags rather than by its name.
 */

/** House `house.sc.rnt_valgus_control`: alignment ends the set, not a rep count. */
export const RNT_CAPTION = 'Alignment: stop the set when the knee drifts';

/** True for the band knee-alignment rows the injury-prevention block carries. */
export function isRntRow(exercise: Exercise | undefined): boolean {
  return exercise?.isRnt === true || exercise?.valgusProtocol !== undefined;
}

/** True when the row is thrown, pushed or pulled rather than loaded by weight. */
export function usesMedBall(exercise: Exercise | undefined): boolean {
  return exercise?.equipment.includes('med_ball') === true;
}

/**
 * Rows counted in repetitions rather than in load.
 *
 * A med-ball throw is the ball's weight, not the athlete's, and an explosive
 * or band-assisted pull is deliberately lighter than a bodyweight pull-up, so
 * neither may read "3 × BW". A pogo hop still may: it really is bodyweight.
 */
export function isRepCountedRow(exercise: Exercise | undefined): boolean {
  if (exercise === undefined || exercise.loadable) return false;
  if (usesMedBall(exercise)) return true;
  return exercise.isPulling === true && exercise.intent === 'velocity';
}

/**
 * The prescription line. The engine's `displayLoad` unless the row is counted
 * in repetitions, in which case the engine's rep formatter draws it instead.
 */
export function climbPrescription(set: SetPrescription, repCounted: boolean): string {
  if (!repCounted || set.reps === undefined) return set.displayLoad;
  return formatRepsOnly(set.reps);
}

/** "6 lb ball", the second line under a throw, when the inventory names one. */
export function medBallLine(lb: number | null | undefined): string | null {
  if (lb == null || !Number.isFinite(lb) || lb <= 0) return null;
  return `${formatLoadLb(lb)} ball`;
}

/**
 * The med ball's weight, from the stored inventory's own `medBallLb`.
 *
 * The engine's `Inventory` records a med ball as present or absent and never
 * asks how heavy it is, so an athlete who has not been asked has no weight to
 * show and the throw's second line is simply absent. Reading the raw JSON
 * keeps that additive: nothing breaks for an inventory written before the
 * question existed.
 */
export function medBallWeightLb(inventory: unknown): number | null {
  if (typeof inventory !== 'object' || inventory === null) return null;
  const value = (inventory as Record<string, unknown>)['medBallLb'];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export interface CaptionInput {
  /** "Open hand only", from the engine's own row (`house.sc.open_hand_grip`). */
  readonly fingerNote: string | null;
  /** "Weaker side first: left" (`house.sc.weaker_side_first`). */
  readonly sideNote: string | null;
  readonly isRnt: boolean;
}

/** A trailing full stop, dropped so the captions join on one line cleanly. */
function trimStop(text: string): string {
  return text.endsWith('.') ? text.slice(0, -1) : text;
}

/**
 * The captions under an exercise header, in a fixed order: what the hands do,
 * which side goes first, what ends the set. Never a colour, never a pill.
 */
export function climbCaptions({ fingerNote, sideNote, isRnt }: CaptionInput): string[] {
  const out: string[] = [];
  if (fingerNote !== null && fingerNote !== '') out.push(trimStop(fingerNote));
  if (sideNote !== null && sideNote !== '') out.push(trimStop(sideNote));
  if (isRnt) out.push(RNT_CAPTION);
  return out;
}
