import type { StripRow, StripSessionInput } from './weekStrip';

/**
 * Forcing a state in development.
 *
 * Most of brief section 06 is reachable from the owner fixture: done, missed,
 * planned, rest, test, deload, taper and peak all sit in the seeded twelve
 * weeks. Four do not, because the fixture's own numbers never produce them:
 * a repeat week, a session left part-logged, the in-season line, and a second
 * program version. `?plan=repeat` and friends draw them so the states can be
 * reviewed without editing the fixture. Nothing here writes to the database.
 */

export const PLAN_STATES = [
  'repeat',
  'not-finished',
  'in-season',
  'versions',
  'loading',
  'empty',
] as const;

export type PlanState = (typeof PLAN_STATES)[number];

function isPlanState(value: string): value is PlanState {
  return (PLAN_STATES as readonly string[]).includes(value);
}

/** Reads `?plan=repeat` or `?plan=repeat,versions` from the route. */
export function readPlanStates(param: string | string[] | undefined): ReadonlySet<PlanState> {
  const raw = param === undefined ? [] : Array.isArray(param) ? param : param.split(',');
  const states = new Set<PlanState>();
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (isPlanState(trimmed)) states.add(trimmed);
  }
  return states;
}

/** Marks the current week as a repeat of the one before it. */
export function applyRepeat(rows: readonly StripRow[], currentWeek: number | null): StripRow[] {
  if (currentWeek === null || currentWeek < 2) return [...rows];
  return rows.map((row) =>
    row.w === currentWeek ? { ...row, repeatLabel: `Repeat of week ${currentWeek - 1}` } : row,
  );
}

/**
 * Turns the last finished session of the current week into a part-logged one,
 * which is the state a session reaches by tapping rows and walking out.
 */
export function applyNotFinished(
  sessions: readonly StripSessionInput[],
  today: string,
): StripSessionInput[] {
  let target: StripSessionInput | undefined;
  for (const session of sessions) {
    if (session.status !== 'done' || session.date > today) continue;
    if (target === undefined || session.date > target.date) target = session;
  }
  if (target === undefined) return [...sessions];
  return sessions.map((session) =>
    session === target ? { ...session, status: 'not_finished' as const } : session,
  );
}
