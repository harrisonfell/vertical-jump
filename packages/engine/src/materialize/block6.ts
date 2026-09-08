/**
 * Block 6 applied to an already-selected session: scheme, start offset, rep
 * descent, ramps, caps, RPE fallback, rounding and rest, as a display layer
 * over the rows Blocks 2 and 3 chose. It never changes selection (R148, R149).
 *
 * The set count comes from Block 4, not from the exercise default: the Power
 * block cuts the main lift to 3 sets and retags the secondary `strength_speed`
 * (R109), the deload and taper halve, and the peak session runs 2 sets.
 */
import { getPerSetPrescription } from '../prescribe/index.js';
import { resolveCapPctFrom } from '../prescribe/caps.js';
import { estimateSessionMinutes } from '../prescribe/rest.js';
import { workingMaxSourceLine } from '../prescribe/workingMax.js';
import { MAXIMAL_CNS_TOP_SET_PCT, countContacts } from '../budgets.js';
import { indexById } from '../exercises/index.js';
import { UNLOADED_LOAD_TYPES } from '../select/volume.js';
import { sideEffortTail } from '../analytics/sideEffort.js';
import { formatLastTime, kgToLb, type LastTimeSet } from '../units.js';
import type { Athlete, WorkingMax } from '../types/athlete.js';
import type {
  DayType,
  ExerciseId,
  LiftId,
  LoadMode,
  LoadType,
  SessionIntent,
} from '../types/core.js';
import type { Exercise } from '../types/exercise.js';
import type { SetLog } from '../types/logs.js';
import type { PainCaps } from '../types/pain.js';
import type { Ruleset } from '../types/ruleset.js';
import type {
  SessionBlock,
  SessionExercise,
  SessionPlan,
  SetPrescription,
  SkeletonWeek,
  WeekContext,
} from '../types/plan.js';

/** Everything Block 6 needs that the selected session does not carry. */
export interface Block6Context {
  athlete: Athlete;
  ruleset: Ruleset;
  exercises: Exercise[];
  week: SkeletonWeek;
  W: number;
  workingMaxes: WorkingMax[];
  workingMaxLogs: Record<LiftId, SetLog>;
  painCaps?: PainCaps;
  painCapReason?: string;
  isFirstProgramWeek1: boolean;
  percentWeekIndexByLift: Record<LiftId, number>;
  /** R27, this session only. */
  sorenessToday?: number | null;
  /** Prior-week logs, for the "Last time" line. */
  previousLogs: SetLog[];
  /** R66: consecutive weeks each prehab hold has already run. */
  holdWeekIndexByExercise: Record<ExerciseId, number>;
  /** The day type this session runs, which fixes the Upper day's load type. */
  dayType: DayType;
  /**
   * What the session is for beside its day type. For a sport whose Upper
   * Strength day runs at `upper_power` the main pull keeps the heavy-strength
   * ladder rather than the hypertrophy retag
   * (house rule `house.sc.upper_power_day`).
   */
  sessionIntent?: SessionIntent;
}

const RETAGGED_IN_POWER_BLOCK: LoadType = 'strength_speed';

/**
 * R109: "The Power block cuts the main lift to 3 sets and retags the secondary
 * lift strength speed". The brief's worked Power-block secondary shows three
 * rows too, so the retagged lift comes down with the main lift.
 */
const POWER_BLOCK_MAIN_LIFT_SETS = 3;

function workingMaxFor(context: Block6Context, lift: LiftId): WorkingMax | undefined {
  return context.workingMaxes.find((entry) => entry.lift === lift);
}

/**
 * R109 read as the brief names it: inside the Power block the main lift drops
 * to 3 sets and the secondary lift is retagged `strength_speed`. Reduced weeks
 * already carry their halved set count from Block 4.
 */
