/**
 * R57 rotation, R110 plateau variation and the R111 velocity swap.
 *
 * Accessories rotate after 3 consecutive weeks inside their rotation group.
 * Main lifts do not rotate inside a block: they progress in load per Block 6
 * and only change at a block transition, and the brief keeps the back squat
 * across the Strength to Power transition so the working-max history survives,
 * so a main lift rotates only on plateau (`read.back_squat_kept`,
 * `house.plateau`).
 *
 * R111 (house `house.r111_velocity`): a working max up 10 percent since block
 * start swaps the lowest-precedence accessory on the strength day for one
 * velocity exercise. Nothing is added, so the 8-exercise and two-high-CNS caps
 * hold.
 */
import type { ExerciseId } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { Prng } from '../prng.js';
import type { PlacedRow } from './trim.js';

/** Everything rotation reads. */
export interface RotationContext {
  /** 1-based week being materialized. */
  w: number;
  /** Weeks each exercise has already appeared in, ascending (R57). */
  rotationHistory: Record<ExerciseId, number[]>;
  /** R57: three consecutive weeks. */
  rotationWeeks: number;
  /** R110: five canonical tests inside the noise band, or a stalled lift. */
  plateau: boolean;
  /** A block boundary: the only place a main lift may change (R57). */
  blockTransition: boolean;
  /** R111: a working max is up 10 percent since block start. */
  workingMaxUp10: boolean;
  /**
   * Rows R57 may not touch. The test-day Primer is constant (pogo 2 x 5,
   * submax CMJ 2 x 3) and the weekly test is the week's fixed measurement, so
   * neither rotates however long it has run.
   */
  fixedRows?: (row: PlacedRow) => boolean;
  /**
   * Whether a replacement may take the row's place at all. R57 is a Block 5
   * rule and Rule 0 puts Block 4's CNS and joint budgets above it, so a
   * rotation that would put a third high-CNS or a third knee-high row in the
   * session is refused and the stale row stays. Absent allows every
   * replacement, which is what rotation did before the budgets were passed in.
   */
  allow?: (candidate: Exercise, replacing: PlacedRow) => boolean;
  prng: Prng;
}

/** "New this week · replaces Bulgarian split squat (3 weeks)". */
export function rotationNoteText(replacedName: string, weeks: number): string {
  return `New this week · replaces ${replacedName} (${weeks} weeks)`;
}

/** How many consecutive weeks up to and including w-1 this exercise ran. */
export function consecutiveWeeks(
  rotationHistory: Record<ExerciseId, number[]>,
  exerciseId: ExerciseId,
  w: number,
): number {
  const weeks = rotationHistory[exerciseId];
  if (weeks === undefined || weeks.length === 0) return 0;
  const seen = new Set(weeks);
  let run = 0;
  for (let week = w - 1; week >= 1; week -= 1) {
    if (!seen.has(week)) break;
    run += 1;
  }
  return run;
}

/** R57: an accessory repeated for three consecutive weeks must rotate. */
export function needsRotation(exerciseId: ExerciseId, context: RotationContext): boolean {
  return consecutiveWeeks(context.rotationHistory, exerciseId, context.w) >= context.rotationWeeks;
}

function freshest(
  candidates: readonly Exercise[],
  context: RotationContext,
  label: string,
): Exercise | undefined {
  if (candidates.length === 0) return undefined;
  let best = Number.POSITIVE_INFINITY;
  const bucket: Exercise[] = [];
  for (const candidate of candidates) {
    const run = consecutiveWeeks(context.rotationHistory, candidate.id, context.w);
    if (run < best) {
      best = run;
      bucket.length = 0;
    }
    if (run === best) bucket.push(candidate);
  }
  const ordered = bucket.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return context.prng.fork(label).pick(ordered);
}

