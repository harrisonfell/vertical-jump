/**
 * The hard invariants brief section 09 "Tests" names, asserted at the end of
 * `materializeWeek` so a bad week can never reach a screen. Everything here is
 * a Block 1 or Block 4 guarantee: a violation is an engine bug, not an athlete
 * input, so it throws rather than degrading.
 */
import { CONTACT_CAPS } from '../budgets.js';
import { displayedRowCount } from '../select/order.js';
import type { MaterializeContext, SessionPlan, WeekPlan } from '../types/plan.js';

/** Thrown when a materialized week breaks an invariant. */
export class WeekInvariantError extends Error {
  readonly invariant: string;
  readonly sessionId: string | undefined;

  constructor(invariant: string, sessionId?: string) {
    super(sessionId === undefined ? invariant : `${invariant} (${sessionId})`);
    this.name = 'WeekInvariantError';
    this.invariant = invariant;
    this.sessionId = sessionId;
  }
}

/** The rows and their set shapes, so a thrown invariant names what broke it. */
function rowSummary(session: SessionPlan): string {
  const parts: string[] = [];
  for (const block of session.blocks) {
    if (block.name === 'warm_up' || block.name === 'cool_down') continue;
    for (const row of block.exercises) {
      parts.push(`${row.exerciseId} ${row.sets.length}x${row.sets[0]?.reps ?? 0}`);
    }
  }
  return parts.join(', ');
}

/** Assert one session, in the order Rule 0 applies the blocks. */
export function assertSessionInvariants(
  session: SessionPlan,
  context: MaterializeContext,
  highCnsIds: ReadonlySet<string>,
): void {
  const constants = context.ruleset.constants;
  const { contacts } = session;

  if (contacts.highIntensity > CONTACT_CAPS.highIntensityPerSession) {
    throw new WeekInvariantError(
      `R85: ${contacts.highIntensity} high-intensity contacts, cap 25 [${rowSummary(session)}]`,
      session.id,
    );
  }
  if (contacts.highAmplitude > CONTACT_CAPS.highAmplitudePerSession) {
    throw new WeekInvariantError(
      `R52: ${contacts.highAmplitude} high-amplitude contacts, cap 20 [${rowSummary(session)}]`,
      session.id,
    );
  }

  let highCns = 0;
  const joints = { knee: 0, spine: 0, shoulder: 0 };
  for (const block of session.blocks) {
    if (block.name === 'warm_up') continue;
    for (const row of block.exercises) {
      if (highCnsIds.has(row.exerciseId)) highCns += 1;
      const exercise = context.exercises.find((entry) => entry.id === row.exerciseId);
      if (exercise === undefined) continue;
      if (exercise.kneeStress === 'high') joints.knee += 1;
      if (exercise.spineStress === 'high') joints.spine += 1;
      if (exercise.shoulderStress === 'high') joints.shoulder += 1;

      for (const set of row.sets) {
        if (!exercise.loadable && (set.loadPercent !== undefined || set.loadKg !== undefined)) {
          throw new WeekInvariantError('R159: a non-loadable row carries a load', session.id);
        }
        if (set.loadKg !== undefined && set.displayLoad.length === 0) {
          throw new WeekInvariantError('R148: a loaded set with no per-set display', session.id);
        }
      }
    }
  }

  if (highCns > constants.maxHighCnsPerSession) {
    throw new WeekInvariantError(
      `R44: more than 2 high-CNS exercises [${rowSummary(session)}]`,
      session.id,
    );
  }
  const jointCap = constants.maxJointHighStressPerSession;
  if (joints.knee > jointCap || joints.spine > jointCap || joints.shoulder > jointCap) {
    throw new WeekInvariantError('R23 to R25: more than 2 high joint-stress exercises', session.id);
  }
  if (displayedRowCount(session.blocks) > constants.maxDisplayedExercises) {
    throw new WeekInvariantError('more than 8 displayed exercises', session.id);
  }
}

/**
 * Assert the invariants brief section 09 "Tests" names, and throw with the
 * failing invariant when one breaks.
 */
export function assertWeekInvariants(week: WeekPlan, context: MaterializeContext): void {
  const highCnsIds = new Set(
    context.exercises.filter((exercise) => exercise.cnsCost === 'high').map((exercise) => exercise.id),
  );
  for (const session of week.sessions) {
    assertSessionInvariants(session, context, highCnsIds);
  }

  const tendonIds = new Set(
    context.exercises.filter((exercise) => exercise.tendonTarget !== undefined).map((e) => e.id),
  );
  const hasTendon = week.sessions.some((session) =>
    session.blocks.some((block) => block.exercises.some((row) => tendonIds.has(row.exerciseId))),
  );
  if (!hasTendon && week.sessions.length > 0) {
    throw new WeekInvariantError('R99: no tendon loading exercise this week');
  }
}
