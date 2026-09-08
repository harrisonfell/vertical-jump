/**
 * Blocks 2 and 3: pick and order one session's exercises.
 *
 * Runs after Block 1 has excluded and capped (Rule 0) and after Block 4 and
 * Block 5 have set the week's volume, contact and progression targets. It
 * hands its result to Block 6, which never changes selection: the set rows it
 * writes carry the planned volume (sets, reps, holds, distances) and no load,
 * so contacts can be counted here and loads filled in there.
 */
import { MAXIMAL_CNS_TOP_SET_PCT, countContacts } from '../budgets.js';
import { diffDays } from '../calendar.js';
import { indexById } from '../exercises/index.js';
import { applyBlock1 } from './filters.js';
import {
  climbingPlacementFor,
  sessionFingerLoad,
  sessionHasRnt,
  sportAllows,
} from './sport.js';
import type { ClimbingPlacement, SportRequirements } from './sport.js';
import { sprintClassFor, templateFor } from './order.js';
import { estimateSelectedMinutes, groupIntoBlocks } from './rows.js';
import type { RoleSlot, TemplateOptions } from './order.js';
import { applyR111Swap, rotateStaleExercises } from './rotation.js';
import { satisfyPairings, trimToDisplayCap } from './trim.js';
import { MAXIMAL_CNS_HIGH_INTENSITY_CONTACTS, planVolume } from './volume.js';
import type { PlacedRow } from './trim.js';
import type { Prng } from '../prng.js';
import type { Athlete } from '../types/athlete.js';
import type { DayType, ExerciseId, SessionIntent, Side, StressedJoint } from '../types/core.js';
import type { Exercise, ProgressionLadder } from '../types/exercise.js';
import type {
  SessionPlan,
  SkeletonSession,
  SkeletonWeek,
} from '../types/plan.js';
import type { Ruleset } from '../types/ruleset.js';
import type { PainGateResultWithExtras } from './painGate.js';
import {
  POWER_DAYS,
  STRENGTH_DAYS,
  canAdd,
  chooseByScore,
  rank,
  spend,
  type Budget,
} from './score.js';

export * from './rows.js';
export * from './score.js';

/** Everything selection is allowed to read for one session. */
export interface SelectContext {
  athlete: Athlete;
  ruleset: Ruleset;
  exercises: Exercise[];
  ladders: ProgressionLadder[];
  week: SkeletonWeek;
  session: SkeletonSession;
  painGate: PainGateResultWithExtras;
  /** Weeks each exercise has already appeared in, for R57 rotation. */
  rotationHistory: Record<string, number[]>;
  /** R26: the joint budget carried in from last week. */
  jointHighStressLastWeek: Record<StressedJoint, number>;
  /** Every choice among equals goes through this. */
  prng: Prng;
  /** House safety: no depth jumps in a first block. */
  isFirstBlock?: boolean;
  /** R57: a main lift may only change here, and only on a plateau. */
  blockTransition?: boolean;
  /** R110 house: five tests inside the noise band, or a stalled main lift. */
  plateau?: boolean;
  /** R111 house: a working max is up 10 percent since block start. */
  workingMaxUp10?: boolean;
  /** Overrides the sport rule when the caller already decided (R137, in season). */
  includeCod?: boolean;
  /**
   * R27, that workout only: high-intensity contacts halve and depth jumps are
   * removed before selection, so the counted contacts already read reduced.
   */
  sorenessReduction?: boolean;
  /**
   * House `house.sc.finger_pain_ceiling`: today's 0 to 10 finger-pain answer,
   * asked before a session with hard finger work. Above the athlete's ceiling
   * the hard finger rows leave this session and a notice says so.
   * `materializeWeek` forwards `history.fingerPainToday` here, and only onto
   * the session dated today.
   */
  fingerPainToday?: number | null;
  /**
   * House `house.sc.readiness_gate`, the `holdVolume` half: today's extensive
   * target is built without this week's raise, so an autonomic-low day gets
   * the volume it had rather than the volume it earned. A reduction the
   * generator has to make before selection, because a session already built
   * cannot un-take a raise it was built with.
   */
  holdExtensiveRaise?: boolean;
  /**
   * House `house.sc.weaker_side_first`: the side the athlete's own per-side
   * logs report as working harder, from `harderSideFrom`. It outranks the setup
   * answer on the row note, because logged sets are what the two legs did and
   * the answer was typed before either had been loaded. Absent or null leaves
   * the answer in charge.
   */
  weakerSideLogged?: Side | null;
}

const COD_SPORTS = new Set(['basketball', 'soccer']);

