/**
 * Applying one day's readiness outcome to one session
 * (house rule `house.sc.readiness_gate`).
 *
 * Three invariants, and each one is enforced here rather than trusted:
 *  - downward only. Factors are clamped to at most 1 and the rep addition to
 *    at least 0, so a hand-edited ruleset still cannot raise a load, a rep
 *    count or a jump volume through this path.
 *  - today only. Nothing outside the session passed in is read or written.
 *  - reversible on screen. Every reduced set keeps its unreduced twin in
 *    `original`, exactly as the soreness path does, so the session detail can
 *    show what the day would have been.
 *
 * Idempotent by construction: a session that already carries a readiness
 * outcome is returned untouched, so applying twice equals applying once. A
 * changed answer is handled by re-materializing the session, not by trying to
 * unwind a reduction in place.
 */
import type { ExerciseId } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type {
  SessionBlock,
  SessionExercise,
  SessionPlan,
  SetPrescription,
} from '../types/plan.js';
import type { ReadinessAdjustment, ReadinessOutcome } from '../types/readiness.js';
import { countContacts } from '../budgets.js';
import { isContactBudgeted } from '../prescribe/index.js';
import { gridFor, retitleReps, snapLoadLb } from '../prescribe/display.js';
import type { LoadGrid } from '../units.js';
import { formatLoadLb, kgToLb, lbToKg, roundHalfUp } from '../units.js';

/** Plain words for the trim list when a maximal jump leaves the day. */
export const READINESS_TRIM_REASON = 'Readiness low: maximal jumps out today.';

/** What the caller can hand the gate beyond the session itself. */
export interface ReadinessApplyOptions {
  /**
   * The seeded exercises by id. With it, maximal jumps can be named and
   * removed and the contact counts rebuilt; without it no row is removed and
   * a row counts as contact-budgeted when it carries contacts per rep.
   */
  exercisesById?: ReadonlyMap<ExerciseId, Exercise>;
  /** The smallest load step this athlete can actually load. R162 default. */
  stepLb?: number;
}

/** Blocks whose rows are warm-up or cool-down movements, never prescriptions. */
function isUncountedBlock(block: SessionBlock): boolean {
  return block.name === 'warm_up' || block.name === 'cool_down';
}

/** The unreduced twin, with any earlier twin dropped so nesting cannot grow. */
function twin(set: SetPrescription): SetPrescription {
  const original: SetPrescription = { ...set };
  delete original.original;
  return original;
}

/**
 * Swap the load token inside a display string, so "5 × BW + 45 lb" survives a
 * reduction with its shape intact. Returns null when the string does not show
 * the load at all, which is the signal to leave the load alone rather than
 * print a number the row does not carry.
 */
function retitleLoad(display: string, oldLb: number, newLb: number): string | null {
  const oldText = formatLoadLb(oldLb);
  const index = display.lastIndexOf(oldText);
  if (index < 0) return null;
  return display.slice(0, index) + formatLoadLb(newLb) + display.slice(index + oldText.length);
}

/** Scale a jump row's reps. Never below one rep, never above what was planned. */
function scaleJumpSet(set: SetPrescription, factor: number): SetPrescription {
  if (set.reps === undefined) return set;
  const reps = Math.max(1, Math.floor(set.reps * factor));
  if (reps >= set.reps) return set;
  return {
    ...set,
    reps,
    displayLoad: retitleReps(set.displayLoad, set.reps, reps),
    original: twin(set),
  };
}

/**
 * The R27 magnitude on a rep row: more reps at a lighter load. Duration and
 * distance rows are untouched, because a 30 s hold has no tier to drop.
 */
function reduceLoadedSet(
  set: SetPrescription,
  loadFactor: number,
  extraReps: number,
  grid: LoadGrid,
  stepLb: number,
): SetPrescription {
  if (set.reps === undefined) return set;
  const reps = set.reps + extraReps;
  let display = retitleReps(set.displayLoad, set.reps, reps);
  let loadKg = set.loadKg;
  let loadPercent = set.loadPercent;

  if (loadFactor < 1 && set.loadKg !== undefined && set.loadKg > 0) {
    const oldLb = snapLoadLb(kgToLb(set.loadKg), grid, stepLb);
    const newLb = snapLoadLb(kgToLb(set.loadKg) * loadFactor, grid, stepLb);
    const retitled = newLb === oldLb ? display : retitleLoad(display, oldLb, newLb);
    if (retitled !== null && newLb !== oldLb) {
      display = retitled;
      loadKg = lbToKg(newLb);
      if (set.loadPercent !== undefined) {
        loadPercent = roundHalfUp(set.loadPercent * loadFactor, 0);
      }
    }
  }

  if (reps === set.reps && loadKg === set.loadKg) return set;
  const next: SetPrescription = { ...set, reps, displayLoad: display, original: twin(set) };
  if (loadKg !== undefined) next.loadKg = loadKg;
  if (loadPercent !== undefined) next.loadPercent = loadPercent;
  return next;
}