export function setsForRow(
  row: SessionExercise,
  context: Block6Context,
): { sets: number; loadTypeOverride?: LoadType } {
  const { week, ruleset } = context;
  const selected = row.sets.length;
  // R133 to R136 as the brief reads them: "Upper Strength's main lift is fixed
  // to hypertrophy loads so it is the non-CNS day that separates Lower
  // Strength from Power". Nothing on that day may reach the 85 percent or RPE
  // 8.5 that makes a session maximal CNS.
  // House `house.sc.upper_power_day` scopes that retag to the sports whose
  // upper day is not an upper-power day: a speed climber's pull-up is the
  // sport's strongest performance correlate, so it runs the heavy-strength
  // ladder and is held off the maximal-CNS list by its cap instead.
  if (
    context.dayType === 'upper_strength' &&
    row.loadType === 'heavy_strength' &&
    context.sessionIntent !== 'upper_power'
  ) {
    return { sets: selected, loadTypeOverride: 'hypertrophy' };
  }
  if (week.kind === 'peak' && row.role === 'main_lift') {
    return { sets: ruleset.constants.peak.mainLiftSets };
  }
  if (week.blockType !== 'power' || week.kind !== 'load') return { sets: selected };
  if (row.role === 'main_lift') return { sets: POWER_BLOCK_MAIN_LIFT_SETS };
  if (row.role === 'secondary' && row.loadType === 'heavy_strength') {
    return {
      sets: Math.min(selected, POWER_BLOCK_MAIN_LIFT_SETS),
      loadTypeOverride: RETAGGED_IN_POWER_BLOCK,
    };
  }
  return { sets: selected };
}

/**
 * R105: the prior load week's working reps for this row, halved and shared
 * across the reduced week's sets. Undefined outside a deload or taper.
 */
function reducedRepsCapFor(
  context: Block6Context,
  sets: number,
  loadType: LoadType,
  priorSets: number,
): number | undefined {
  const { week, ruleset } = context;
  if (week.kind !== 'deload' && week.kind !== 'taper') return undefined;
  const factor =
    week.kind === 'deload'
      ? ruleset.constants.deload.volumeFactorMax
      : ruleset.constants.taper.volumeFactor;
  // The budget is read under the load type the row is PRESCRIBED with, not the
  // seeded one: an Upper Strength bench retagged hypertrophy must not inherit
  // the heavy-strength rep budget (R63).
  const descent = ruleset.constants.schemes[loadType].repDescent;
  if (descent === null || descent.length === 0) return undefined;
  let baseTotal = 0;
  for (let index = 0; index < priorSets; index += 1) {
    baseTotal += descent[Math.min(index, descent.length - 1)] ?? 0;
  }
  return Math.max(1, Math.floor((baseTotal * factor) / Math.max(1, sets)));
}

/**
 * R105 with R61 to R66: a reduced week may not push a set out of its load
 * type's rep band, so when the band's floor alone would leave the week above
 * 50 percent of the prior week the cut comes off the SET count instead.
 */
function reducedSetsFor(
  exercise: Exercise,
  loadType: LoadType,
  context: Block6Context,
  selected: number,
  priorSets: number,
): number {
  const { week, ruleset } = context;
  if (week.kind !== 'deload' && week.kind !== 'taper') return selected;
  if (!exercise.loadable || UNLOADED_LOAD_TYPES.has(loadType)) return selected;
  if (exercise.displayMode !== 'reps') return selected;
  const scheme = ruleset.constants.schemes[loadType];
  if (scheme.mode !== 'ascending') return selected;
  const descent = scheme.repDescent;
  if (descent === null || descent.length === 0) return selected;
  const floorReps = Math.max(1, Math.trunc(scheme.reps?.bottom ?? 1));
  const factor =
    week.kind === 'deload'
      ? ruleset.constants.deload.volumeFactorMax
      : ruleset.constants.taper.volumeFactor;
  let baseTotal = 0;
  for (let index = 0; index < priorSets; index += 1) {
    baseTotal += descent[Math.min(index, descent.length - 1)] ?? 0;
  }
  const budget = Math.floor(baseTotal * factor);
  return Math.max(1, Math.min(selected, Math.floor(budget / floorReps)));
}