/** The week-level house placements, read off one selection context. */
function placementFor(context: SelectContext): ClimbingPlacement {
  return climbingPlacementFor(
    context.athlete,
    context.ruleset,
    context.week.sessions,
    context.session,
    context.exercises,
    context.fingerPainToday,
  );
}

/**
 * The candidate pool after Block 1 exclusions, R19 equipment, R46 barbell
 * access, R53 to R56 level ceilings and the day type's own list.
 */
export function eligibleExercises(
  context: SelectContext,
  placement: ClimbingPlacement = placementFor(context),
): Exercise[] {
  const { athlete, week, session } = context;
  const pool =
    context.sorenessReduction === true
      ? context.exercises.filter((exercise) => !exercise.readinessRequired)
      : context.exercises;
  // House `house.sc.sport_requirements`: an exercise tagged for one sport is
  // out of every other sport's pool, and an untagged one stays in all of them.
  const forSport = pool.filter((exercise) => sportAllows(exercise, athlete.sport));
  return applyBlock1(forSport, context.painGate, athlete.inventory, athlete.level, {
    dayType: session.dayType,
    blockType: week.blockType,
    weekKind: week.kind,
    isFirstBlock: context.isFirstBlock === true,
    ...(athlete.readinessPassedAt === undefined ? {} : { readinessPassedAt: athlete.readinessPassedAt }),
    sessionDate: session.date,
    targetDate: athlete.targetDate,
    bodyweightLb: athlete.bodyweightKg === null ? null : athlete.bodyweightKg * 2.2046226218,
    ruleset: context.ruleset,
    athlete,
    allowHardFinger: placement.allowHardFinger,
    allowCalfVolume: placement.allowCalfVolume,
    allowRnt: placement.rntRequired ? placement.rnt : true,
  });
}

function templateOptionsFor(context: SelectContext, placement: ClimbingPlacement): TemplateOptions {
  const { athlete, week, session } = context;
  const reduced = week.kind !== 'load';
  const codBySport = COD_SPORTS.has(athlete.sport) && !(athlete.inSeason && athlete.sport === 'basketball');
  const upperPower =
    placement.requirements.upperDayIntent === 'upper_power' && session.dayType === 'upper_strength';
  // House `house.sc.sport_requirements`: for speed climbing the 5-day Speed
  // day is a reactive day, not an extensive-only one, so approach jumps,
  // seated jumps and quick-contact jumps are all selectable there. Its
  // high-intensity contacts stay under the maximal-CNS threshold, which is
  // what kept the day extensive-only for every other sport (R90, R91).
  const extensiveOnly =
    session.dayType === 'speed' && placement.requirements.sport !== 'speed_climbing';
  return {
    isTestDay: session.isTestDay,
    includeCod: context.includeCod ?? (codBySport && session.dayType !== 'upper_mobility'),
    // R138 and R140 are weekly requirements the power-family day carries; the
    // in-season override that lets games stand in only covers R137's change of
    // direction, so a sprint requirement is not waived by it.
    sprintClass: sprintClassFor(athlete.sport),
    extensiveOnly,
    reducedWeek: reduced,
    peakSession: week.kind === 'peak' && STRENGTH_DAYS.has(session.dayType),
    upperPower,
    rntSlot: placement.rnt,
    allowsConditioning: placement.requirements.allowsConditioningBlock,
    extraPowerRow: placement.requirements.sport === 'speed_climbing',
    explosivePullRow: placement.requirements.sport === 'speed_climbing' && session.dayType === 'speed',
  };
}

/** One preferred slot the budgets left empty, named by the row it wanted. */
interface DroppedSlot {
  exerciseId: string;
  reason: string;
}

function fillSlots(
  pool: readonly Exercise[],
  slots: readonly RoleSlot[],
  context: SelectContext,
  options: TemplateOptions,
): { rows: PlacedRow[]; dropped: DroppedSlot[] } {
  const budget: Budget = { highCns: 0, heavy: 0, joint: { knee: 0, spine: 0, shoulder: 0 } };
  const chosen = new Set<ExerciseId>();
  const rows: PlacedRow[] = [];
  const dropped: DroppedSlot[] = [];

  for (const slot of slots) {
    const from = pool;
    let candidates = from.filter(
      (exercise) =>
        !chosen.has(exercise.id) &&
        exercise.roleCandidates.includes(slot.role) &&
        (slot.filter === undefined || slot.filter(exercise)),
    );
    if (options.extensiveOnly) {
      candidates = candidates.filter((exercise) => exercise.plyometric?.intensity !== 'high');
    }
    if (slot.block === 'cool_down') {
      const hip = candidates.filter((exercise) => exercise.rotationGroup === 'hip_mobility');
      if (hip.length > 0) candidates = [...hip, ...candidates.filter((e) => e.rotationGroup !== 'hip_mobility')];
    }
    const ordered = rank(candidates, slot, context, `${slot.block}:${slot.role}`);
    let taken = 0;
    for (const exercise of ordered) {
      if (taken >= slot.count) break;
      if (!canAdd(exercise, budget, context)) continue;
      spend(exercise, budget);
      chosen.add(exercise.id);
      rows.push({
        exercise,
        block: slot.block,
        role: slot.role,
        grouped: slot.grouped,
        precedence: slot.precedence,
        required: taken < slot.min,
      });
      taken += 1;
    }
    const wanted = ordered[0];
    if (taken === 0 && slot.dropReason !== undefined && wanted !== undefined) {
      dropped.push({ exerciseId: wanted.id, reason: slot.dropReason });
    }
  }
  return { rows, dropped };
}


