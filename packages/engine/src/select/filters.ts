/**
 * Block 1 as a filter over the seed, plus the equipment (R19, R45, R46) and
 * level ceilings (R53 to R56) that Block 3 adds, plus the house safety gates
 * on depth jumps and drop heights.
 *
 * Nothing here loosens a Block 1 exclusion: R28 says an exercise that violates
 * any Block 1 rule is excluded regardless of session goal.
 */
import { dropHeightCapIn } from '../budgets.js';
import { diffDays } from '../calendar.js';
import { gripAllows, isCalfVolume, isHardFingerExercise } from './sport.js';
import type { Athlete, Inventory } from '../types/athlete.js';
import type { LocalDate } from '../types/calendar.js';
import type {
  BlockType,
  DayType,
  EquipmentTag,
  Level,
  PainLocation,
  StressLevel,
  WeekKind,
} from '../types/core.js';
import type { Exercise, LadderRung, ProgressionLadder } from '../types/exercise.js';
import type { Ruleset } from '../types/ruleset.js';
import type { PainGateResultWithExtras } from './painGate.js';

/** Everything the filter needs beyond the gate, the inventory and the level. */
export interface FilterOptions {
  /** R35 to R40: an exercise only appears on the day types it is tagged for. */
  dayType?: DayType;
  blockType?: BlockType;
  weekKind?: WeekKind;
  /** House safety: no depth jumps in any first block. */
  isFirstBlock?: boolean;
  /** House safety: the four-item readiness checklist passed on this date. */
  readinessPassedAt?: LocalDate;
  /** The session date, for the four-day guard before the target. */
  sessionDate?: LocalDate;
  targetDate?: LocalDate;
  bodyweightLb?: number | null;
  ruleset?: Ruleset;
  /**
   * The athlete, read only for the house grip rule. Absent leaves every
   * pulling row in the pool, which is what every athlete without a
   * finger-pulley history gets (house `house.sc.open_hand_grip`).
   */
  athlete?: Athlete;
  /**
   * House `house.sc.hard_finger_spacing` and `house.sc.finger_pain_ceiling`:
   * false takes every hard finger row out of this session's pool, leaving the
   * light ones. Absent reads as true.
   */
  allowHardFinger?: boolean;
  /**
   * House `house.sc.calf_volume_low`: false takes the calf and Achilles rows
   * out of this session's pool, because another day of the week carries them.
   * Absent reads as true.
   */
  allowCalfVolume?: boolean;
  /**
   * House `house.sc.rnt_valgus_control`: false takes the knee-alignment rows
   * out of this session's pool, because the week's placement gave them to two
   * other sessions. Absent reads as true.
   */
  allowRnt?: boolean;
}

const LEVEL_RANK: Record<Level, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const STRESS_RANK: Record<StressLevel, number> = { low: 0, moderate: 1, high: 2 };

/** Lower-limb sites that fail the depth-jump readiness checklist. */
const LOWER_LIMB: readonly PainLocation[] = ['knee', 'shin', 'achilles_calf', 'hamstring', 'hip'];

/** True when the inventory carries one equipment tag (R19). */
export function equipmentAvailable(inventory: Inventory, tag: EquipmentTag): boolean {
  switch (tag) {
    case 'none':
      return true;
    case 'barbell':
      return inventory.barbell;
    case 'rack':
      return inventory.rack;
    case 'trap_bar':
      return inventory.trapBar;
    case 'dumbbell':
      return inventory.dumbbells !== null;
    case 'kettlebell':
      return inventory.kettlebells;
    case 'box':
      return inventory.boxHeightsIn.length > 0;
    case 'hurdle':
      return inventory.hurdleHeightsIn.length > 0;
    case 'band':
      return inventory.bands;
    case 'med_ball':
      return inventory.medBall;
    case 'vest':
      return inventory.vestLb !== undefined;
    case 'bench':
      return inventory.bench;
    case 'pullup_bar':
      return inventory.pullupBar;
    case 'cable':
      return inventory.cable;
    case 'sled':
      return inventory.sled;
    case 'hangboard':
      return inventory.hangboard === true;
    case 'box_squat_box':
      return inventory.boxSquatBox === true;
  }
}

/** R19: every tag an exercise names must be on hand. */
export function hasEquipment(inventory: Inventory, tags: readonly EquipmentTag[]): boolean {
  return tags.every((tag) => equipmentAvailable(inventory, tag));
}