/** One row, reduced along whichever axis its own budget runs on. */
function adjustRow(
  row: SessionExercise,
  exercise: Exercise | undefined,
  jumpFactor: number,
  loadFactor: number,
  extraReps: number,
  stepLb: number,
): SessionExercise {
  const budgeted =
    exercise !== undefined ? isContactBudgeted(exercise) : row.contactsPerRep > 0;
  if (budgeted) {
    if (jumpFactor >= 1) return row;
    const sets = row.sets.map((set) => scaleJumpSet(set, jumpFactor));
    return sets.every((set, index) => set === row.sets[index]) ? row : { ...row, sets };
  }
  if (loadFactor >= 1 && extraReps === 0) return row;
  const grid = exercise === undefined ? 'barbell' : gridFor(exercise, row.loadType);
  const sets = row.sets.map((set) => reduceLoadedSet(set, loadFactor, extraReps, grid, stepLb));
  return sets.every((set, index) => set === row.sets[index]) ? row : { ...row, sets };
}

/** Clamp the file's magnitudes so nothing this function does can raise. */
function downwardOnly(adjustment: ReadinessAdjustment): {
  jumpFactor: number;
  loadFactor: number;
  extraReps: number;
} {
  return {
    jumpFactor: Math.min(1, Math.max(0, adjustment.jumpVolumeFactor)),
    loadFactor: Math.min(1, Math.max(0, adjustment.loadFactor)),
    extraReps: Math.max(0, Math.round(adjustment.extraReps)),
  };
}

/**
 * Apply one day's outcome to one session. Downward only, today only, and
 * idempotent: a session that already carries an outcome comes back unchanged.
 *
 * `holdVolume` is not applied here. It binds the generator, where the week's
 * extensive-contact target is computed, because a session that has already
 * been built cannot un-take a raise it was built with. This function never
 * raises anything, so the two together honour the rule.
 *
 * `tierDown` carries no separate reduction either: the tier it names is
 * expressed by the removal, the factors and the rep addition beside it, and
 * applying it twice would cut the day twice over.
 *
 * @param session the session to adjust; it is not mutated.
 * @param outcome today's gate result, from `scoreReadiness`.
 * @param options the exercise index, so maximal jumps can be named, and the
 *   athlete's load step.
 * @returns a new session with the line on `notices`, the outcome on
 *   `readiness`, removed rows on `trimmed`, and every reduced set carrying its
 *   unreduced twin.
 */
export function applyReadinessAdjustment(
  session: SessionPlan,
  outcome: ReadinessOutcome,
  options: ReadinessApplyOptions = {},
): SessionPlan {
  if (session.readiness !== undefined) return session;

  const adjustment = outcome.adjustment;
  const { jumpFactor, loadFactor, extraReps } = downwardOnly(adjustment);
  const byId = options.exercisesById;
  const stepLb = options.stepLb ?? 5;

  const trimmed = [...session.trimmed];
  let testDeferred = false;

  const blocks: SessionBlock[] = session.blocks.map((block) => {
    if (isUncountedBlock(block)) return block;
    const kept: SessionExercise[] = [];
    for (const row of block.exercises) {
      const exercise = byId?.get(row.exerciseId);
      if (
        adjustment.removeMaximalJumps &&
        exercise !== undefined &&
        exercise.plyometric?.isMaximalJump === true
      ) {
        trimmed.push({ exerciseId: row.exerciseId, reason: READINESS_TRIM_REASON });
        if (exercise.rotationGroup === 'jump_test') testDeferred = true;
        continue;
      }
      kept.push(adjustRow(row, exercise, jumpFactor, loadFactor, extraReps, stepLb));
    }
    return kept.every((row, index) => row === block.exercises[index]) &&
      kept.length === block.exercises.length
      ? block
      : { ...block, exercises: kept };
  });

  const bothUnknown =
    outcome.channels[0].band === 'unknown' && outcome.channels[1].band === 'unknown';
  const notices = bothUnknown ? [...session.notices] : [...session.notices, outcome.line];

  const next: SessionPlan = {
    ...session,
    blocks,
    notices,
    trimmed,
    readiness: outcome,
  };
  if (byId !== undefined) {
    next.contacts = countContacts(blocks, byId, session.contacts.targetExtensive);
  }
  if (testDeferred && session.testStatus === 'planned') next.testStatus = 'deferred';
  return next;
}