function replacementFor(
  row: PlacedRow,
  pool: readonly Exercise[],
  chosen: ReadonlySet<ExerciseId>,
  context: RotationContext,
): Exercise | undefined {
  const group = row.exercise.rotationGroup;
  const allowed = (candidate: Exercise): boolean => context.allow?.(candidate, row) !== false;
  const sameGroup = pool.filter(
    (candidate) =>
      candidate.id !== row.exercise.id &&
      !chosen.has(candidate.id) &&
      candidate.rotationGroup === group &&
      candidate.roleCandidates.includes(row.role) &&
      allowed(candidate),
  );
  const fromGroup = freshest(sameGroup, context, `rotate:${row.exercise.id}`);
  if (fromGroup !== undefined) return fromGroup;
  const sameRole = pool.filter(
    (candidate) =>
      candidate.id !== row.exercise.id &&
      !chosen.has(candidate.id) &&
      candidate.roleCandidates.includes(row.role) &&
      candidate.movementPattern === row.exercise.movementPattern &&
      allowed(candidate),
  );
  return freshest(sameRole, context, `rotate-role:${row.exercise.id}`);
}

/** The result of a rotation pass: the new rows plus the note each row carries. */
export interface RotationResult {
  rows: PlacedRow[];
  notes: Record<ExerciseId, string>;
}

/**
 * R57 and R110. Accessory, secondary, core, injury-prevention, tendon and
 * plyometric rows rotate after three consecutive weeks, or immediately on a
 * plateau. Main lifts rotate only on a plateau at a block transition.
 */
export function rotateStaleExercises(
  rows: readonly PlacedRow[],
  pool: readonly Exercise[],
  context: RotationContext,
): RotationResult {
  const chosen = new Set(rows.map((row) => row.exercise.id));
  const notes: Record<ExerciseId, string> = {};
  const out: PlacedRow[] = [];

  for (const row of rows) {
    if (context.fixedRows?.(row) === true) {
      out.push(row);
      continue;
    }
    const isMain = row.role === 'main_lift';
    const stale = needsRotation(row.exercise.id, context);
    const mainMayRotate = isMain && context.plateau && context.blockTransition;
    const otherMayRotate = !isMain && (stale || (context.plateau && isVariable(row)));
    if (!(mainMayRotate || otherMayRotate)) {
      out.push(row);
      continue;
    }
    const replacement = replacementFor(row, pool, chosen, context);
    if (replacement === undefined) {
      out.push(row);
      continue;
    }
    chosen.delete(row.exercise.id);
    chosen.add(replacement.id);
    notes[replacement.id] = rotationNoteText(
      row.exercise.name,
      stale ? consecutiveWeeks(context.rotationHistory, row.exercise.id, context.w) : context.rotationWeeks,
    );
    out.push({ ...row, exercise: replacement });
  }
  return { rows: out, notes };
}

/** R110 varies plyometric and accessory variants, not the structural rows. */
function isVariable(row: PlacedRow): boolean {
  if (row.exercise.plyometric !== undefined) return row.role !== 'power_jump' || row.block !== 'jump_test';
  return row.role === 'accessory' || row.role === 'secondary';
}

/**
 * R111 house swap: replace the lowest-precedence accessory on a strength day
 * with one velocity exercise. Returns the rows unchanged when the trigger is
 * off or no candidate exists.
 */
export function applyR111Swap(
  rows: readonly PlacedRow[],
  pool: readonly Exercise[],
  context: RotationContext,
): RotationResult {
  if (!context.workingMaxUp10) return { rows: rows.slice(), notes: {} };
  const chosen = new Set(rows.map((row) => row.exercise.id));
  let targetIndex = -1;
  let lowest = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    if (row.role !== 'accessory' || row.required) return;
    if (row.precedence < lowest) {
      lowest = row.precedence;
      targetIndex = index;
    }
  });
  if (targetIndex === -1) return { rows: rows.slice(), notes: {} };

  const out = rows.slice();
  const target = out[targetIndex];
  if (target === undefined) return { rows: out, notes: {} };
  const candidates = pool.filter(
    (candidate) =>
      !chosen.has(candidate.id) &&
      (candidate.loadType === 'speed_strength' ||
        candidate.loadType === 'strength_speed' ||
        candidate.intent === 'velocity') &&
      candidate.roleCandidates.includes('accessory') &&
      context.allow?.(candidate, target) !== false,
  );
  const replacement = freshest(candidates, context, 'r111');
  if (replacement === undefined) return { rows: rows.slice(), notes: {} };
  out[targetIndex] = { ...target, exercise: replacement };
  return {
    rows: out,
    notes: {
      [replacement.id]: `New this week · replaces ${target.exercise.name} (your working max is up 10 percent)`,
    },
  };
}