/**
 * How many working sets the preceding load week ran for this row, so a deload
 * or taper can hold that week's ladder instead of climbing to the level cap.
 * Block 4 has already halved `row.sets` by the time we get here, so the load
 * week's count comes from the exercise default with R109 applied.
 */
function priorLoadWeekSetsFor(
  row: SessionExercise,
  exercise: Exercise,
  context: Block6Context,
): number {
  const { week } = context;
  if (week.blockType === 'power' && row.role === 'main_lift') return POWER_BLOCK_MAIN_LIFT_SETS;
  if (week.blockType === 'power' && row.role === 'secondary') {
    return Math.min(exercise.defaultSets, POWER_BLOCK_MAIN_LIFT_SETS);
  }
  return Math.max(1, exercise.defaultSets);
}

function loadModeFor(
  sets: readonly SetPrescription[],
  workingMax: WorkingMax | undefined,
  isFirstProgramWeek1: boolean,
): LoadMode {
  // R74 and R158: an RPE row carries no load, but the mode is still RPE - the
  // athlete types the load against the target. Week 1 of a first program is
  // its own mode (R76), which the runner labels "Week 1 (RPE 6-7)".
  if (sets.some((set) => set.targetRpe !== undefined)) {
    return isFirstProgramWeek1 ? 'week1' : 'rpe';
  }
  const loaded = sets.some((set) => set.loadKg !== undefined);
  if (!loaded) return 'none';
  if (workingMax === undefined) return 'rpe';
  if (isFirstProgramWeek1) return 'week1';
  return workingMax.source === 'entered' ? 'entered' : 'epley';
}

/**
 * One entry per set number, so a unilateral row logged on both sides reads as
 * the three sets it was rather than six.
 *
 * The left leg's log is preferred where both exist, and only because one of
 * them has to be: the load and the reps on this line are the row's own, the
 * same on both legs, and what actually differed between the sides is the
 * effort, which rides in the tail instead.
 */
function oneEntryPerSet(logs: readonly SetLog[]): SetLog[] {
  const bySet = new Map<number, SetLog>();
  for (const log of logs) {
    const held = bySet.get(log.setNumber);
    if (held === undefined || (held.side === 'right' && log.side === 'left')) {
      bySet.set(log.setNumber, log);
    }
  }
  return [...bySet.values()].sort((a, b) => a.setNumber - b.setNumber);
}

/**
 * What the athlete did last time, in the brief's own notation (section 13):
 * "last 5 / 5" for a bodyweight row, "last 5 × 205 / 4 × 220 / 3 × 235" when
 * the sets carried load, and "last 8 × 6 sets" once more than four identical
 * sets ran. The unit is not repeated: the header line beside it already says
 * whether the numbers are pounds.
 *
 * A unilateral row logged per side carries what the two legs reported in a
 * tail: "last 8 × 30 / 8 × 35 / 8 × 40 · left RPE 8, right RPE 6". That is the
 * whole point of logging the sides separately, and it is the one number on
 * this line the loads cannot say.
 */
export function lastTimeLine(logs: readonly SetLog[], exerciseId: ExerciseId): string | undefined {
  const mine = logs.filter((log) => log.exerciseId === exerciseId && log.repsDone !== undefined);
  if (mine.length === 0) return undefined;
  const sets: LastTimeSet[] = oneEntryPerSet(mine).map((log) => {
    const reps = log.repsDone ?? 0;
    return log.loadKg === undefined ? { reps } : { reps, loadLb: kgToLb(log.loadKg) };
  });
  const line = formatLastTime(sets);
  if (line === undefined) return undefined;
  const tail = sideEffortTail(mine);
  return tail === undefined ? line : `${line} \u00b7 ${tail}`;
}

/**
 * House `house.sc.upper_power_day` under Rule 0's Block 4 precedence. The
 * upper day runs the heavy-strength ladder for this sport rather than the
 * hypertrophy retag, and R90 and R93 still say the training day after a
 * maximal CNS lift may not be another one: the four-day week puts the upper
 * day right there. So the ladder runs with its top set one step below the
 * maximal-CNS threshold, and its RPE one step below the RPE half of the same
 * threshold. The pull is heavy strength, and the day is still the non-CNS day
 * that separates Lower Strength from the jump day.
 */
