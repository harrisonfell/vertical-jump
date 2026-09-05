/**
 * Shared helpers for the two invariant test files: one builds a week from a
 * fresh context, the other names the owner's 12-week program.
 */
import { PROGRAM_START, baseAthlete, gridRuleset, gridSeed } from './grid.support.js';
import { materializeWeek } from '../src/materialize.js';
import { planSkeleton } from '../src/skeleton/index.js';
import type { Athlete } from '../src/types/athlete.js';
import type { MaterializeContext, MaterializeHistory, WeekPlan } from '../src/types/plan.js';

const ruleset = gridRuleset;
const { exercises, ladders } = gridSeed;

/** A generator with no rolling state: week 1 of a first program. */
export function freshHistory(): MaterializeHistory {
  return {
    rotationHistory: {},
    ladderState: {},
    jointHighStressLastWeek: { knee: 0, spine: 0, shoulder: 0 },
    consecutiveAdherence: [],
    testPlateau: false,
    liftPlateau: {},
    liftRaisedSinceBlockStart: {},
  };
}

/** Materialize week `w` for `athlete`, with an optional context patch. */
export function build(
  athlete: Athlete,
  w: number,
  patch: Partial<MaterializeContext> = {},
): WeekPlan {
  const skeleton = planSkeleton(athlete, PROGRAM_START, ruleset);
  const week = skeleton.weeks.find((entry) => entry.w === w);
  const context: MaterializeContext = {
    athlete,
    ruleset,
    exercises,
    ladders,
    skeleton,
    w,
    workingMaxes: [],
    history: freshHistory(),
    today: week?.windowStart ?? PROGRAM_START,
    seed: 11,
    ...patch,
  };
  return materializeWeek(context);
}

/**
 * Mon 7 Sep 2026 to Sun 29 Nov 2026 is W = 12 with the target inside the peak
 * week, which is the owner's own program.
 */
export function twelveWeekOwner(): Athlete {
  return { ...baseAthlete(), targetDate: '2026-11-29' };
}
