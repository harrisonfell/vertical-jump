import type { Adherence, SessionRecord, WeekPlan } from '@vert/engine';
import { computeAdherence } from '@vert/engine';
import { formatPercentWhole } from '@vert/engine/analytics';

/**
 * The live adherence ladder for the current week.
 *
 * Factual, no reward framing, and no streak: the count, the percentage, and
 * what one more finished session would make it. The engine ships
 * `adherenceLadderLine`, but it names 100% as the next rung whatever the week
 * is prescribed, which is wrong at four days a week (2 of 4 plus one is 75%,
 * not 100%). This builds the same sentence from the same numbers and names the
 * rung the athlete can actually reach next. Reported as an INTERFACE_GAP.
 */

/**
 * Adherence for a week that is still running.
 *
 * `computeAdherence` also judges "all prescribed reps", which needs every set
 * log of every session in the week and is only read at generation. The ladder
 * needs the counts alone, so no logs are fetched for it and
 * `allRepsCompleted` on the result is not meaningful here.
 */
export function liveAdherence(week: WeekPlan, sessions: readonly SessionRecord[]): Adherence {
  return computeAdherence(week, [], [...sessions]);
}

/**
 * Adherence from the counts alone, for a week whose stored plan cannot be
 * read. The ladder needs nothing else; the outcome is never decided from this.
 */
export function countAdherence(prescribed: number, completed: number): Adherence {
  const done = Math.min(prescribed, completed);
  return {
    prescribed,
    completed: done,
    pct: prescribed === 0 || done === 0 ? 0 : done / prescribed,
    allRepsCompleted: false,
    perLiftFailures: {},
  };
}

/** "Week 7 · 2 of 4 done (50%) · finish 1 more for 75%". */
export function ladderLine(weekNumber: number, adherence: Adherence): string {
  const pct = formatPercentWhole(adherence.pct);
  const head = `Week ${weekNumber} · ${adherence.completed} of ${adherence.prescribed} done (${pct})`;
  const remaining = adherence.prescribed - adherence.completed;
  if (remaining <= 0 || adherence.prescribed === 0) return head;
  const next = formatPercentWhole((adherence.completed + 1) / adherence.prescribed);
  return `${head} · finish 1 more for ${next}`;
}