function upperPowerDayCap(
  context: Block6Context,
  exercise: Exercise,
  loadType: LoadType,
  sets: number,
): { capPct: number; rpeCap: number; note: string } | undefined {
  if (context.sessionIntent !== 'upper_power' || !exercise.loadable) return undefined;
  const constants = context.ruleset.constants;
  const scheme = constants.schemes[loadType];
  if (scheme.mode !== 'ascending') return undefined;
  const capPct = MAXIMAL_CNS_TOP_SET_PCT - scheme.stepPct;
  // Only where it binds: a row whose own ladder never reaches the threshold
  // carries no cap and no note, so the session does not explain a cut it did
  // not take.
  if (scheme.startPct === null) return undefined;
  const start = scheme.startPct + (context.week.targets.startOffsetPct[loadType] ?? 0);
  // A deload and a taper do not run the ascending ladder from `start`: they
  // rebuild the ladder the preceding load week ran and take its TAIL, so the
  // set count says nothing about the top percent they reach. Only the load
  // week's own ladder can be read off the head, so only a load week may
  // decide the cap does not bind.
  const reduced = context.week.kind === 'deload' || context.week.kind === 'taper';
  if (!reduced && start + Math.max(0, sets - 1) * scheme.stepPct <= capPct) return undefined;
  return {
    capPct,
    rpeCap: constants.rpeCap.beginner,
    note: `Held at ${capPct}%: this day sits between your heavy lift and your jumps`,
  };
}

function weekContextFor(
  row: SessionExercise,
  exercise: Exercise,
  context: Block6Context,
  sets: number,
  loadTypeOverride: LoadType | undefined,
  squatWorkingMax: WorkingMax | undefined,
): WeekContext {
  const { week } = context;
  const workingMax = workingMaxFor(context, exercise.id);
  const reps = row.sets[0]?.reps;
  const ctx: WeekContext = {
    w: week.w,
    kind: week.kind,
    blockType: week.blockType,
    k: week.k,
    targets: week.targets,
    isFirstProgramWeek1: context.isFirstProgramWeek1,
    isFirstPercentWeekForLift: (context.percentWeekIndexByLift[exercise.id] ?? 0) === 0,
    sets,
    ruleset: context.ruleset,
    role: row.role,
    percentWeekIndexForLift: context.percentWeekIndexByLift[exercise.id] ?? 0,
  };
  if (loadTypeOverride !== undefined) ctx.loadTypeOverride = loadTypeOverride;
  if (workingMax !== undefined) ctx.workingMax = workingMax;
  if (squatWorkingMax !== undefined) ctx.squatWorkingMax = squatWorkingMax;
  if (context.painCaps !== undefined) ctx.painCaps = context.painCaps;
  if (context.painCapReason !== undefined) ctx.painCapReason = context.painCapReason;
  if (context.sorenessToday !== undefined) ctx.sorenessToday = context.sorenessToday;
  const rendersUnloaded = !exercise.loadable || UNLOADED_LOAD_TYPES.has(exercise.loadType);
  if (reps !== undefined && rendersUnloaded) ctx.repsPerSet = reps;
  if (reps !== undefined && exercise.loadType === 'ballistic') ctx.repsPerSet = reps;
  if (exercise.displayMode === 'distance') ctx.repsPerSet = reps ?? 1;
  ctx.holdWeekIndex = context.holdWeekIndexByExercise[exercise.id] ?? 0;
  const dayCap = upperPowerDayCap(context, exercise, loadTypeOverride ?? exercise.loadType, sets);
  if (dayCap !== undefined) {
    ctx.dayCapPct = dayCap.capPct;
    ctx.dayCapNote = dayCap.note;
    ctx.dayRpeCap = dayCap.rpeCap;
  }
  if (week.kind === 'deload' || week.kind === 'taper') {
    const priorSets = priorLoadWeekSetsFor(row, exercise, context);
    ctx.priorLoadWeekSets = priorSets;
    const reducedCap = reducedRepsCapFor(
      context,
      sets,
      loadTypeOverride ?? exercise.loadType,
      priorSets,
    );
    if (reducedCap !== undefined) ctx.reducedRepsCap = reducedCap;
  }
  return ctx;
}

