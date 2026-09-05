import type { MoveDecision, WeekPlan } from '@vert/engine';
import { RULESET_V1, canMoveSession } from '@vert/engine';
import { headerDuration } from './header';

/**
 * Whether the next session may be pulled onto a rest day.
 *
 * Pure, and apart from the screen that renders it, because the refusal is the
 * part that has to be right: a rest day whose header says "Next: Recovery -
 * Mobility on Sat 5 Sep" must never answer "there is no session left this week
 * to move" (D-33). The candidate is the same session the header named, the
 * answer comes from the engine, and the engine's plain words are what the
 * athlete reads. The rule number stays in the Plan summary.
 */

function readWeekPlan(snapshot: unknown): WeekPlan | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const candidate = snapshot as { sessions?: unknown; windowStart?: unknown };
  if (!Array.isArray(candidate.sessions)) return null;
  if (typeof candidate.windowStart !== 'string') return null;
  return snapshot as WeekPlan;
}

/** Said only when the week really has nothing left, never when a lookup failed. */
export const NOTHING_TO_MOVE = 'There is no session left this week to move.';

/** Said when the week's plan is missing, so the spacing rules cannot be read. */
export const NO_WEEK_PLAN =
  'This week’s plan is not on this phone yet, so the spacing rules cannot be checked. Open it from Plan.';

/**
 * Whether this week's next session may be pulled onto today, and why not.
 *
 * A missing snapshot is its own answer: it is not the same fact as an empty
 * week, and saying so is the difference between "come back when it syncs" and
 * "you are done for the week".
 */
export function moveDecision(
  weekSnapshot: unknown,
  from: string | null,
  today: string,
): MoveDecision {
  if (from === null) return { ok: false, reason: NOTHING_TO_MOVE, rule: 0 };
  const plan = readWeekPlan(weekSnapshot);
  if (plan === null) return { ok: false, reason: NO_WEEK_PLAN, rule: 0 };
  return canMoveSession(plan, from, today, RULESET_V1, today);
}

/** "about 75 min" for the session that would land here, when the snapshot has it. */
export function plannedMinutes(snapshot: unknown): string | undefined {
  if (typeof snapshot !== 'object' || snapshot === null) return undefined;
  const minutes = (snapshot as { estimatedMinutes?: unknown }).estimatedMinutes;
  return typeof minutes === 'number' ? headerDuration(minutes) : undefined;
}
