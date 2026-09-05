/**
 * Block 5 for one generation: week w-1's adherence and outcome, the frozen
 * working maxes it moves (R72 to R74, R97), the skeleton those changes land
 * on, and the numbers the outcome line names.
 */
import { computeAdherence, decideOutcome, outcomeLine } from '../adherence/index.js';
import { applyFailureDrop, bestSetLogs, resolveWorkingMax } from '../prescribe/workingMax.js';
import { applyOutcomeToSkeleton } from '../skeleton/advance.js';
import { weekAt } from '../skeleton/index.js';
import { kgToLb } from '../units.js';
import type { OutcomeLineDetail } from '../adherence/index.js';
import type { Adherence, OutcomeDecision, SetLog } from '../types/logs.js';
import type { WorkingMax } from '../types/athlete.js';
import type { ExerciseId, LiftId, StressedJoint } from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type {
  MaterializeContext,
  PlanSkeleton,
  SessionPlan,
  SkeletonWeek,
} from '../types/plan.js';

export const EMPTY_ADHERENCE: Adherence = {
  prescribed: 0,
  completed: 0,
  pct: 0,
  allRepsCompleted: false,
  perLiftFailures: {},
};

const JOINTS: StressedJoint[] = ['knee', 'spine', 'shoulder'];

export function frozenAtFor(context: MaterializeContext, week: SkeletonWeek): string {
  return context.generatedAt ?? `${week.windowStart}T03:00:00.000Z`;
}

export function enteredMaxKg(context: MaterializeContext, lift: LiftId): number | null {
  const entered = context.athlete.workingMaxes.find(
    (entry) => entry.lift === lift && entry.source === 'entered',
  );
  return entered === undefined ? null : entered.valueKg;
}

/**
 * The frozen working maxes for this generation: an entered 1RM (R72), else the
 * best Epley over qualifying sets of the last four weeks (R73), else RPE mode
 * (R74). Monotone; R97 is the only way one falls.
 */
export function resolveWorkingMaxes(
  context: MaterializeContext,
  week: SkeletonWeek,
  decision: OutcomeDecision | undefined,
): { workingMaxes: WorkingMax[]; sourceLogs: Record<LiftId, SetLog> } {
  const asOf = frozenAtFor(context, week);
  // A best recent set the athlete typed is a retro-logged set, so it joins the
  // log stream R73 already reads rather than taking a path of its own. Empty
  // for every athlete who typed none, so no other program's freeze moves.
  const logs = [
    ...(context.recentLogs ?? []),
    ...(context.prevWeek?.logs ?? []),
    ...bestSetLogs(context.athlete),
  ];
  const previousById = new Map(context.workingMaxes.map((entry) => [entry.lift, entry]));
  const sourceLogs: Record<LiftId, SetLog> = {};
  const out: WorkingMax[] = [];

  for (const exercise of context.exercises) {
    if (!exercise.loadable) continue;
    const previous = previousById.get(exercise.id);
    // An entered 1RM (R72) seeds the first freeze only. Re-reading it every
    // week would undo an R97 drop, and R97 is the one way a max may fall.
    const entered = previous === undefined ? enteredMaxKg(context, exercise.id) : null;
    const resolved = resolveWorkingMax(
      exercise.id,
      exercise,
      previous,
      entered,
      logs,
      context.ruleset,
      asOf,
    );
    if (resolved.valueKg <= 0) continue;
    const drop = decision?.workingMaxDeltaPct[exercise.id];
    const finalMax =
      drop === undefined || drop >= 0 ? resolved : applyFailureDrop(resolved, context.ruleset, asOf);
    out.push(finalMax);
    const best = logs
      .filter((log) => log.exerciseId === exercise.id && log.loadKg !== undefined)
      .sort((a, b) => (b.loadKg ?? 0) - (a.loadKg ?? 0))[0];
    if (best !== undefined) sourceLogs[exercise.id] = best;
  }
  return { workingMaxes: out, sourceLogs };
}

export function outcomeInputs(context: MaterializeContext, week: SkeletonWeek): {
  atExtensiveTop: boolean;
  capMinusStartPct: number;
  failStreaks: Record<LiftId, number>;
} {
  const constants = context.ruleset.constants;
  const cap = constants.levelTopSetCapPct[context.athlete.level];
  const start =
    (constants.schemes.heavy_strength.startPct ?? 75) +
    (week.targets.startOffsetPct.heavy_strength ?? 0);
  return {
    atExtensiveTop: week.targets.extensiveBottom >= week.targets.extensiveTop,
    capMinusStartPct: cap - start,
    failStreaks: context.history.failStreaks ?? {},
  };
}

/**
 * The skeleton week w is actually built from: the caller's skeleton with week
 * w-1's outcome applied (R94 to R96 plus the added hold). Callers that
 * materialize several weeks in a row carry this forward so the R156 start
 * offsets, the extensive floor and the ladder rungs accumulate.
 */