/** One row, re-prescribed. */
export function prescribeRow(
  row: SessionExercise,
  context: Block6Context,
  squatWorkingMax: WorkingMax | undefined,
): SessionExercise {
  const byId = indexById(context.exercises);
  const exercise = byId.get(row.exerciseId);
  if (exercise === undefined) return row;

  const { sets: selectedSets, loadTypeOverride } = setsForRow(row, context);
  const priorSets = priorLoadWeekSetsFor(row, exercise, context);
  const sets = reducedSetsFor(
    exercise,
    loadTypeOverride ?? exercise.loadType,
    context,
    selectedSets,
    priorSets,
  );
  const weekContext = weekContextFor(row, exercise, context, sets, loadTypeOverride, squatWorkingMax);
  const prescribed = getPerSetPrescription(exercise, context.athlete, weekContext);
  const loadType = loadTypeOverride ?? exercise.loadType;
  const cap = resolveCapPctFrom(exercise, context.athlete, weekContext, context.painCaps, loadType);
  const workingMax = workingMaxFor(context, exercise.id);
  const first = prescribed[0];

  const out: SessionExercise = {
    ...row,
    loadType,
    sets: prescribed,
    restS: first?.restS ?? row.restS,
    restRule: first?.restRule ?? row.restRule,
    loadMode: loadModeFor(prescribed, workingMax, context.isFirstProgramWeek1),
    sourceLine:
      workingMax === undefined
        ? ''
        : workingMaxSourceLine(workingMax, context.workingMaxLogs[exercise.id]),
  };

  const held = prescribed.some((set) => set.isHeld);
  if (cap.note !== undefined && (held || cap.capPct < context.ruleset.constants.levelTopSetCapPct[context.athlete.level])) {
    out.capNote = cap.note;
  }
  const line = lastTimeLine(context.previousLogs, exercise.id);
  if (line !== undefined) out.lastTimeLine = line;
  return out;
}

function workSecondsFor(set: SetPrescription): number {
  if (set.durationS !== undefined) return set.durationS;
  if (set.distanceM !== undefined) return 20;
  return Math.max(20, (set.reps ?? 5) * 4);
}

/** A minute per row to set up, load and put away, so a strength day reads 65 to 80. */
const SETUP_SECONDS_PER_ROW = 60;

/** Sets times (work + rest), whole minutes, warm-up included (brief 05). */
export function estimateMinutes(blocks: readonly SessionBlock[], ruleset: Ruleset): number {
  const entries: { sets: number; restS: number; workSecondsPerSet: number }[] = [];
  let rows = 0;
  for (const block of blocks) {
    if (block.name === 'warm_up') continue;
    for (const row of block.exercises) {
      const first = row.sets[0];
      rows += 1;
      entries.push({
        sets: row.sets.length,
        restS: row.restS,
        workSecondsPerSet: first === undefined ? 40 : workSecondsFor(first),
      });
    }
  }
  return (
    ruleset.constants.warmUp.minutesMax +
    estimateSessionMinutes(entries) +
    Math.round((rows * SETUP_SECONDS_PER_ROW) / 60)
  );
}

/** Every row of one session, re-prescribed, with contacts and minutes redone. */
export function prescribeSessionRows(session: SessionPlan, context: Block6Context): SessionPlan {
  const squatWorkingMax = workingMaxFor(context, context.week.targets.mainLiftBySlot.lower);
  const blocks: SessionBlock[] = session.blocks.map((block) => ({
    ...block,
    exercises: block.exercises.map((row) => prescribeRow(row, context, squatWorkingMax)),
  }));
  const contacts = countContacts(blocks, indexById(context.exercises), session.contacts.targetExtensive);
  return {
    ...session,
    blocks,
    contacts,
    estimatedMinutes: estimateMinutes(blocks, context.ruleset),
  };
}