/**
 * House definition of a maximal CNS session: a heavy-strength top set at or
 * above 85 percent or RPE 8.5, or 10 or more high-intensity contacts, or any
 * depth-jump session. The test day always qualifies.
 */
export function isMaximalCnsSession(session: SessionPlan, ruleset: Ruleset): boolean {
  if (session.isTestDay) return true;
  if (session.contacts.highIntensity >= MAXIMAL_CNS_HIGH_INTENSITY_CONTACTS) return true;
  for (const block of session.blocks) {
    for (const row of block.exercises) {
      if (row.ladderId === 'depth_jump_height') return true;
      if (row.loadType !== 'heavy_strength') continue;
      for (const set of row.sets) {
        if ((set.loadPercent ?? 0) >= MAXIMAL_CNS_TOP_SET_PCT) return true;
        if ((set.targetRpe ?? 0) >= ruleset.constants.rpeCap.intermediate) return true;
      }
    }
  }
  return false;
}

/**
 * Choose and order one session's exercises, with contacts counted and the
 * trim list filled in. Loads are not set here: Block 6 does that.
 */
export function selectSession(context: SelectContext): SessionPlan {
  const { athlete, ruleset, week, session } = context;
  const seedIndex = indexById(context.exercises);
  const placement = placementFor(context);
  const options = templateOptionsFor(context, placement);
  const pool = eligibleExercises(context, placement);
  // Repairs and rotations read the same pool the slots did: no sport carries a
  // pool filter of its own any more. Speed climbing programs sprints per the
  // rule book (R102 to R104, R113); what it does not carry is a conditioning
  // BLOCK or a change-of-direction slot, and both of those are missing slots
  // rather than missing rows, so no cut can be prescribed either way.
  const training = pool;
  const slots = templateFor(session.dayType, options);
  const { rows: placed, dropped } = fillSlots(pool, slots, context, options);

  const budget: Budget = { highCns: 0, heavy: 0, joint: { knee: 0, spine: 0, shoulder: 0 } };
  for (const row of placed) spend(row.exercise, budget);
  // R29 to R40 give the recovery day no strength block, so R47 to R50 have
  // nothing to balance there; only R99's tendon work still applies.
  const structuralPairings = session.dayType !== 'recovery_mobility';
  const paired = satisfyPairings(placed, training, {
    requireTendon: session.dayType !== 'recovery_mobility' && week.kind !== 'peak',
    structural: structuralPairings,
    canAdd: (exercise) => canAdd(exercise, budget, context),
    choose: (candidates, label) => chooseByScore(candidates, label, context),
    repairPrecedence: 65,
  });

  // Rule 0: Block 4's CNS and joint budgets outrank Block 5's rotation, so a
  // replacement is measured against the session as it stands without the row
  // it would take over. A rotation that would break R44 or R23 to R25 is
  // refused and the stale row stays.
  let currentRows: readonly PlacedRow[] = paired.rows;
  const rotationContext = {
    w: week.w,
    rotationHistory: context.rotationHistory,
    rotationWeeks: ruleset.constants.accessoryRotationWeeks,
    plateau: context.plateau === true,
    blockTransition: context.blockTransition === true,
    workingMaxUp10: context.workingMaxUp10 === true,
    fixedRows: (row: PlacedRow) =>
      row.block === 'jump_test' ||
      (session.isTestDay && row.block === 'primer') ||
      // House `house.sc.readiness_gate`: the gate's test is the measurement
      // the athlete configured, so R57 never rotates it out from under them.
      row.exercise.readinessTest !== undefined,
    allow: (candidate: Exercise, replacing: PlacedRow): boolean => {
      const room: Budget = { highCns: 0, heavy: 0, joint: { knee: 0, spine: 0, shoulder: 0 } };
      for (const row of currentRows) {
        if (row.exercise.id === replacing.exercise.id) continue;
        spend(row.exercise, room);
      }
      return canAdd(candidate, room, context);
    },
    prng: context.prng,
  };
  const rotated = rotateStaleExercises(paired.rows, training, rotationContext);
  currentRows = rotated.rows;
  const swapped = STRENGTH_DAYS.has(session.dayType)
    ? applyR111Swap(rotated.rows, training, rotationContext)
    : { rows: rotated.rows, notes: {} };
  const notes = { ...rotated.notes, ...swapped.notes };

  const trimResult = trimToDisplayCap(swapped.rows, ruleset.constants.maxDisplayedExercises, {
    requireTendon: session.dayType !== 'recovery_mobility' && week.kind !== 'peak',
    structural: structuralPairings,
  });
  // A preferred slot the budgets left empty is a trimmed row too: the reason
  // says why, and the row it names is the one it would have taken.
  trimResult.trimmed.push(...dropped);
  const { volumes, targetExtensive } = planVolume(trimResult.rows, context, options);
  // A high-amplitude drill can be squeezed to nothing by R52's hard cap; an
  // empty row is not shown, it is recorded as trimmed.
  const kept = trimResult.rows.filter((row) => volumes.get(row.exercise.id)?.sets !== 0);
  for (const row of trimResult.rows) {
    if (volumes.get(row.exercise.id)?.sets !== 0) continue;
    trimResult.trimmed.push({
      exerciseId: row.exercise.id,
      reason: 'No contacts left in the session budget',
    });
  }
  const blocks = groupIntoBlocks(kept, context, volumes, notes, placement);
  const contacts = countContacts(blocks, indexById(context.exercises), targetExtensive);

  const headerSuffixes: string[] = [];
  if (week.kind !== 'load') headerSuffixes.push(week.kind);
  if (session.isTestDay) headerSuffixes.push('test day');
  if (week.repeatOfWeek !== undefined) headerSuffixes.push(`repeat of week ${week.repeatOfWeek}`);

  const notices: string[] = [...context.painGate.lines];
  for (const requirement of paired.unmet) {
    notices.push(`Could not fit ${requirement} with the equipment on hand.`);
  }
  // A line only where the template asked for pull work: a jump day that was
  // never going to carry a pull has nothing to explain.
  const hasPulling = options.upperPower === true || options.explosivePullRow === true;
  if (placement.fingerPainOver && hasPulling) {
    notices.push(
      `Finger pain at ${context.fingerPainToday ?? 0} out of 10: the hard finger work is out of today's session.`,
    );
  } else if (placement.demotedFinger && hasPulling) {
    // The wall is a hard finger session too, so when it is the wall that took
    // the rows the line names the climbing day: "climbing Tue evening".
    notices.push(
      placement.fingerWallLine ??
        "Hard finger work needs 48 hours between sessions, so today's pulling is light.",
    );
  }
  if (placement.rntForced) notices.push(...placement.rntLines);
  if (POWER_DAYS.has(session.dayType) && !trimResult.rows.some((row) => row.exercise.readinessRequired)) {
    const daysOut = diffDays(session.date, athlete.targetDate);
    if (daysOut >= 0 && daysOut < ruleset.constants.taper.noDepthJumpsWithinDays) {
      notices.push('No depth jumps inside the last four days before your target.');
    }
  }

  const plan: SessionPlan = {
    id: `w${week.w}-d${session.dayIndex}`,
    date: session.date,
    weekday: session.weekday,
    dayType: session.dayType,
    isTestDay: session.isTestDay,
    isMaximalCns: false,
    estimatedMinutes: estimateSelectedMinutes(blocks, context),
    headerSuffixes,
    notices,
    blocks,
    contacts,
    trimmed: trimResult.trimmed,
    fingerLoad: sessionFingerLoad(blocks, seedIndex),
    rntScheduled: sessionHasRnt(blocks, seedIndex),
  };
  plan.isMaximalCns = isMaximalCnsSession(plan, ruleset);
  const intent = sessionIntentFor(session.dayType, placement.requirements);
  if (intent !== undefined) plan.sessionIntent = intent;
  if (session.isTestDay) plan.testStatus = 'planned';
  return plan;
}

/**
 * House `house.sc.upper_power_day`: what a session is for beside its day type.
 * Only the Upper Strength day of a sport that asks for an upper-power day
 * carries one, so every other sport's sessions are unchanged.
 */
export function sessionIntentFor(
  dayType: DayType,
  requirements: SportRequirements,
): SessionIntent | undefined {
  if (dayType !== 'upper_strength') return undefined;
  return requirements.upperDayIntent === 'upper_power' ? 'upper_power' : undefined;
}
