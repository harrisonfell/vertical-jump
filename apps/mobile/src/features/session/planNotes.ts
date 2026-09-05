import type { SessionPlan } from '@vert/engine';

/**
 * The two per-row lines the climbing house rules write, read back off the
 * stored session snapshot.
 *
 * `session_exercise` has no column for them, and it should not: they are not
 * facts about the exercise, they are facts about the day this exercise was
 * prescribed on. "Weaker side first: left" was true because of the single-leg
 * test that stood that week (`house.sc.weaker_side_first`), and "Open hand
 * only." because of the finger-pulley history that stood that week
 * (`house.sc.open_hand_grip`). The snapshot is the record of what the athlete
 * was actually told, so a session read a month later says the same thing it
 * said on the evening it was finished.
 */

export interface RowNotes {
  /** "Weaker side first: left". */
  readonly sideNote: string | null;
  /** "Open hand only." or "Light finger work today.". */
  readonly fingerNote: string | null;
}

const NONE: RowNotes = { sideNote: null, fingerNote: null };

/** A row is found by its block and its exercise, the pair the store keeps. */
function keyFor(block: string | null, exerciseId: string): string {
  return `${block ?? 'session'}::${exerciseId}`;
}

/**
 * Every row's notes, keyed by block and exercise id.
 *
 * One exercise can appear twice in a session (a warm-up pogo and a primer
 * pogo), so the block is part of the key. A plain exercise-id key is written
 * as well for the first row that claims it, which is what a stored row with a
 * block the snapshot does not carry falls back to.
 */
export function rowNotes(plan: SessionPlan | null): ReadonlyMap<string, RowNotes> {
  const notes = new Map<string, RowNotes>();
  if (plan === null) return notes;

  for (const block of plan.blocks) {
    for (const row of block.exercises) {
      const entry: RowNotes = {
        sideNote: row.sideNote ?? null,
        fingerNote: row.fingerNote ?? null,
      };
      if (entry.sideNote === null && entry.fingerNote === null) continue;
      notes.set(keyFor(block.name, row.exerciseId), entry);
      if (!notes.has(row.exerciseId)) notes.set(row.exerciseId, entry);
    }
  }
  return notes;
}

/** One stored row's notes, or two nulls when the snapshot carries none. */
export function rowNotesFor(
  notes: ReadonlyMap<string, RowNotes>,
  block: string | null,
  exerciseId: string,
): RowNotes {
  return notes.get(keyFor(block, exerciseId)) ?? notes.get(exerciseId) ?? NONE;
}

/**
 * True when this session carries hard finger work: weighted pull-ups, a
 * hangboard hang or an explosive pull (`house.sc.hard_finger_spacing`). Read
 * off the snapshot's own `fingerLoad`, which the engine wrote from the rows it
 * chose.
 */
export function hasHardFingerWork(plan: SessionPlan | null): boolean {
  return plan?.fingerLoad === 'hard';
}
