/**
 * The exercise ids the entered numbers are stored against.
 *
 * A leaf with no imports of its own: the entered 1RM, the best recent set and
 * the step-2 form all name the same five lifts, and each of them is reached by
 * the others, so the names cannot live in any one of them.
 */

/** The lifts a 1RM or a best set can be entered for, and their engine ids. */
export const MAX_LIFT_IDS = {
  squat: 'back_squat',
  hinge: 'trap_bar_deadlift',
  press: 'db_bench_press',
  boxSquat: 'box_squat',
  pullUp: 'weighted_pull_up',
} as const;

/** The reps the weighted pull-up 1RM field is understood to be for (R73). */
export const PULL_UP_ENTRY_REPS = 5;
