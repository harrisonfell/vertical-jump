/**
 * The climber's box squat history: the failure the 320 lb entry retired, the
 * entry itself, the working set logged behind it, and the best recent set the
 * athlete typed in setup step two.
 *
 * Split out of `climber.ts` so both files stay under the 500-line limit; every
 * name here is re-exported from `climber.ts`, so no caller changes.
 *
 * The numbers are the owner's own (spec of 5 Sep 2026): 345 lb failed and is
 * retired, 320 lb is entered and is what the first freeze reads, and the
 * entered best set of two at 305 lb at RPE 8.5 raises the frozen max one 5 lb
 * step to 325 at the next weekly freeze, inside the 5 percent per week
 * ceiling. Nothing here reads a clock, a file or `Math.random`.
 */
import { indexById, loadExercises } from '../exercises/index.js';
import { resolveWorkingMaxWithEntry, type EnteredOneRm } from '../prescribe/workingMax.js';
import { loadRuleset } from '../ruleset/index.js';
import { lbToKg } from '../units.js';
import { FIXTURE_PROGRAM_START } from './program.js';
import type { BestSet, WorkingMax } from '../types/athlete.js';
import type { LocalDate } from '../types/calendar.js';
import type { LiftId } from '../types/core.js';
import type { SetLog } from '../types/logs.js';

/** The box squat the athlete failed at, and which the entered 320 lb retires. */
export const CLIMBER_STALE_BOX_SQUAT_LB = 345;
/** The revised box squat 1RM the athlete entered after that failure. */
export const CLIMBER_BOX_SQUAT_LB = 320;
/** When the revision was typed: after the stale value's last freeze. */
export const CLIMBER_BOX_SQUAT_ENTERED_AT = '2026-09-05T12:00:00.000Z';

/** The stale working max the entered revision replaces. */
export function climberStaleBoxSquat(): WorkingMax {
  return {
    lift: 'box_squat',
    valueKg: lbToKg(CLIMBER_STALE_BOX_SQUAT_LB),
    source: 'epley',
    confidence: 0.95,
    frozenAt: '2026-08-31T03:00:00.000Z',
    lastRaiseAt: '2026-08-31T03:00:00.000Z',
    failStreak: 1,
  };
}

/** The entered 1RM, with the instant it was typed (R72). */
export function climberBoxSquatEntry(): EnteredOneRm {
  return {
    valueKg: lbToKg(CLIMBER_BOX_SQUAT_LB),
    reps: 1,
    enteredAt: CLIMBER_BOX_SQUAT_ENTERED_AT,
  };
}

/**
 * The older of the two box-squat working sets the owner logged: three at 270
 * lb at RPE 7, two weeks before the program started. It is history rather than
 * a best set, so it rides in as a retro-logged set and R73's Epley reads it
 * with the house 0.95 confidence factor (270 x 1.1 x 0.95 = 282 lb), which the
 * entered 320 lb is comfortably above.
 */
export const CLIMBER_PAST_SET_LB = 270;
export const CLIMBER_PAST_SET_AT: LocalDate = '2026-08-24';
/**
 * The best recent set the owner typed in setup step two: two at 305 lb at RPE
 * 8.5, one week before the program started. RPE 8 or higher at 6 reps or fewer
 * makes it a true near-max, so the confidence factor is waived and Epley reads
 * 305 x (1 + 2/30) = 325.3 lb, which lands on 325 on the 5 lb grid.
 */
export const CLIMBER_BEST_SET_LB = 305;
export const CLIMBER_BEST_SET_REPS = 2;
export const CLIMBER_BEST_SET_RPE = 8.5;
export const CLIMBER_BEST_SET_AT: LocalDate = '2026-08-31';
/** What that best set freezes the working max at, one weekly step above 320. */
export const CLIMBER_BEST_SET_MAX_LB = 325;

/** The best recent set per lift, as setup step two and Settings store it. */
export function climberBestSets(): Partial<Record<LiftId, BestSet>> {
  return {
    box_squat: {
      reps: CLIMBER_BEST_SET_REPS,
      loadKg: lbToKg(CLIMBER_BEST_SET_LB),
      rpe: CLIMBER_BEST_SET_RPE,
      at: CLIMBER_BEST_SET_AT,
    },
  };
}

/**
 * The working sets logged before the program started. Only the older one is
 * here: the newer 2 x 305 is the athlete's entered best set and reaches the
 * working max through `bestSets`, so it is not logged twice.
 */
export function climberPriorLogs(): SetLog[] {
  return [
    {
      id: `past-set:box_squat:${CLIMBER_PAST_SET_AT}`,
      sessionId: `past-set:box_squat`,
      exerciseId: 'box_squat',
      setNumber: 1,
      repsDone: 3,
      loadKg: lbToKg(CLIMBER_PAST_SET_LB),
      rpe: 7,
      loadSource: 'entered',
      completedAt: `${CLIMBER_PAST_SET_AT}T12:00:00.000Z`,
      plannedDate: CLIMBER_PAST_SET_AT,
      idempotencyKey: `past-set:box_squat:${CLIMBER_PAST_SET_AT}`,
    },
  ];
}

/**
 * The working maxes the program starts from. The box squat is the entered 320
 * lb: the athlete failed 345, entered 320 after it, and the entry is newer
 * than the stale value's freeze, so it replaces it rather than losing to the
 * monotone rule. The weighted pull-up carries no entered max at all; it picks
 * one up from the added load logged in the first weeks (R73).
 */
export function climberWorkingMaxes(): WorkingMax[] {
  const ruleset = loadRuleset();
  const boxSquat = indexById(loadExercises().exercises).get('box_squat');
  if (boxSquat === undefined) throw new Error('seed is missing box_squat');
  return [
    resolveWorkingMaxWithEntry(
      'box_squat',
      boxSquat,
      climberStaleBoxSquat(),
      climberBoxSquatEntry(),
      [],
      ruleset,
      `${FIXTURE_PROGRAM_START}T03:00:00.000Z`,
    ),
  ];
}
