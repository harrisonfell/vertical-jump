import type { Exercise, ExerciseId, SessionBlock, SessionPlan } from '@vert/engine';
import { indexById, isHardFingerExercise, loadExercises, sessionFingerLoad } from '@vert/engine';
import { formatInteger } from '@vert/engine/units';

/**
 * The climbing house rules the runner has to run itself, on rows that were
 * chosen before the athlete answered today's questions.
 *
 * Two of them arrive too late for the generator. The finger question is asked
 * minutes before the first set, and the readiness gate needs a throw that has
 * not been thrown yet, so both are applied here against the session's stored
 * snapshot rather than by rebuilding the week. Everything that decides is the
 * engine's: `isHardFingerExercise` names the rows, the seeded exercise carries
 * `isRnt`, and the ceiling comes off the athlete or the ruleset.
 */

/** The seed, indexed once. Pure data, so one copy serves every render. */
let cached: ReadonlyMap<ExerciseId, Exercise> | null = null;

export function exerciseIndex(): ReadonlyMap<ExerciseId, Exercise> {
  if (cached === null) cached = indexById(loadExercises().exercises);
  return cached;
}

/** Warm-up and cool-down movements are never prescriptions, so nothing cuts them. */
function isUncountedBlock(block: SessionBlock): boolean {
  return block.name === 'warm_up' || block.name === 'cool_down';
}

/**
 * House `house.sc.finger_pain_ceiling`: true once the answer is over the
 * ceiling. The ceiling ships at 3, so 4 out of 10 is the first answer that
 * takes the hard finger work out.
 */
export function fingerPainOver(value: number | null, ceiling: number): boolean {
  return value !== null && Number.isFinite(value) && value > ceiling;
}

/**
 * True when this session carries hard finger work, which is the only session
 * the question is asked before. Read off the rows the week was built with, so
 * removing the rows never removes the question that removed them.
 */
export function hasHardFingerWork(
  rows: readonly { readonly exerciseId: string }[],
  byId: ReadonlyMap<ExerciseId, Exercise> = exerciseIndex(),
): boolean {
  return rows.some((row) => {
    const exercise = byId.get(row.exerciseId);
    return exercise !== undefined && isHardFingerExercise(exercise);
  });
}

/** Why a row left, kept off the exercise-cap line, which means something else. */
export const FINGER_TRIM_REASON = 'Finger pain over the ceiling: hard finger work out today.';

/**
 * "Finger pain at 5 out of 10, over your ceiling of 3: the hard finger work is
 * out of today's session." The clause after the colon is the generator's own
 * sentence, so the answer given before the session and the answer given during
 * setup read the same (house `house.sc.finger_pain_ceiling`).
 */
export function fingerPainNotice(value: number, ceiling: number): string {
  return (
    `Finger pain at ${formatInteger(value)} out of 10, over your ceiling of ` +
    `${formatInteger(ceiling)}: the hard finger work is out of today's session.`
  );
}

/**
 * Today's session with every hard finger row removed and the notice added.
 *
 * Returns the session untouched when the answer is at or under the ceiling, so
 * the common day costs one comparison. Nothing else about the session moves:
 * the rows that stay keep their loads, because the ceiling is about the
 * pulleys and not about the legs.
 */
export function removeHardFingerRows(
  session: SessionPlan,
  value: number,
  ceiling: number,
  byId: ReadonlyMap<ExerciseId, Exercise> = exerciseIndex(),
): SessionPlan {
  if (!fingerPainOver(value, ceiling)) return session;

  const trimmed = [...session.trimmed];
  let removed = 0;
  const blocks = session.blocks.map((block) => {
    if (isUncountedBlock(block)) return block;
    const kept = block.exercises.filter((row) => {
      const exercise = byId.get(row.exerciseId);
      if (exercise === undefined || !isHardFingerExercise(exercise)) return true;
      trimmed.push({ exerciseId: row.exerciseId, reason: FINGER_TRIM_REASON });
      removed += 1;
      return false;
    });
    return kept.length === block.exercises.length ? block : { ...block, exercises: kept };
  });

  if (removed === 0) return session;
  return {
    ...session,
    blocks,
    trimmed,
    notices: [...session.notices, fingerPainNotice(value, ceiling)],
    // Light finger work stays, so the session's load is recomputed rather
    // than assumed to be none.
    fingerLoad: sessionFingerLoad(blocks, byId),
  };
}