export function advancedSkeletonFor(
  context: MaterializeContext,
  decision?: OutcomeDecision,
): PlanSkeleton {
  const outcome = decision ?? priorOutcome(context).decision;
  if (outcome === undefined) return context.skeleton;
  return applyOutcomeToSkeleton(
    context.skeleton,
    context.w - 1,
    outcome,
    context.ruleset,
    Object.values(context.history.ladderState)[0]?.advancesThisBlock ?? 0,
  ).skeleton;
}

/** Week w-1's adherence and the outcome it produced. Absent in week 1. */
export function priorOutcome(context: MaterializeContext): {
  adherence: Adherence;
  decision?: OutcomeDecision;
} {
  const previous = context.prevWeek;
  if (context.w <= 1 || previous === undefined) return { adherence: EMPTY_ADHERENCE };
  const adherence = computeAdherence(previous.plan, previous.logs, previous.sessions);
  const judged = weekAt(context.skeleton, context.w - 1) ?? context.skeleton.weeks[0];
  const inputs =
    judged === undefined ? undefined : outcomeInputs(context, judged);
  const decision = decideOutcome(
    adherence,
    adherence.allRepsCompleted,
    context.history.consecutiveAdherence,
    context.ruleset,
    inputs,
  );
  decision.line = outcomeLine(context.w - 1, adherence, decision);
  return { adherence, decision };
}

export function jointReductions(
  context: MaterializeContext,
): { joint: StressedJoint; lastWeek: number; thisWeek: number }[] {
  const constants = context.ruleset.constants;
  const out: { joint: StressedJoint; lastWeek: number; thisWeek: number }[] = [];
  for (const joint of JOINTS) {
    const last = context.history.jointHighStressLastWeek[joint];
    if (last < constants.jointHighStressWeekThreshold) continue;
    const factor = 1 - constants.jointHighStressWeekReductionPct / 100;
    out.push({
      joint,
      lastWeek: last,
      thisWeek: Math.max(1, Math.floor(constants.maxJointHighStressPerSession * factor)),
    });
  }
  return out;
}

/**
 * R66: how many consecutive weeks each exercise has already run, so a newly
 * introduced isometric starts its hold at the range bottom (30 s) instead of
 * at the program's progressed-week counter.
 */
export function holdWeekIndexes(context: MaterializeContext): Record<ExerciseId, number> {
  const out: Record<ExerciseId, number> = {};
  for (const [exerciseId, weeks] of Object.entries(context.history.rotationHistory)) {
    const seen = new Set(weeks);
    let run = 0;
    for (let w = context.w - 1; w >= 1; w -= 1) {
      if (!seen.has(w)) break;
      run += 1;
    }
    out[exerciseId] = run;
  }
  return out;
}

/**
 * The numbers the outcome line names, read off the week just built and the
 * week it judged: which lift stepped up and from what, or which one came up
 * short and by how many reps.
 */
export function outcomeDetail(
  context: MaterializeContext,
  decision: OutcomeDecision,
  sessions: readonly SessionPlan[],
  byId: ReadonlyMap<ExerciseId, Exercise>,
): OutcomeLineDetail {
  const previous = context.prevWeek;
  if (previous === undefined) return {};

  if (decision.kind === 'hold') {
    const lift = Object.keys(decision.workingMaxDeltaPct)[0];
    if (lift === undefined) return {};
    let missed = 0;
    for (const session of previous.plan.sessions) {
      for (const block of session.blocks) {
        for (const row of block.exercises) {
          if (row.exerciseId !== lift) continue;
          for (const set of row.sets) {
            const log = previous.logs.find(
              (entry) =>
                entry.sessionId === session.id &&
                entry.exerciseId === lift &&
                entry.setNumber === set.setNumber,
            );
            const done = log?.repsDone;
            if (set.reps !== undefined && done !== undefined && done < set.reps) {
              missed += set.reps - done;
            }
          }
        }
      }
    }
    const name = byId.get(lift)?.name.toLowerCase() ?? lift;
    return { liftName: name, liftLabel: name, repsMissed: missed };
  }

  if (decision.kind === 'repeat') {
    const block = context.skeleton.blocks.find(
      (entry) => context.w >= entry.weekFrom && context.w <= entry.weekTo,
    );
    return {
      blockLabel: block?.type === 'power' ? 'Power block' : 'Strength block',
      targetDateLabel: context.athlete.targetDate,
    };
  }

  const mainLift = (plans: readonly SessionPlan[]): { id: ExerciseId; lb: number } | undefined => {
    for (const session of plans) {
      for (const block of session.blocks) {
        if (block.name !== 'main_lift') continue;
        const row = block.exercises[0];
        const first = row?.sets.find((set) => !set.isRamp);
        if (row === undefined || first?.loadKg === undefined) continue;
        return { id: row.exerciseId, lb: Math.round(kgToLb(first.loadKg)) };
      }
    }
    return undefined;
  };
  const now = mainLift(sessions);
  const before = mainLift(previous.plan.sessions);
  if (now === undefined || before === undefined || now.id !== before.id || now.lb === before.lb) {
    return {};
  }
  const name = byId.get(now.id)?.name.toLowerCase() ?? now.id;
  return { liftLabel: name, setNumber: 1, fromLb: before.lb, toLb: now.lb };
}