/** R53 to R56: the level ceiling on stability demand and exercise level. */
export function levelAllows(exercise: Exercise, level: Level, ceiling: StressLevel): boolean {
  if (LEVEL_RANK[exercise.levelMin] > LEVEL_RANK[level]) return false;
  return STRESS_RANK[exercise.stabilityDemand] <= STRESS_RANK[ceiling];
}

/** Why a readiness-gated drill is or is not available today. */
export interface ReadinessVerdict {
  allowed: boolean;
  /** Plain words, no rule number; empty when allowed. */
  reason: string;
}

/**
 * A drop-off depth jump: the athlete steps off a box and reverses a landing as
 * fast as they can. Two of the five phase bans are about that
 * stretch-shortening load and are scoped to a fast contact time: "no depth
 * jumps in a first block" and "none in the Strength block", which are both
 * about earning the reactive landing. A concentric-biased step-off that pauses
 * in the bottom (`depth_pause_jump`, contact time slow) never reverses a
 * landing, and is the Strength block's own intensive drill under
 * `house.sc.sequence_strength_rfd_reactive`. It still needs the readiness
 * checklist, the level gate, the drop-height cap and the lower-limb pain gate,
 * and it still leaves a deload, a taper and the last four days before the
 * target like every other maximal jump.
 */
export function isDropOffDepthJump(exercise: Exercise | undefined): boolean {
  if (exercise === undefined) return true;
  const plyo = exercise.plyometric;
  if (plyo === undefined) return true;
  return plyo.contactTime === 'fast';
}

/**
 * House safety (brief section 09 "Plyometrics"): depth jumps need the
 * readiness checklist, and are never available for beginners, in any first
 * block, in the Strength block, in a deload, taper or peak week, or within
 * four days of the target date.
 *
 * @param exercise the gated drill, when the caller has one. Every gate applies
 *   to every readiness-gated row except the Strength-block ban, which is about
 *   drop-off depth jumps. Omitting it keeps the old behaviour, which is every
 *   ban applied.
 */
export function depthJumpEligibility(
  gate: PainGateResultWithExtras,
  level: Level,
  options: FilterOptions,
  exercise?: Exercise,
): ReadinessVerdict {
  const dropOff = isDropOffDepthJump(exercise);
  const ruleset = options.ruleset;
  const eligibleByLevel = ruleset === undefined
    ? level !== 'beginner'
    : ruleset.constants.depthJumpEligible[level];
  if (!eligibleByLevel) return { allowed: false, reason: 'Depth jumps start after your first training block.' };
  if (options.readinessPassedAt === undefined) {
    return { allowed: false, reason: 'The depth-jump readiness checklist is not passed yet.' };
  }
  if (dropOff && options.isFirstBlock === true) {
    return { allowed: false, reason: 'No depth jumps in a first block.' };
  }
  if (dropOff && options.blockType === 'strength') {
    return { allowed: false, reason: 'No depth jumps in the Strength block.' };
  }
  if (options.weekKind !== undefined && options.weekKind !== 'load') {
    return { allowed: false, reason: 'No depth jumps in a reduced week.' };
  }
  const withinDays = ruleset?.constants.taper.noDepthJumpsWithinDays ?? 4;
  if (options.sessionDate !== undefined && options.targetDate !== undefined) {
    const daysOut = diffDays(options.sessionDate, options.targetDate);
    if (daysOut >= 0 && daysOut < withinDays) {
      return { allowed: false, reason: 'No depth jumps inside the last four days before your target.' };
    }
  }
  const lowerLimbPain = gate.applied.some((entry) => LOWER_LIMB.includes(entry.location));
  if (lowerLimbPain) {
    return { allowed: false, reason: 'No depth jumps while you are reporting lower-limb pain.' };
  }
  return { allowed: true, reason: '' };
}

function painExcludes(exercise: Exercise, gate: PainGateResultWithExtras): boolean {
  const e = gate.exclusions;
  if (e.allKneeStress && exercise.kneeStress !== 'low') return true;
  if (e.kneeHigh && exercise.kneeStress === 'high') return true;
  if (e.allSpineStress && exercise.spineStress !== 'low') return true;
  if (e.spineHigh && exercise.spineStress === 'high') return true;
  if (e.shoulderHigh && exercise.shoulderStress === 'high') return true;
  if (e.axialAll && exercise.isAxialLoad) return true;
  if (e.axialHeavy && exercise.isAxialLoad && exercise.loadType === 'heavy_strength') return true;
  if (e.overhead && exercise.isOverhead) return true;
  if (e.pressing && exercise.isPressing) return true;
  if (e.repetitiveImpact && exercise.repetitiveImpact) return true;
  if (e.excludedPatterns.includes(exercise.movementPattern)) return true;
  const plyo = exercise.plyometric;
  if (plyo !== undefined) {
    if (e.allPlyo) return true;
    if (e.highIntensityPlyo && plyo.intensity === 'high') return true;
    if (e.highImpactPlyo && (plyo.amplitude === 'high' || plyo.intensity === 'high')) return true;
    // R18, mild Achilles: "reduce plyometric intensity by one tier". The tier
    // below high is moderate, so a high-intensity drill is replaced by a lower
    // one. The weekly test is a fixed measurement protocol, not a training
    // drill, so it is not what a tier drop removes.
    if (
      gate.volumeCuts.intensityTierDown === true &&
      plyo.intensity === 'high' &&
      exercise.rotationGroup !== 'jump_test'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The Block 1 filter plus equipment, level and readiness. Returns the pool in
 * seed order, so selection stays deterministic before any tie-break.
 */
export function applyBlock1(
  exercises: readonly Exercise[],
  gate: PainGateResultWithExtras,
  inventory: Inventory,
  level: Level,
  options: FilterOptions = {},
): Exercise[] {
  const ceiling: StressLevel = options.ruleset?.constants.stabilityCeiling[level]
    ?? (level === 'beginner' ? 'moderate' : 'high');
  const athlete = options.athlete;

  return exercises.filter((exercise) => {
    if (options.dayType !== undefined && !exercise.dayTypes.includes(options.dayType)) return false;
    if (!hasEquipment(inventory, exercise.equipment)) return false;
    if (exercise.requiresBarbell && !inventory.weightRoomAccess) return false;
    if (!levelAllows(exercise, level, ceiling)) return false;
    if (painExcludes(exercise, gate)) return false;
    if (exercise.readinessRequired && !depthJumpEligibility(gate, level, options, exercise).allowed) {
      return false;
    }
    // House rules, all Block-1 class: R28 says an exercise that violates one is
    // excluded regardless of session goal.
    if (athlete !== undefined && !gripAllows(exercise, athlete)) return false;
    if (!readinessTestMatches(exercise, athlete, options.ruleset)) return false;
    if (options.allowHardFinger === false && isHardFingerExercise(exercise)) return false;
    if (options.allowCalfVolume === false && isCalfVolume(exercise)) return false;
    if (options.allowRnt === false && exercise.isRnt) return false;
    return true;
  });
}

/**
 * House `house.sc.readiness_gate`: the neuromuscular test is configuration,
 * not a rotating accessory. An athlete who has chosen one sees that test and
 * no other, so swapping it in Settings is the only thing that changes the row.
 *
 * With nothing chosen the ruleset's own default decides, which is what
 * `resolveReadinessConfig` scores against: the row the athlete performs and
 * the channel the gate reads are then always the same test. Only a caller
 * with neither an athlete nor a ruleset keeps every candidate.
 */
export function readinessTestMatches(
  exercise: Exercise,
  athlete: Athlete | undefined,
  ruleset?: Ruleset,
): boolean {
  if (exercise.readinessTest === undefined) return true;
  const configured = athlete?.readinessConfig ?? ruleset?.constants.climbing.readiness;
  if (configured === undefined) return true;
  return exercise.readinessTest.kind === configured.kind;
}

/**
 * The highest rung at or below the target that the inventory can supply and
 * the drop-height cap allows. Rank 0 needs no equipment, so this always
 * resolves (house rule `house.ladder_policy`).
 */
export function resolveLadderRung(
  ladder: ProgressionLadder,
  targetRank: number,
  inventory: Inventory,
  bodyweightLb: number | null,
  exercise?: Exercise,
): LadderRung {
  const capIn = exercise?.dropHeightCapIn === undefined
    ? Number.POSITIVE_INFINITY
    : Math.min(exercise.dropHeightCapIn, dropHeightCapIn(bodyweightLb));

  const usable = ladder.rungs.filter((rung) => {
    if (rung.rank > targetRank) return false;
    if (!hasEquipment(inventory, rung.equipment)) return false;
    if (rung.heightIn !== undefined) {
      if (rung.heightIn > capIn) return false;
      if (rung.equipment.includes('box') && !inventory.boxHeightsIn.includes(rung.heightIn)) return false;
      if (rung.equipment.includes('hurdle') && !inventory.hurdleHeightsIn.includes(rung.heightIn)) return false;
    }
    return true;
  });

  const best = usable[usable.length - 1];
  if (best !== undefined) return best;
  const rank0 = ladder.rungs[0];
  if (rank0 === undefined) throw new RangeError(`ladder ${ladder.id} has no rungs`);
  return rank0;
}
